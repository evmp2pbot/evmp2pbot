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
    logger.debug(`createHoldInvoice ${amount} ${description}`);
    const secret = randomBytes(32).toString('hex');
    const address = await getAddressFromSecret(secret);
    return {
      request: address,
      hash: address,
      secret,
    };
  } catch (error) {
    logger.error(error);
    throw error;
  }
};

const settleHoldInvoice = async (
  bot: MainContext,
  { secret }: { secret: string }
) => {
  try {
    logger.debug(`settleHoldInvoice ${secret}`);
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
    }, 10);
  } catch (error) {
    logger.error(error);
  }
};

const cancellingHashes = new Set<string>();
const cancelHoldInvoice = async ({ hash }: { hash: string }) => {
  if (cancellingHashes.has(hash)) {
    return;
  }
  cancellingHashes.add(hash);
  try {
    logger.debug(`cancelHoldInvoice ${hash}`);
    if (!hash) {
      return;
    }
    /*
    eventMonitor.delete(hash);
    const order = await Order.findOne({ hash });
    if (!order) {
      logger.warn(`No order for escrow wallet ${hash}`);
      return;
    }
    const balance = await getAddressBalance(hash);
    if (balance <= 0n) {
      return;
    }
    const logs = await listEscrowWalletTx(hash);
    for (const log of logs) {
      if (!log.args) {
        continue;
      }
      logger.info(
        `Order ${order._id.toString()}: Refunding ${log.args.amount} wei to ${
          log.args.from
        }`
      );
      await transferToken({
        secret: order.secret,
        to: log.args.from,
        amount: log.args.amount,
      });
    }
    */
  } catch (error) {
    logger.error(error);
  } finally {
    cancellingHashes.delete(hash);
  }
};

export { createHoldInvoice, settleHoldInvoice, cancelHoldInvoice };
