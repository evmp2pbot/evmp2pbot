import { IOrder } from '../models/order';

// const { subscribeToInvoice } = require('lightning');
import { Order, User } from '../models';
import { payToBuyer } from './pay_request';
import messages from '../bot/messages';
import * as ordersActions from '../bot/ordersActions';
import { getUserI18nContext, getEmojiRate, decimalRound } from '../util';
import { logger } from '../logger';
import { MainContext } from '../bot/start';


function onInvoiceUpdated(...args: any) {
}
const subscribeInvoice = async (
  bot: MainContext,
  id: string,
  resub: boolean
) => {
  try {
    onInvoiceUpdated(async (invoice: any) => {
      if (invoice.is_held && !resub) {
        const order = await Order.findOne({ hash: invoice.id });
        if (!order) {
          console.error(`No order for invoice ${invoice.id}`);
          return;
        }
        logger.info(
          `Order ${order._id} Invoice with hash: ${id} is being held!`
        );
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
            order.status = 'WAITING_BUYER_INVOICE';
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
          order.invoice_held_at = new Date();
          order.save().catch(e => logger.error(e?.toString()));
        }
      }
      if (invoice.is_confirmed) {
        const order = await Order.findOne({ hash: id });
        if (!order) {
          console.error(`No order for invoice ${invoice.id}`);
          return;
        }
        logger.info(
          `Order ${order._id} - Invoice with hash: ${id} was settled!`
        );
        if (order.status === 'FROZEN' && order.is_frozen) {
          logger.info(
            `Order ${order._id} - Order was frozen by ${order.action_by}!`
          );
          return;
        }
        await payHoldInvoice(bot, order);
      }
    });
  } catch (error) {
    logger.error('subscribeInvoice catch: ', error);
    return false;
  }
};

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

export { subscribeInvoice, payHoldInvoice };
