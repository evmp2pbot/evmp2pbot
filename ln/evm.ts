import { logger } from '../logger';
import { IOrder } from '../models/order';
import { ensureEnv, lazyMemo } from '../util';
import {
  Contract,
  ContractEvent,
  JsonRpcProvider,
  Log,
  Provider,
  Result,
  ZeroAddress,
  ethers,
} from 'ethers';
import { GLOBAL_TRANSLATION_CONTEXT_GETTERS } from '../util/i18n';
import Escrow from './Escrow.json';
import EventEmitter from 'events';

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
export enum State {
  Open,
  Closed,
  Dispute,
}
export enum CloseReason {
  Release,
  RefundExpired,
  Refund,
  AdminRelease,
  AdminRefund,
}
const escrowContract = new Contract(ZeroAddress, Escrow);
const ESCROW_EVENTS = Object.fromEntries(
  ['Open', 'Close', 'Dispute']
    .map(x => escrowContract.getEvent(x))
    .map(x => [x.fragment.topicHash, x])
);
const ESCROW_ALL_FILTERS = [Object.keys(ESCROW_EVENTS)];

export const TOKEN_CONTRACT = ensureEnv('TOKEN_CONTRACT');
export let TOKEN_SYMBOL = '';
const EVM_PROVIDER_URL = ensureEnv('EVM_PROVIDER_URL');
const provider = new JsonRpcProvider(EVM_PROVIDER_URL, undefined, {
  pollingInterval: 30000,
});
const contract = new Contract(TOKEN_CONTRACT, erc20, provider);

type EventHandler = (event: ContractEvent, log: Log, result: Result) => void;

class EventMonitor extends EventEmitter {
  numListeners = 0;
  constructor(private readonly provider: Provider) {
    super();
    this.eventHandler = this.eventHandler.bind(this);
  }

  add(address: string, handler: EventHandler) {
    address = ethers.getAddress(address);
    if (this.numListeners === 0) {
      this.#start();
    }
    this.numListeners++;
    this.on(address, handler);
    let called = false;
    return () => {
      if (called) {
        return;
      }
      called = true;
      this.delete(address, handler);
    };
  }

  delete(address: string, handler: EventHandler) {
    address = ethers.getAddress(address);
    if (this.listenerCount(address, handler)) {
      this.off(address, handler);
      this.numListeners--;
      if (this.numListeners <= 0) {
        this.#stop();
      }
    }
  }

  #start() {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    this.provider.on(ESCROW_ALL_FILTERS, this.eventHandler).catch(() => {});
    logger.debug('TransferMonitor: Starting');
  }

  #stop() {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    this.provider.off(ESCROW_ALL_FILTERS, this.eventHandler).catch(() => {});
    logger.debug('TransferMonitor: Stopping');
  }

  private eventHandler(log: Log) {
    const event = ESCROW_EVENTS[log.topics[0]];
    if (!event) {
      logger.warn(`Unexpected event hash: ${log.topics[0]}`);
      return;
    }
    const decodedLog = escrowContract.interface.decodeEventLog(
      event.fragment,
      log.data,
      log.topics
    );
    logger.debug(
      `TransferMonitor: ${log.address} ${event.name} ${log.transactionHash}`
    );
    for (const address of [
      log.address,
      decodedLog.sender,
      decodedLog.beneficiary,
    ]) {
      if (!address) {
        logger.warn('Unexpected empty address');
        continue;
      }
      this.emit(ethers.getAddress(address), event, log, decodedLog);
    }
  }
}
export async function getOpenEscrow(beneficiary: string) {
  beneficiary = ethers.getAddress(beneficiary);
  const event = escrowContract.getEvent('Open');
  const pastLogs = await provider.getLogs({
    fromBlock: Math.max(1, (await provider.getBlockNumber()) - 86400),
    topics: [
      event.fragment.topicHash,
      ethers.zeroPadValue(TOKEN_CONTRACT, 32),
      null,
      ethers.zeroPadValue(beneficiary, 32),
    ],
  });
  const matchedLogs = [] as {
    event: ContractEvent;
    log: Log;
    result: Result;
  }[];
  for (const log of pastLogs) {
    const result = escrowContract.interface.decodeEventLog(
      event.fragment,
      log.data,
      log.topics
    );
    const state = await getEscrowState(log.address);
    if (state !== State.Open) {
      continue;
    }
    matchedLogs.push({ event, log, result });
  }
  return matchedLogs;
}
const getNumDecimals = lazyMemo(
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER,
  () => contract.decimals()
);
export async function getEscrowState(address: string): Promise<State> {
  return Number(
    await escrowContract
      .attach(address)
      .connect(provider)
      .getFunction('_state')
      .call({})
  );
}
export async function getEscrowCloseReason(address: string): Promise<CloseReason> {
  return Number(
    await escrowContract
      .attach(address)
      .connect(provider)
      .getFunction('_closeReason')
      .call({})
  );
}
function getTokenSymbol() {
  if (!TOKEN_SYMBOL) {
    TOKEN_SYMBOL = 'TOKEN';
    contract
      .symbol()
      .then(result => (TOKEN_SYMBOL = result))
      .catch(e => logger.error(`Failed to get token symbol: ${e?.toString()}`));
  }
  return TOKEN_SYMBOL;
}
GLOBAL_TRANSLATION_CONTEXT_GETTERS.push(() => ({
  tokenName: () => getTokenSymbol(),
  chainName: process.env.DISPLAY_CHAIN_NAME,
}));
setTimeout(getTokenSymbol, 15000);
export const eventMonitor = new EventMonitor(provider);
export const getOrderWei = async (order: IOrder) => {
  return ethers.parseUnits(order.amount.toString(), await getNumDecimals());
};
export const amountToDisplay = async (amount: bigint) => {
  return ethers.formatUnits(amount, await getNumDecimals());
};
