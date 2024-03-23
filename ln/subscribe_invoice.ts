/* eslint-disable @typescript-eslint/no-misused-promises */
import { IOrder } from '../models/order';
import { Order, User } from '../models';
import { payToBuyer } from './pay_request';
import * as messages from '../bot/messages';
import * as ordersActions from '../bot/ordersActions';
import { getUserI18nContext, getEmojiRate, decimalRound } from '../util';
import { logger } from '../logger';
import { MainContext } from '../bot/start';
import {
  getOrderWei,
  eventMonitor,
  getOpenEscrow,
  CloseReason,
  getEscrowState,
  State,
  getEscrowCloseReason,
} from './evm';
import { ContractEvent, Log, Result, ethers } from 'ethers';
import { Telegraf } from 'telegraf';
import { orderRefunded } from '../bot/commands2';

export function subscribeToEscrowActions({
  bot,
  escrowAddress,
  checkState = false,
}: {
  bot: Telegraf<MainContext>;
  escrowAddress: string;
  checkState?: boolean;
}) {
  escrowAddress = ethers.getAddress(escrowAddress);
  let unsubscribe: () => void;
  const handlerAsync = async (
    event: ContractEvent,
    log: Log,
    result: Result
  ) => {
    if (event.name === 'Open') {
      return;
    }
    if (log.address !== escrowAddress) {
      return;
    }
    const order = await getOrder();
    if (!order) {
      if (unsubscribe) {
        unsubscribe();
      }
      return;
    }
    if (event.name === 'Close') {
      logger.info(
        `Order ${order._id.toString()} - Close - ${
          CloseReason[result.reason] || result.reason || '<unknown reason>'
        }`
      );
      await handleClose(order, Number(result.reason));
    }
    if (event.name === 'Dispute') {
      await handleDispute(order);
    }
  };
  const handler = (event: ContractEvent, log: Log, result: Result): void => {
    handlerAsync(event, log, result).catch(e =>
      logger.error(`Error in transfer monitor callback: ${e.toString()}`)
    );
  };
  unsubscribe = eventMonitor.add(escrowAddress, handler);
  if (checkState) {
    checkStateAsync().catch(e =>
      logger.error(`Error in checkState: ${e.toString()}`)
    );
  }
  async function checkStateAsync() {
    const state = await getEscrowState(escrowAddress);
    if ([State.Closed, State.Dispute].includes(state)) {
      unsubscribe();
      const order = await getOrder();
      if (!order) {
        return;
      }
      if (state === State.Closed) {
        const reason = await getEscrowCloseReason(escrowAddress);
        await handleClose(order, reason);
      } else {
        await handleDispute(order);
      }
    }
  }
  async function getOrder() {
    const order = await Order.findOne({ hash: escrowAddress });
    if (!order) {
      console.error(`No order for hash ${escrowAddress}`);
      return undefined;
    }
    if (!['FIAT_SENT', 'ACTIVE'].includes(order.status)) {
      return undefined;
    }
    return order;
  }
  async function handleDispute(order: IOrder) {
    logger.info(`Order ${order._id.toString()} - Dispute`);
    if (unsubscribe) {
      unsubscribe();
    }
    const user = await User.findOne({ _id: order.seller_id });
    if (!user) {
      throw new Error("Seller user doesn't exist");
    }
    const from = {
      id: parseInt(user.tg_id, 10),
      first_name: 'User',
      username: user.username,
      is_bot: false,
    };
    await bot.handleUpdate({
      update_id: 1,
      callback_query: {
        id: order._id?.toString(),
        chat_instance: String(user.tg_id),
        from,
        message: {
          message_id: order._id.toString(),
          from,
          chat: { id: from.id, type: 'private', first_name: from.first_name },
          date: Date.now(),
          text: '',
        },
        data: `disputeFromEscrow(${order._id})`,
      },
    });
  }

  async function handleClose(order: IOrder, reason: CloseReason) {
    if (unsubscribe) {
      unsubscribe();
    }
    const sellerUser = await User.findOne({ _id: order.seller_id });
    if (!sellerUser) {
      logger.warn(
        `Can't find seller user ${order.seller_id} for order ${order._id}`
      );
    }
    while ((await getEscrowState(escrowAddress)) !== State.Closed) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (reason === CloseReason.Release) {
      await require('../bot/commands').release(
        bot,
        order._id.toString(),
        sellerUser
      );
    } else if (
      [CloseReason.Refund, CloseReason.RefundExpired].includes(reason)
    ) {
      await orderRefunded(bot, order._id.toString());
    }
  }
}
export function subscribeToEscrowOpen({
  bot,
  orderId,
  buyerAddress,
  checkOpenEscrows = false,
}: {
  bot: Telegraf<MainContext>;
  orderId: string;
  buyerAddress: string;
  checkOpenEscrows?: boolean;
}) {
  buyerAddress = ethers.getAddress(buyerAddress);
  let unsubscribe: () => void;
  const handlerAsync = async (
    event: ContractEvent,
    log: Log,
    result: Result
  ) => {
    if (event.name !== 'Open') {
      return;
    }
    if (!result.amount) {
      logger.error(`No amount in result: ${result}`);
      return;
    }
    const order = await Order.findOne({ _id: orderId });
    if (!order) {
      console.error(`No order for id ${orderId}`);
      if (unsubscribe) {
        unsubscribe();
      }
      return;
    }
    const targetAmount = await getOrderWei(order);
    if (targetAmount !== BigInt(result.amount)) {
      return;
    }
    const buyerUser = await User.findOne({ _id: order.buyer_id });
    if (!buyerUser) {
      logger.warn(
        `Can't find buyer user ${order.buyer_id} for order ${order._id}`
      );
    }
    const sellerUser = await User.findOne({ _id: order.seller_id });
    if (!sellerUser) {
      logger.warn(
        `Can't find seller user ${order.seller_id} for order ${order._id}`
      );
    }
    // We need two i18n contexts to send messages to each user
    const i18nCtxBuyer = await getUserI18nContext(buyerUser || { lang: 'en' });
    const i18nCtxSeller = await getUserI18nContext(
      sellerUser || { lang: 'en' }
    );
    logger.info(
      `Order ${order._id} Escrow address: ${order.hash} got payment!`
    );
    order.status = 'ACTIVE';
    order.hash = ethers.getAddress(log.address);
    if (order.invoice_held_at) {
      // Duplicated callback
      return;
    }
    if (order.type === 'buy') {
      order.status = 'WAITING_BUYER_INVOICE';
    }
    order.invoice_held_at = new Date();
    if (await Order.findOne({ hash: order.hash })) {
      // Conflict
      return;
    }
    if (unsubscribe) {
      unsubscribe();
    }
    try {
      await order.save();
    } catch (e) {
      logger.error('Error when saving order: ' + e?.toString());
      return;
    }
    if (sellerUser && buyerUser) {
      if (order.type === 'sell') {
        await messages.onGoingTakeSellMessage(
          bot,
          sellerUser,
          buyerUser,
          order,
          i18nCtxBuyer,
          i18nCtxSeller
        );
      } else if (order.type === 'buy') {
        // We need the seller rating
        const stars = getEmojiRate(sellerUser.total_rating);
        const roundedRating = decimalRound(sellerUser.total_rating, -1);
        const rate = `${roundedRating} ${stars} (${sellerUser.total_reviews})`;
        await messages.onGoingTakeBuyMessage(
          bot,
          sellerUser,
          buyerUser,
          order,
          i18nCtxBuyer,
          i18nCtxSeller,
          rate
        );
      }
    }
    subscribeToEscrowActions({ bot, escrowAddress: log.address });
  };
  const handler = (event: ContractEvent, log: Log, result: Result): void => {
    handlerAsync(event, log, result).catch(e =>
      logger.error(`Error in transfer monitor callback: ${e.toString()}`)
    );
  };
  unsubscribe = eventMonitor.add(buyerAddress, handler);
  if (checkOpenEscrows) {
    getOpenEscrow(buyerAddress)
      .then(async matches => {
        for (const { event, log, result } of matches) {
          await handlerAsync(event, log, result);
        }
      })
      .catch(e => {
        console.error(`Error in checkOpenEscrows: ${e?.toString()} ${e.stack}`);
      });
  }
}

