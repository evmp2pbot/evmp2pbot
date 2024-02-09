import { randomBytes } from 'crypto';
import { logger } from '../logger';

const createHoldInvoice = async ({
  description,
  amount,
}: {
  description: string;
  amount: string;
}) => {
  try {
    logger.info(`EVMTODO: createHoldInvoice ${amount} ${description}`);
    const randomSecret = () => randomBytes(32);
    // We create a random secret
    const secret = randomSecret();
    // We sent back the response hash (id) to be used on testing
    return {
      request: `DUMMYREQUEST${amount}${randomSecret().toString('base64')}`,
      hash: `deadbeef${randomSecret().toString('hex')}`,
      secret: secret.toString('hex'),
    };
  } catch (error) {
    logger.error(error);
  }
};

const settleHoldInvoice = async ({ secret }: { secret: string }) => {
  try {
    logger.info(`EVMTODO: settleHoldInvoice ${secret}`);
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
