import { EncryptJWT, SignJWT, jwtDecrypt } from 'jose';
import { ensureEnv } from '../util';
import { ethers } from 'ethers';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { TOKEN_CONTRACT, TOKEN_SYMBOL } from './evm';
import { IOrder } from '../models/order';
import { MainContext } from '../bot/start';
import { CallbackQuery, Message } from 'telegraf/types';

const ISSUER = ensureEnv('EXTWALLET_JWT_ISSUER');
const AUDIENCE = ensureEnv('EXTWALLET_JWT_AUDIENCE');
const SUBJECT = ensureEnv('EXTWALLET_JWT_SUBJECT');
const KEY_STRING = ensureEnv('EXTWALLET_JWT_KEY');
const KEY = Buffer.from(KEY_STRING, 'hex');

const CALLBACK_URL = ensureEnv('EXTWALLET_CALLBACK_URL');
const REQUEST_PAYMENT_URL = ensureEnv('EXTWALLET_REQUEST_PAYMENT_URL');
const CHAIN_NAME = ensureEnv('BALANCE_CHAIN_NAME');
const REQUEST_WALLET_ADDRESS_URL = ensureEnv(
  'EXTWALLET_REQUEST_WALLET_ADDRESS_URL'
);
const REQUEST_GET_BALANCE_URL = ensureEnv('EXTWALLET_REQUEST_GET_BALANCE_URL');
const REQUEST_DATE_ADDED_URL = ensureEnv('EXTWALLET_REQUEST_DATE_ADDED_URL');

export class ExtWalletError extends Error {
  readonly error: string;
  readonly status: number;
  constructor({
    msg,
    error,
    status,
  }: {
    msg: string;
    error: string;
    status: number;
  }) {
    super(msg);
    this.error = error;
    this.status = status;
  }
}

async function createToken() {
  return await new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setSubject(SUBJECT)
    .setAudience(AUDIENCE)
    .setExpirationTime('15s')
    .sign(KEY);
}

const AUDIENCE_ORDER_ID = 'urn:evmp2pbot:wallet-request';
async function encryptWalletRequestToken(update: CallbackQuery.DataQuery) {
  return await new EncryptJWT()
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setSubject(JSON.stringify(update))
    .setAudience(AUDIENCE_ORDER_ID)
    .setExpirationTime('360s')
    .encrypt(KEY);
}
export async function decryptWalletRequestToken(
  token: string
): Promise<CallbackQuery.DataQuery | null> {
  try {
    const decrypted = await jwtDecrypt(token, KEY, {
      issuer: ISSUER,
      audience: AUDIENCE_ORDER_ID,
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    return JSON.parse(decrypted.payload.sub || 'null');
  } catch (e) {
    return null;
  }
}

async function request<T = any>(
  url: string,
  data: unknown,
  config?: Partial<AxiosRequestConfig>
) {
  return await axios<T>(url, {
    method: data ? 'POST' : 'GET',
    data,
    headers: { Authorization: `Bearer ${await createToken()}` },
    ...(config || {}),
  }).catch(_e => {
    const e = _e as AxiosError<any>;
    if (!e.isAxiosError || !e.response) {
      return Promise.reject(e);
    }
    return Promise.reject(
      new ExtWalletError({
        status: e.response.status,
        msg: e.response.data?.msg || 'Unknown error',
        error: e.response.data?.error || JSON.stringify(e.response.data),
      })
    );
  });
}

export async function requestPayment({
  telegramId,
  recipientTelegramID,
  amount,
  orderId,
}: {
  telegramId: string;
  recipientTelegramID: string;
  amount: string;
  orderId: string;
}) {
  // Validate amount
  ethers.parseEther(amount);
  return await request(REQUEST_PAYMENT_URL, {
    userTelegramID: telegramId,
    recipientTelegramID,
    tokenContract: TOKEN_CONTRACT,
    amount,
    message: `To pay ${amount} ${TOKEN_SYMBOL} for order ${orderId}`,
    withEscrow: true,
    escrowHoldSeconds:
      parseInt(process.env.HOLD_INVOICE_CLTV_DELTA || '144') * 10 * 60,
  });
}

export async function getBalance({ telegramId }: { telegramId: string }) {
  return await request<{
    assets: { contractAddress: string; balance: string }[];
  }>(REQUEST_GET_BALANCE_URL, undefined, {
    params: {
      userTelegramID: telegramId,
      chain: CHAIN_NAME,
    },
  }).then(result => {
    const assets = result.data.assets || [];
    return (
      assets.find(
        x => x.contractAddress?.toLowerCase() === TOKEN_CONTRACT.toLowerCase()
      )?.balance || '0'
    );
  });
}

export async function getDateAdded({ telegramId }: { telegramId: string }) {
  return await request<{
    dateAdded: string;
  }>(REQUEST_DATE_ADDED_URL, undefined, {
    params: {
      userTelegramID: telegramId,
    },
  }).then(result => new Date(result.data.dateAdded));
}

export async function requestWalletAddress({
  ctx,
  telegramId,
  order,
  message,
}: {
  ctx: MainContext;
  telegramId: string;
  order: IOrder;
  message: Message;
}) {
  const msg: Message = {
    message_id: message.message_id,
    from: message.from,
    chat: message.chat,
    date: message.date,
    text: '',
  };
  return await request(REQUEST_WALLET_ADDRESS_URL, {
    userTelegramID: telegramId,
    message: `To receive ${order.amount} ${TOKEN_SYMBOL} from order ${order._id}`,
    callbackUrl: `${CALLBACK_URL}/${await encryptWalletRequestToken({
      id: order._id?.toString(),
      chat_instance: String((ctx.update as any)?.chat_instance || ctx.chat?.id),
      from: ctx.from ||
        ctx.message?.from || {
          id: parseInt(order.buyer_id, 10),
          first_name: 'User',
          is_bot: false,
        },
      message: msg,
      data: '',
    })}`,
  });
}