const payHoldInvoice = async (bot: MainContext, order: IOrder) => {
  try {
    if (!order.invoice_held_at) {
      return;
    }
    if ((await getEscrowState(order.hash)) !== State.Closed) {
      return;
    }
    order.status = 'PAID_HOLD_INVOICE';
    await order.save();
    const buyerUser = await User.findOne({ _id: order.buyer_id });
    if (!buyerUser) {
      logger.warn(
        `Can't find buyer user ${order.buyer_id} for order ${order._id}`
      );
    }
    const sellerUser = await User.findOne({ _id: order.seller_id });
    if (!sellerUser) {
      logger.warn(
        `Can't find seller user ${order.seller_id} for order ${order._id}`
      );
    }
    // We need two i18n contexts to send messages to each user
    const i18nCtxBuyer = await getUserI18nContext(buyerUser || { lang: 'en' });
    const i18nCtxSeller = await getUserI18nContext(
      sellerUser || { lang: 'en' }
    );
    if (buyerUser && sellerUser) {
      await messages.releasedSatsMessage(
        bot,
        order,
        sellerUser,
        buyerUser,
        i18nCtxBuyer,
        i18nCtxSeller
      );
    }
    // If this is a range order, probably we need to created a new child range order
    const orderData = await ordersActions.getNewRangeOrderPayload(order);
    let i18nCtx;
    if (orderData) {
      let user;
      if (order.type === 'sell') {
        user = sellerUser;
        i18nCtx = i18nCtxSeller;
      } else {
        user = buyerUser;
        i18nCtx = i18nCtxBuyer;
      }
      if (user) {
        const newOrder = await ordersActions.createOrder(
          i18nCtx,
          bot,
          user,
          orderData
        );

        if (newOrder) {
          if (order.type === 'sell') {
            await messages.publishSellOrderMessage(
              bot,
              user,
              newOrder,
              i18nCtx,
              true
            );
          } else {
            await messages.publishBuyOrderMessage(
              bot,
              user,
              newOrder,
              i18nCtx,
              true
            );
          }
        }
      }
    }
    if (sellerUser) {
      // The seller get reputation after release
      await messages.rateUserMessage(bot, sellerUser, order, i18nCtxSeller);
    }
    // We proceed to pay to buyer
    await payToBuyer(bot, order);
  } catch (error) {
    console.log(error);
    logger.error('payHoldInvoice catch: ', error?.toString());
  }
};

export { payHoldInvoice };
