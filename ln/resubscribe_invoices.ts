import { logger } from '../logger';

const resubscribeInvoices = async () => {
  try {
    let invoicesReSubscribed = 0;
    // EVMTODO
    logger.info(`Invoices resubscribed: ${invoicesReSubscribed}`);
  } catch (error) {
    logger.error(`ResubcribeInvoice catch: ${error?.toString()}`);
    return false;
  }
};

export default resubscribeInvoices;
