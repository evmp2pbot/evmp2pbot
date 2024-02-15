/* eslint-disable no-unreachable */
import { User, PendingPayment } from '../models';
import { handleReputationItems, getUserI18nContext } from '../util';
import * as messages from '../bot/messages';
import { logger } from '../logger';
import { IOrder } from '../models/order';
import { MainContext } from '../bot/start';
import { getAddressBalance } from './evm';
import { ethers } from 'ethers';
import { transferToken } from '../util/patchwallet';

const payRequest = async (order: IOrder) => {
  try {
    if (!order.hash || !order.secret) {
      throw new Error(`Order ${order._id.toString()} has no hash`);
    }
    const to = ethers.getAddress(order.buyer_invoice);
    const balance = await getAddressBalance(order.hash);
    let txHash = 'NONE';
    if (balance > 0) {
      const result = await transferToken({
        secret: order.secret,
        to,
        amount: balance,
      });
      if (result.txHash) {
        txHash = result.txHash;
      } else {
        txHash = 'USEROPHASH-' + result.userOpHash;
      }
    }
    return {
      is_expired: false,
      confirmed_at: new Date(),
      id: order.secret,
      secret: txHash,
      fee: 0,
    };
  } catch (error: any) {
    logger.error(
      `payRequest: ${error?.toString()}\n${JSON.stringify(
        error?.response.data || error?.stack
      )}`
    );
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
    const payment = await payRequest(order);
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
