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
  amountToDisplay,
  getAddressBalance,
  getOrderWei,
  transferMonitor,
} from './evm';
import { receivedLessTokenThanExpectedMessage } from '../bot/messages';

export function subscribeToTransfer(
  bot: MainContext,
  hash: string,
  checkBalanceEarly = false
) {
  const handler = (amount: bigint): void => {
    (async () => {
      const order = await Order.findOne({ hash });
      if (!order) {
        console.error(`No order for hash ${hash}`);
        transferMonitor.delete(hash);
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
      const i18nCtxBuyer = await getUserI18nContext(
        buyerUser || { lang: 'en' }
      );
      const i18nCtxSeller = await getUserI18nContext(
        sellerUser || { lang: 'en' }
      );
      const targetAmount = await getOrderWei(order);
      if (amount < targetAmount) {
        const balance = await getAddressBalance(hash);
        if (balance < targetAmount) {
          if (sellerUser) {
            const diff = targetAmount - balance;
            await receivedLessTokenThanExpectedMessage(
              bot,
              await amountToDisplay(diff),
              sellerUser,
              order,
              i18nCtxSeller
            );
          }
          return;
        }
      }
      logger.info(
        `Order ${order._id} Escrow address: ${order.hash} got payment!`
      );
      transferMonitor.delete(hash);
      if (order.invoice_held_at) {
        // Duplicated callback
        return;
      }
      order.status = 'ACTIVE';
      if (order.type === 'buy') {
        order.status = 'WAITING_BUYER_INVOICE';
      }
      order.invoice_held_at = new Date();
      order
        .save()
        .catch(e => logger.error('Error when saving order: ' + e?.toString()));
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
    })().catch(e =>
      logger.error(`Error in transfer monitor callback: ${e.toString()}`)
    );
  };
  transferMonitor.add(hash, handler);
  if (checkBalanceEarly) {
    getAddressBalance(hash)
      .then(balance => {
        if (balance > 0n) {
          handler(balance);
        }
      })
      .catch(() => {});
  }
}

const payHoldInvoice = async (bot: MainContext, order: IOrder) => {
  try {
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
    logger.error('payHoldInvoice catch: ', error?.toString());
  }
};

export { payHoldInvoice };
