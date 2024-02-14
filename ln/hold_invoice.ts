import { randomBytes } from 'crypto';
import { logger } from '../logger';
import { getAddressFromSecret } from '../util/patchwallet';
import { Order } from '../models';
import { MainContext } from '../bot/start';
import { payHoldInvoice } from '.';

const createHoldInvoice = async ({
  description,
  amount,
}: {
  description: string;
  amount: string;
}) => {
  try {
    logger.info(`EVMTODO: createHoldInvoice ${amount} ${description}`);
    const secret = randomBytes(32).toString('hex');
    const address = await getAddressFromSecret(secret);
    return {
      request: address,
      hash: address,
      secret,
    };
  } catch (error) {
    logger.error(error);
  }
};

const settleHoldInvoice = async (bot: MainContext, { secret }: { secret: string }) => {
  try {
    logger.info(`EVMTODO: settleHoldInvoice ${secret}`);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      const order = await Order.findOne({ secret });
      if (!order) {
        console.error(`No order for secret ${secret.slice(0, 8)}...`);
        return;
      }
      logger.info(
        `Order ${
          order._id
        } - Invoice with hash: ${order._id.toString()} was settled!`
      );
      if (order.status === 'FROZEN' && order.is_frozen) {
        logger.info(
          `Order ${order._id} - Order was frozen by ${order.action_by}!`
        );
        return;
      }
      await payHoldInvoice(bot, order);
    }, 10000);
  } catch (error) {
    logger.error(error);
  }
};

const cancelHoldInvoice = async ({ hash }: { hash: string }) => {
  try {
    logger.info(`EVMTODO: cancelHoldInvoice ${hash}`);
  } catch (error) {
    logger.error(error);
  }
};

export { createHoldInvoice, settleHoldInvoice, cancelHoldInvoice };
