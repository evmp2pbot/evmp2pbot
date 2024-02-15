import { MainContext } from '../bot/start';
import { logger } from '../logger';
import { Order } from '../models';
import { subscribeToTransfer } from './subscribe_invoice';

export const resubscribeInvoices = async (bot: MainContext) => {
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
      subscribeToTransfer(bot, order.hash, true);
      invoicesReSubscribed++;
    }
    logger.info(`Invoices resubscribed: ${invoicesReSubscribed}`);
  } catch (error) {
    logger.error(`ResubcribeInvoice catch: ${error?.toString()}`);
    return false;
  }
};
