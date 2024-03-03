import express from 'express';
import bodyParser from 'body-parser';

import { EncryptJWT, SignJWT, jwtDecrypt } from 'jose';
import { ensureEnv } from '../util';
import { ethers } from 'ethers';
import axios, { AxiosError } from 'axios';
import { TOKEN_CONTRACT, TOKEN_SYMBOL } from './evm';
import { IOrder } from '../models/order';
import { logger } from '../logger';
import { Order } from '../models';
import { Telegraf } from 'telegraf';
import { MainContext } from '../bot/start';
import { CallbackQuery, Message } from 'telegraf/types';

const ISSUER = ensureEnv('EXTWALLET_JWT_ISSUER');
const AUDIENCE = ensureEnv('EXTWALLET_JWT_AUDIENCE');
const SUBJECT = ensureEnv('EXTWALLET_JWT_SUBJECT');
const KEY_STRING = ensureEnv('EXTWALLET_JWT_KEY');
const KEY = Buffer.from(KEY_STRING, 'hex');

const CALLBACK_URL = ensureEnv('EXTWALLET_CALLBACK_URL');
const REQUEST_PAYMENT_URL = ensureEnv('EXTWALLET_REQUEST_PAYMENT_URL');
const REQUEST_WALLET_ADDRESS_URL = ensureEnv(
  'EXTWALLET_REQUEST_WALLET_ADDRESS_URL'
);

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
async function decryptWalletRequestToken(
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

async function request(url: string, data: unknown) {
  return await axios
    .post(url, data, {
      headers: { Authorization: `Bearer ${await createToken()}` },
    })
    .catch(_e => {
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
  recipientAddress,
  amount,
}: {
  telegramId: string;
  recipientAddress: string;
  amount: string;
}) {
  // Validate amount
  ethers.parseEther(amount);
  return await request(REQUEST_PAYMENT_URL, {
    userTelegramID: telegramId,
    recipientAddress,
    tokenContract: TOKEN_CONTRACT,
    amount,
  });
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
    text: ""
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

const app = express();

// app.set('trust proxy', 1);

app.use(bodyParser.json({}));

let bot: Telegraf<MainContext>;

app.post('/:token', (req, res) => {
  res.json({ msg: 'It works!' });
  (async () => {
    if (!bot) {
      return;
    }
    const update = await decryptWalletRequestToken(req.params.token);
    if (!update) {
      return;
    }
    const walletAddress = req.body?.walletAddress;
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return;
    }
    const order = await Order.findById(update.id);
    if (!order) {
      return;
    }
    update.data = `extWalletRequestAddressResponse(${order._id},${walletAddress})`;
    await bot.handleUpdate({ update_id: 1, callback_query: update });
  })().catch(e =>
    logger.error(`Error when handling callback: ${e?.toString()} ${e?.stack}`)
  );
});

export function startCallbackServer(botInstance: Telegraf<MainContext>) {
  bot = botInstance;
  const port = parseInt(process.env.PORT || '') || 3000;
  const host = process.env.HOST || '0.0.0.0';

  app.listen(port, host, function () {
    logger.info(`Callback server listening on ${host}:${port}`);
  });
}
