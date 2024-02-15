import { logger } from '../logger';
import { IOrder } from '../models/order';
import { ensureEnv, lazyMemo } from '../util';
import { Contract, EventLog, JsonRpcProvider, ethers } from 'ethers';

const erc20 = [
  // Read-Only Functions
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',

  // Authenticated Functions
  'function transfer(address to, uint amount) returns (bool)',

  // Events
  'event Transfer(address indexed from, address indexed to, uint amount)',
];
class TransferMonitor {
  readonly #targets = new Map<string, (amount: bigint) => void>();
  constructor(private readonly contract: Contract) {
    this.eventHandler = this.eventHandler.bind(this);
  }

  add(address: string, handler: (amount: bigint) => void) {
    address = ethers.getAddress(address);
    if (this.#targets.size === 0) {
      this.#start();
    }
    this.#targets.set(address, handler);
  }

  delete(address: string) {
    address = ethers.getAddress(address);
    if (this.#targets.size === 0) {
      return;
    }
    this.#targets.delete(address);
    if (this.#targets.size === 0) {
      this.#stop();
    }
  }

  #start() {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    this.contract.on('Transfer', this.eventHandler);
    logger.debug('TransferMonitor: Starting');
  }

  #stop() {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    this.contract.off('Transfer', this.eventHandler);
    logger.debug('TransferMonitor: Stopping');
  }

  private eventHandler(_from: string, to: string, amount: bigint) {
    logger.debug(`TransferMonitor: ${_from} ${to} ${amount}`);
    const handler = this.#targets.get(ethers.getAddress(to));
    if (handler) {
      handler(BigInt(amount));
    }
  }
}
export const TOKEN_CONTRACT = ensureEnv('TOKEN_CONTRACT');
const EVM_PROVIDER_URL = ensureEnv('EVM_PROVIDER_URL');
const provider = new JsonRpcProvider(EVM_PROVIDER_URL, undefined, {
  pollingInterval: 30000,
});
const contract = new Contract(TOKEN_CONTRACT, erc20, provider);
const getNumDecimals = lazyMemo(
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER,
  () => contract.decimals()
);
export const transferMonitor = new TransferMonitor(contract);
export const getOrderWei = async (order: IOrder) => {
  return ethers.parseUnits(order.amount.toString(), await getNumDecimals());
};
export const amountToDisplay = async (amount: bigint) => {
  return ethers.formatUnits(amount, await getNumDecimals());
};
export async function getAddressBalance(address: string) {
  address = ethers.getAddress(address);
  return BigInt(await contract.balanceOf(address));
}
export async function encodeTransferTx(to: string, amountInWei: bigint) {
  to = ethers.getAddress(to);
  return (
    await contract.getFunction('transfer').populateTransaction(to, amountInWei)
  ).data;
}
export async function listEscrowWalletTx(address: string) {
  const transferIn = (await contract.queryFilter(
    contract.filters.Transfer(null, address)
  )) as EventLog[];
  const transferOut = (await contract.queryFilter(
    contract.filters.Transfer(address, null)
  )) as EventLog[];
  return transferIn.filter(log => {
    const index = transferOut.findIndex(
      x => x.args.to === log.args.from && x.args.amount === log.args.amount
    );
    if (index === -1) {
      return true;
    }
    transferOut.splice(index, 1);
    return false;
  });
}
