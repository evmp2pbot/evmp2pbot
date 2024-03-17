import { Telegraf } from 'telegraf';
import { MainContext } from '../bot/start';
import { logger } from '../logger';
import { Order } from '../models';
import {
  subscribeToEscrowActions,
  subscribeToEscrowOpen,
} from './subscribe_invoice';

export const resubscribeInvoices = async (bot: Telegraf<MainContext>) => {
  try {
    let invoicesReSubscribed = 0;
    const pendingOrders = await Order.find({ status: 'WAITING_PAYMENT' });
    for (const order of pendingOrders) {
      if (!order.hash) {
        logger.warn(
          `Pending order without escrow wallet: ${order._id.toString()}`
        );
        continue;
      }
      subscribeToEscrowOpen({
        bot,
        orderId: order._id.toString(),
        buyerAddress: order.buyer_invoice,
        checkOpenEscrows: true,
      });
      invoicesReSubscribed++;
    }
    const activeOrders = await Order.find({
      $or: [{ status: 'ACTIVE' }, { status: 'FIAT_SENT' }],
    });
    for (const order of activeOrders) {
      if (!order.hash) {
        logger.warn(
          `Pending order without escrow wallet: ${order._id.toString()}`
        );
        continue;
      }
      if (!order.invoice_held_at) {
        continue;
      }
      subscribeToEscrowActions({
        bot,
        escrowAddress: order.hash,
        checkState: true,
      });
      invoicesReSubscribed++;
    }
    logger.info(`Invoices resubscribed: ${invoicesReSubscribed}`);
  } catch (error) {
    logger.error(`ResubcribeInvoice catch: ${error?.toString()}`);
    return false;
  }
};
