/* eslint-disable no-unreachable */
import { User, PendingPayment } from '../models';
import { handleReputationItems, getUserI18nContext } from '../util';
import messages from '../bot/messages';
import { logger } from '../logger';
import { IOrder } from '../models/order';
import { MainContext } from '../bot/start';

// EVMTODO: For MVP only, replace with something meaningful later
const completedPayments = new Set<string>();

const payRequest = async ({
  request,
  amount,
}: {
  request: string;
  amount: string;
}) => {
  try {
    logger.info(`EVMTODO: payRequest ${amount} ${request}`);
    setTimeout(() => completedPayments.add(request), 1000);
    return {
      is_expired: false,
      confirmed_at: new Date(),
      id: request,
      fee: 0,
    }
  } catch (error) {
    logger.error(`payRequest: ${error?.toString()}`);
    return false;
  }
};

const payToBuyer = async (bot: MainContext, order: IOrder) => {
  try {
    // We check if the payment is on flight we don't do anything
    const isPending = await isPendingPayment(order.buyer_invoice);
    if (isPending) {
      return;
    }
    const payment = await payRequest({
      request: order.buyer_invoice,
      amount: order.amount.toString(),
    });
    const buyerUser = await User.findOne({ _id: order.buyer_id });
    if (!buyerUser) {
      logger.warn(
        `Can't find buyer user ${order.buyer_id} for order ${order._id}`
      );
    }
    // If the buyer's invoice is expired we let it know and don't try to pay again
    const i18nCtx = await getUserI18nContext(buyerUser || { lang: 'en' });
    if (!!payment && payment.is_expired && buyerUser) {
      await messages.expiredInvoiceOnPendingMessage(
        bot,
        buyerUser,
        order,
        i18nCtx
      );
      return;
    }
    const sellerUser = await User.findOne({ _id: order.seller_id });
    if (!sellerUser) {
      logger.warn(
        `Can't find seller user ${order.seller_id} for order ${order._id}`
      );
    }
    if (!!payment && !!payment.confirmed_at) {
      logger.info(`Order ${order._id} - Invoice with hash: ${payment.id} paid`);
      order.status = 'SUCCESS';
      order.routing_fee = payment.fee;

      await order.save();
      if (buyerUser && sellerUser) {
        await handleReputationItems(buyerUser, sellerUser, order.amount);
        await messages.buyerReceivedSatsMessage(
          bot,
          buyerUser,
          sellerUser,
          i18nCtx
        );
        await messages.rateUserMessage(bot, buyerUser, order, i18nCtx);
      }
    } else {
      if (buyerUser) {
        await messages.invoicePaymentFailedMessage(bot, buyerUser, i18nCtx);
        const pp = new PendingPayment({
          amount: order.amount,
          payment_request: order.buyer_invoice,
          user_id: buyerUser._id,
          description: order.description,
          hash: order.hash,
          order_id: order._id,
        });
        await pp.save();
      }
    }
  } catch (error) {
    logger.error(`payToBuyer catch: ${error?.toString()}`);
  }
};

const isPendingPayment = async (request: string) => {
  // Pending -> Sent to network, not yet confirmed
  try {
    return false;
  } catch (error) {
    const message = error?.toString();
    logger.error(`isPendingPayment catch error: ${message}`);
    return false;
  }
};

export { payRequest, payToBuyer, isPendingPayment };
