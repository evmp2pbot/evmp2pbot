import { TelegramError, Telegraf } from 'telegraf';
import {
  getCurrency,
  numberFormat,
  getDetailedOrder,
  secondsToTime,
  getOrderChannel,
  holdInvoiceExpirationInSecs,
  sanitizeMD,
  getEmojiRate,
  decimalRound,
  getUserAge,
  getStars,
  I18nFix,
  getUserI18nContext,
} from '../util';
import { logger } from '../logger';
import { MainContext } from './start';
import { IUser, UserDocument, UserReview2 } from '../models/user';
import { IOrder } from '../models/order';
import { I18nContext } from '@grammyjs/i18n';
import { IConfig } from '../models/config';
import { IPendingPayment } from '../models/pending_payment';
import { IFiat } from '../util/fiatModel';
import { ExtWalletError } from '../ln/extWallet';
import { Community, User } from '../models';
import { getTokenSymbol } from '../ln/evm';

const startMessage = async (ctx: MainContext) => {
  try {
    const holdInvoiceExpiration = holdInvoiceExpirationInSecs();
    const orderExpiration =
      (holdInvoiceExpiration.expirationTimeInSecs -
        holdInvoiceExpiration.safetyWindowInSecs) /
      60 /
      60;
    const disclaimer = ctx.i18n.t('disclaimer');
    const message = ctx.i18n.t('start', {
      orderExpiration: Math.floor(orderExpiration),
      channel: process.env.CHANNEL,
      disclaimer,
    });
    await ctx.reply(message);
  } catch (error) {
    logger.error(error);
  }
};

const initBotErrorMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser
) => {
  // Correct way to handle errors: https://github.com/telegraf/telegraf/issues/1757
  await bot.telegram
    .sendMessage(user.tg_id, ctx.i18n.t('init_bot_error'))
    .catch(error => {
      if (
        !(error instanceof TelegramError && error.response.error_code === 403)
      ) {
        logger.error(error);
      }
    });
};

const nonHandleErrorMessage = async (ctx: MainContext) => {
  try {
    const tgId = ctx.from?.id;
    if (tgId) {
      await ctx.telegram.sendMessage(tgId, ctx.i18n.t('non_handle_error'));
    } else {
      await ctx.reply(ctx.i18n.t('non_handle_error'));
    }
  } catch (error) {
    logger.error(error);
  }
};

const invoicePaymentRequestMessage = async (
  ctx: MainContext,
  user: IUser,
  request: string,
  order: IOrder,
  i18n: I18nContext,
  buyer: IUser
) => {
  try {
    const currencyObj = getCurrency(order.fiat_code);
    const currency =
      !!currencyObj && !!currencyObj.symbol_native
        ? currencyObj.symbol_native
        : order.fiat_code;
    const expirationTime =
      Number(process.env.HOLD_INVOICE_EXPIRATION_WINDOW) / 60;
    // We need the buyer rating
    const stars = getEmojiRate(buyer.total_rating);
    const roundedRating = decimalRound(buyer.total_rating, -1);
    const rate = `${roundedRating} ${stars} (${buyer.total_reviews})`;
    // Extracting the buyer's days in the platform
    const ageInDays = getUserAge(buyer);

    const message = i18n.t('invoice_payment_request', {
      currency,
      order,
      expirationTime,
      rate,
      days: ageInDays,
      trades: buyer.trades_completed,
    });
    await ctx.telegram.sendMessage(user.tg_id, message, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: i18n.t('extwallet_prompt_request_payment_button'),
              callback_data: `extWalletRequestPayment(${order._id})`,
            },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletPromptNotEnoughBalanceMessage = async (
  ctx: MainContext,
  user: IUser,
  balance: string | number,
  i18n: I18nContext
) => {
  try {
    const message = i18n.t('extwallet_prompt_not_enough_balance', { balance });
    await ctx.telegram.sendMessage(user.tg_id, message);
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletPromptNotActivatedMessage = async (
  ctx: MainContext,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    const message = i18n.t('extwallet_prompt_not_activated');
    await ctx.telegram.sendMessage(user.tg_id, message);
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletPaymentRequestSentMessage = async (
  ctx: MainContext,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    const message = i18n.t('extwallet_request_payment_sent');
    await ctx.telegram.sendMessage(user.tg_id, message);
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletAddressRequestSentMessage = async (
  ctx: MainContext,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    const message = i18n.t('extwallet_request_wallet_sent');
    return await ctx.telegram.sendMessage(user.tg_id, message);
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletAddressReceivedMessage = async (
  ctx: MainContext,
  user: IUser,
  address: string,
  i18n: I18nContext
) => {
  try {
    const message = i18n.t('extwallet_received_address', { address });
    return await ctx.telegram.sendMessage(user.tg_id, message);
  } catch (error) {
    logger.error(error);
  }
};

const pendingSellMessage = async (
  ctx: MainContext | Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  channel: string,
  i18n: I18nContext
) => {
  try {
    const orderExpirationWindow =
      Number(process.env.ORDER_PUBLISHED_EXPIRATION_WINDOW) / 60 / 60;
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('pending_sell', {
        channel,
        orderExpirationWindow: Math.round(orderExpirationWindow),
        link: `<a href="https://t.me/${
          ctx.botInfo?.username
        }/order?startapp=${order._id?.toString()}">Buy ${
          order.amount
        } $${getTokenSymbol()} for ${numberFormat(
          order.fiat_code,
          order.fiat_amount
        )} ${order.fiat_code}</a>`,
      }),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: i18n.t('cancel_order'),
                callback_data: `cancel ${order._id?.toString()}`,
              },
            ],
            [
              {
                text: 'Send order to chat',
                switch_inline_query_chosen_chat: {
                  query: order._id?.toString(),
                  allow_bot_chats: false,
                  allow_channel_chats: true,
                  allow_user_chats: true,
                  allow_group_chats: true,
                },
              },
            ],
          ],
        },
      }
    );
  } catch (error) {
    logger.error(error);
  }
};

const pendingBuyMessage = async (
  ctx: MainContext | Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  channel: string,
  i18n: I18nContext
) => {
  try {
    const orderExpirationWindow =
      Number(process.env.ORDER_PUBLISHED_EXPIRATION_WINDOW) / 60 / 60;
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('pending_buy', {
        channel,
        orderExpirationWindow: Math.round(orderExpirationWindow),
        link: `<a href="https://t.me/${
          ctx.botInfo?.username
        }?/order?startapp=${order._id?.toString()}">Sell ${
          order.amount
        } $${getTokenSymbol()} for ${numberFormat(
          order.fiat_code,
          order.fiat_amount
        )} ${order.fiat_code}</a>`,
      }),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: i18n.t('cancel_order'),
                callback_data: `cancel ${order._id?.toString()}`,
              },
            ],
            [
              {
                text: 'Send order to chat',
                switch_inline_query_chosen_chat: {
                  query: order._id?.toString(),
                  allow_bot_chats: false,
                  allow_channel_chats: true,
                  allow_user_chats: true,
                  allow_group_chats: true,
                },
              },
            ],
          ],
        },
      }
    );
  } catch (error) {
    logger.error(error);
  }
};

const sellOrderCorrectFormatMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('sell_correct_format'), {
      parse_mode: 'MarkdownV2',
    });
  } catch (error) {
    logger.error(error);
  }
};

const buyOrderCorrectFormatMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('buy_correct_format'), {
      parse_mode: 'MarkdownV2',
    });
  } catch (error) {
    logger.error(error);
  }
};

const minimunAmountInvoiceMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(
      ctx.i18n.t('min_invoice_amount', {
        minPaymentAmount: process.env.MIN_PAYMENT_AMT,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const minimunExpirationTimeInvoiceMessage = async (ctx: MainContext) => {
  try {
    const expirationTime =
      Number(process.env.INVOICE_EXPIRATION_WINDOW) / 60 / 1000;
    await ctx.reply(ctx.i18n.t('min_expiration_time', { expirationTime }));
  } catch (error) {
    logger.error(error);
  }
};

const expiredInvoiceMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_expired'));
  } catch (error) {
    logger.error(error);
  }
};

const expiredInvoiceOnPendingMessage = async (
  bot: MainContext,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(user.tg_id, i18n.t('invoice_expired_long'));
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('setinvoice_cmd_order', { orderId: order._id }),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    logger.error(error);
  }
};

const requiredAddressInvoiceMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_require_destination'));
  } catch (error) {
    logger.error(error);
  }
};

const invoiceMustBeLargerMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(
      ctx.i18n.t('invoice_must_be_larger_error', {
        minInvoice: process.env.MIN_PAYMENT_AMT,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const invoiceExpiryTooShortMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_expiry_too_short_error'));
  } catch (error) {
    logger.error(error);
  }
};

const invoiceHasExpiredMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_has_expired_error'));
  } catch (error) {
    logger.error(error);
  }
};

const invoiceHasWrongDestinationMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_has_wrong_destination_error'));
  } catch (error) {
    logger.error(error);
  }
};

const requiredHashInvoiceMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_require_hash'));
  } catch (error) {
    logger.error(error);
  }
};

const invoiceInvalidMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_invalid_error'));
  } catch (error) {
    logger.error(error);
  }
};

const invalidOrderMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser
) => {
  try {
    await bot.telegram.sendMessage(user.tg_id, ctx.i18n.t('order_id_invalid'));
  } catch (error) {
    logger.error(error);
  }
};

const invalidTypeOrderMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser,
  type: IOrder['type']
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('order_invalid_type', { type })
    );
  } catch (error) {
    logger.error(error);
  }
};

const alreadyTakenOrderMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('order_already_taken')
    );
  } catch (error) {
    logger.error(error);
  }
};

const invalidDataMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser
) => {
  try {
    await bot.telegram.sendMessage(user.tg_id, ctx.i18n.t('invalid_data'));
  } catch (error) {
    logger.error(error);
  }
};

export const extWalletErrorMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  type: 'buy' | 'sell',
  user: IUser,
  error: Error
) => {
  let errorCode = 'generic';
  if (
    error instanceof ExtWalletError &&
    ['user_not_found', 'not_enough_token'].includes(error.error)
  ) {
    errorCode = error.error;
  } else {
    logger.error(
      `extWalletErrorMessage: ${error.message} ${(error as any).error}`
    );
  }
  try {
    return await bot.telegram.sendMessage(
      user.tg_id,
      `${ctx.i18n.t(`extwallet_error_${errorCode}`)}, ${ctx.i18n.t(
        `extwallet_error_${type}_suggestion`
      )}`
    );
  } catch (error) {
    logger.error(error);
  }
};

const genericErrorMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(user.tg_id, i18n.t('generic_error'));
  } catch (error) {
    logger.error(error);
  }
};

const beginTakeBuyMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  seller: IUser,
  order: IOrder
) => {
  try {
    const expirationTime =
      Number(process.env.HOLD_INVOICE_EXPIRATION_WINDOW) / 60;
    await bot.telegram.sendMessage(
      seller.tg_id,
      ctx.i18n.t('begin_take_buy', { expirationTime })
    );
    await bot.telegram.sendMessage(seller.tg_id, order._id.toString(), {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: ctx.i18n.t('continue'),
              callback_data: 'showHoldInvoiceBtn',
            },
            {
              text: ctx.i18n.t('cancel'),
              callback_data: 'cancelShowHoldInvoiceBtn',
            },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

const showHoldInvoiceMessage = async (
  ctx: MainContext,
  request: string,
  amount: number,
  fiatCode: IOrder['fiat_code'],
  fiatAmount: IOrder['fiat_amount'],
  order: IOrder
) => {
  try {
    const currencyObj = getCurrency(fiatCode);
    let currency =
      !!currencyObj && !!currencyObj.symbol_native
        ? currencyObj.symbol_native
        : fiatCode;
    await ctx.telegram.sendMessage(
      ctx.user.tg_id,
      ctx.i18n.t('pay_invoice', {
        amount: numberFormat(fiatCode, amount),
        fiatAmount: numberFormat(fiatCode, fiatAmount),
        currency,
      }),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ctx.i18n.t('extwallet_prompt_request_payment_button'),
                callback_data: `extWalletRequestPayment(${order._id})`,
              },
            ],
          ],
        },
      }
    );
  } catch (error) {
    logger.error(error);
  }
};

const onGoingTakeBuyMessage = async (
  bot: Telegraf<MainContext>,
  seller: IUser,
  buyer: IUser,
  order: IOrder,
  i18nBuyer: I18nContext,
  i18nSeller: I18nContext,
  rate: string
) => {
  try {
    await bot.telegram.sendMessage(
      seller.tg_id,
      i18nSeller.t('payment_received')
    );
    const holdInvoiceExpiration = holdInvoiceExpirationInSecs();
    const orderExpiration =
      holdInvoiceExpiration.expirationTimeInSecs -
      holdInvoiceExpiration.safetyWindowInSecs;
    const time = secondsToTime(orderExpiration);
    let expirationTime = time.hours + ' ' + i18nBuyer.t('hours');
    expirationTime +=
      time.minutes > 0 ? ' ' + time.minutes + ' ' + i18nBuyer.t('minutes') : '';
    // Extracting the buyer's days in the platform
    const ageInDays = getUserAge(seller);
    await bot.telegram.sendMessage(
      buyer.tg_id,
      i18nBuyer.t('someone_took_your_order', {
        expirationTime,
        rate,
        days: ageInDays,
      })
    );
    await bot.telegram.sendMessage(buyer.tg_id, order._id.toString(), {
      reply_markup: {
        inline_keyboard: [
          [{ text: i18nBuyer.t('continue'), callback_data: 'addInvoiceBtn' }],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

const beginTakeSellMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  buyer: IUser,
  order: IOrder
) => {
  try {
    const holdInvoiceExpiration = holdInvoiceExpirationInSecs();
    const orderExpiration =
      holdInvoiceExpiration.expirationTimeInSecs -
      holdInvoiceExpiration.safetyWindowInSecs;
    const time = secondsToTime(orderExpiration);
    let expirationTime = time.hours + ' ' + ctx.i18n.t('hours');
    expirationTime +=
      time.minutes > 0 ? ' ' + time.minutes + ' ' + ctx.i18n.t('minutes') : '';
    await bot.telegram.sendMessage(
      buyer.tg_id,
      ctx.i18n.t('you_took_someone_order', { expirationTime, order }),
      { parse_mode: 'MarkdownV2' }
    );
    await bot.telegram.sendMessage(buyer.tg_id, order._id.toString(), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: ctx.i18n.t('accept'), callback_data: 'addInvoiceBtn' },
            {
              text: ctx.i18n.t('cancel'),
              callback_data: 'cancelAddInvoiceBtn',
            },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

const onGoingTakeSellMessage = async (
  bot: Telegraf<MainContext>,
  sellerUser: IUser,
  buyerUser: IUser,
  order: IOrder,
  i18nBuyer: I18nContext,
  i18nSeller: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      buyerUser.tg_id,
      i18nBuyer.t('get_in_touch_with_seller', {
        orderId: order.id,
        currency: order.fiat_code,
        sellerUsername: sellerUser.username,
        fiatAmount: numberFormat(order.fiat_code, order.fiat_amount),
        paymentMethod: order.payment_method,
        order,
      })
    );
    await bot.telegram.sendMessage(
      buyerUser.tg_id,
      i18nBuyer.t('fiatsent_order_cmd'),
      { parse_mode: 'MarkdownV2' }
    );
    await bot.telegram.sendMessage(
      sellerUser.tg_id,
      i18nSeller.t('buyer_took_your_order', {
        orderId: order.id,
        order,
        fiatAmount: order.fiat_amount,
        paymentMethod: order.payment_method,
        currency: order.fiat_code,
        buyerUsername: buyerUser.username,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

export const receivedLessTokenThanExpectedMessage = async (
  bot: MainContext,
  diff: string,
  sellerUser: IUser,
  order: IOrder,
  i18nSeller: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      sellerUser.tg_id,
      i18nSeller.t('received_less_than_expected', {
        amount: order.amount,
        orderId: order._id,
        diff,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const takeSellWaitingSellerToPayMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  buyerUser: IUser,
  order: IOrder
) => {
  try {
    await bot.telegram.sendMessage(
      buyerUser.tg_id,
      ctx.i18n.t('waiting_seller_to_pay', { orderId: order._id, order })
    );
  } catch (error) {
    logger.error(error);
  }
};

const releasedSatsMessage = async (
  bot: MainContext,
  order: IOrder,
  sellerUser: IUser,
  buyerUser: IUser,
  i18nBuyer: I18nContext,
  i18nSeller: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      sellerUser.tg_id,
      i18nSeller.t('sell_success', { buyerUsername: buyerUser.username, order })
    );
    await bot.telegram.sendMessage(
      buyerUser.tg_id,
      i18nBuyer.t('funds_released', {
        sellerUsername: sellerUser.username,
        order,
      }),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    logger.error(error);
  }
};

const rateUserMessage = async (
  bot: MainContext,
  caller: UserDocument,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    const targetId =
      order.buyer_id === caller._id.toString()
        ? order.seller_id
        : order.buyer_id;
    const targetUser = await User.findOne({ _id: targetId });
    const existingReview = await UserReview2.findOne({
      source: caller._id,
      target: targetId,
    });
    const starButtons = [];
    for (let num = 5; num > 0; num--) {
      starButtons.push([
        {
          text: (!existingReview || existingReview.rating !== num
            ? '⭐'
            : '🌟'
          ).repeat(num),
          callback_data: `showStarBtn(${num},${order._id})`,
        },
      ]);
    }
    await bot.telegram.sendMessage(
      caller.tg_id,
      i18n.t(
        existingReview ? 'rate_counterpart_exist' : 'rate_counterpart_new',
        {
          username: targetUser?.username,
        }
      ),
      {
        reply_markup: {
          inline_keyboard: starButtons,
        },
      }
    );
  } catch (error) {
    logger.error(error);
  }
};

const notActiveOrderMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('cant_process_order'));
  } catch (error) {
    logger.error(error);
  }
};

const waitingForBuyerOrderMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('cant_release_order'));
  } catch (error) {
    logger.error(error);
  }
};

const notOrderMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('no_id_related'));
  } catch (error) {
    logger.error(error);
  }
};

const publishBuyOrderMessage = async (
  ctx: MainContext | Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext,
  messageToUser?: boolean
) => {
  try {
    let publishMessage = `${i18n.t('offer_header', { id: order._id })}\n${
      order.description
    }`;
    if (order.status !== 'PENDING') {
      publishMessage = `<del>${publishMessage}</del>`;
      if (order.taken_at) {
        publishMessage += `\n<i>Order taken at ${new Date(
          order.taken_at
        ).toUTCString()}</i>`;
      } else if (order.status === 'CANCELED') {
        publishMessage += `\n<i>Order cancelled at ${new Date().toUTCString()}</i>`;
      }
    }

    const channel = await getOrderChannel(order);
    if (!channel) {
      logger.error(`Channel not found for order ${order._id}`);
      return;
    }
    const replyMarkup =
      order.status === 'PENDING'
        ? {
            inline_keyboard: [
              [
                {
                  text: i18n.t('sell_sats', {
                    amount: order.amount,
                    fiatAmount: order.fiat_amount,
                    currency: order.fiat_code,
                  }),
                  callback_data: 'takebuy',
                },
              ],
            ],
          }
        : undefined;

    if (order.tg_channel_message1) {
      try {
        await ctx.telegram.editMessageText(
          channel,
          Number(order.tg_channel_message1),
          undefined,
          publishMessage,
          {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          }
        );
      } catch (e) {
        logger.warn(
          `Failed to edit message for order ${order._id}, sending new one`
        );
        order.tg_channel_message1 = null;
      }
    }
    if (!order.tg_channel_message1) {
      // We send the message to the channel
      const message1 = await ctx.telegram.sendMessage(channel, publishMessage, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
      // We save the id of the message in the order
      order.tg_channel_message1 =
        message1 && message1.message_id.toString()
          ? message1.message_id.toString()
          : null;
    }
    await order.save();
    if (messageToUser) {
      // Message to user let know the order was published
      await pendingBuyMessage(ctx, user, order, channel, i18n);
    }
  } catch (error) {
    logger.error(error);
  }
};

const publishSellOrderMessage = async (
  ctx: MainContext | Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext,
  messageToUser?: boolean
) => {
  try {
    let publishMessage = `${i18n.t('offer_header', { id: order._id })}\n${
      order.description
    }`;
    if (order.status !== 'PENDING') {
      publishMessage = `<del>${publishMessage}</del>`;
      if (order.taken_at) {
        publishMessage += `\n<i>Order taken at ${new Date(
          order.taken_at
        ).toUTCString()}</i>`;
      } else if (order.status === 'CANCELED') {
        publishMessage += `\n<i>Order cancelled at ${new Date().toUTCString()}</i>`;
      }
    }
    const channel = await getOrderChannel(order);
    if (!channel) {
      logger.error(`Channel not found for order ${order._id}`);
      return;
    }
    const replyMarkup =
      order.status === 'PENDING'
        ? {
            inline_keyboard: [
              [
                {
                  text: i18n.t('buy_sats', {
                    amount: order.amount,
                    fiatAmount: order.fiat_amount,
                    currency: order.fiat_code,
                  }),
                  callback_data: 'takesell',
                },
              ],
            ],
          }
        : undefined;
    if (order.tg_channel_message1) {
      try {
        await ctx.telegram.editMessageText(
          channel,
          Number(order.tg_channel_message1),
          undefined,
          publishMessage,
          {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          }
        );
      } catch (e) {
        logger.warn(
          `Failed to edit message for order ${order._id}, sending new one`
        );
        order.tg_channel_message1 = null;
      }
    }
    if (!order.tg_channel_message1) {
      // We send the message to the channel
      const message1 = await ctx.telegram.sendMessage(channel, publishMessage, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
      // We save the id of the message in the order
      order.tg_channel_message1 =
        message1 && message1.message_id.toString()
          ? message1.message_id.toString()
          : null;
    }

    await order.save();
    // Message to user let know the order was published
    if (messageToUser)
      await pendingSellMessage(ctx, user, order, channel, i18n);
  } catch (error) {
    logger.error(error);
  }
};

export const deleteOrderFromChannel = async (
  order: IOrder,
  bot: Telegraf<MainContext>
) => {
  try {
    let channel = process.env.CHANNEL;
    if (order.community_id) {
      const community = await Community.findOne({ _id: order.community_id });
      if (!community) {
        return channel;
      }
      if (community.order_channels.length === 1) {
        channel = community.order_channels[0].name;
      } else {
        for await (const c of community.order_channels) {
          if (c.type === order.type) {
            channel = c.name;
          }
        }
      }
    }
    if (order.status === 'PENDING') {
      order.status = 'CANCELED';
    }
    if (!order.tg_channel_message1) {
      return;
    }
    if (order.type === 'buy') {
      await publishBuyOrderMessage(
        bot,
        new User(),
        order,
        await getUserI18nContext({ lang: 'en' })
      );
    } else {
      await publishSellOrderMessage(
        bot,
        new User(),
        order,
        await getUserI18nContext({ lang: 'en' })
      );
    }
  } catch (error) {
    logger.error(error);
  }
};

const customMessage = async (ctx: MainContext, message: string) => {
  try {
    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
  } catch (error) {
    logger.error(error);
  }
};

const checkOrderMessage = async (
  ctx: MainContext,
  order: IOrder,
  buyer: UserDocument,
  seller: UserDocument
) => {
  try {
    let message = getDetailedOrder(
      ctx.i18n as unknown as I18nFix,
      order,
      buyer,
      seller
    );
    if (!message) {
      console.warn('getDetailedOrder returned no message');
      return;
    }
    message += `\n\n`;
    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
  } catch (error) {
    logger.error(error);
  }
};

const checkInvoiceMessage = async (
  ctx: MainContext,
  isConfirmed: boolean,
  isCanceled: boolean,
  isHeld: boolean
) => {
  try {
    if (isConfirmed) {
      return await ctx.reply(ctx.i18n.t('invoice_settled'));
    }
    if (isCanceled) {
      return await ctx.reply(ctx.i18n.t('invoice_cancelled'));
    }
    if (isHeld) {
      return await ctx.reply(ctx.i18n.t('invoice_held'));
    }

    return await ctx.reply(ctx.i18n.t('invoice_no_info'));
  } catch (error) {
    logger.error(error);
  }
};

const mustBeValidCurrency = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('must_be_valid_currency'));
  } catch (error) {
    logger.error(error);
  }
};

const mustBeANumberOrRange = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('must_be_number_or_range'));
  } catch (error) {
    logger.error(error);
  }
};

const invalidLightningAddress = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invalid_lightning_address'));
  } catch (error) {
    logger.error(error);
  }
};

const unavailableLightningAddress = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser,
  la: string
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('unavailable_lightning_address', { la })
    );
  } catch (error) {
    logger.error(error);
  }
};

const helpMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('help'), { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error(error);
  }
};

const disclaimerMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('disclaimer'), { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error(error);
  }
};

const mustBeGreatherEqThan = async (
  ctx: MainContext,
  fieldName: string,
  qty: number
) => {
  try {
    await ctx.reply(
      ctx.i18n.t('must_be_gt_or_eq', {
        fieldName,
        qty,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const bannedUserErrorMessage = async (ctx: MainContext, user: IUser) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('you_have_been_banned')
    );
  } catch (error) {
    logger.error(error);
  }
};

export const runStartFirstMessage = async (ctx: MainContext) => {
  try {
    const tgId = ctx.from?.id;
    if (tgId) {
      await ctx.telegram.sendMessage(tgId, ctx.i18n.t('run_start_first'));
    } else {
      await ctx.reply(ctx.i18n.t('run_start_first'));
    }
  } catch (error) {
    logger.error(error);
  }
};

const fiatSentMessages = async (
  ctx: MainContext,
  order: IOrder,
  buyer: IUser,
  seller: IUser,
  i18nBuyer: I18nContext,
  i18nSeller: I18nContext
) => {
  try {
    await ctx.telegram.sendMessage(
      buyer.tg_id,
      i18nBuyer.t('I_told_seller_you_sent_fiat', {
        sellerUsername: seller.username,
        order,
      }),
      { parse_mode: 'MarkdownV2' }
    );
    await ctx.telegram.sendMessage(
      seller.tg_id,
      i18nSeller.t('buyer_told_me_that_sent_fiat', {
        buyerUsername: buyer.username,
        order,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const orderOnfiatSentStatusMessages = async (ctx: MainContext, user: IUser) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('you_have_orders_waiting')
    );
  } catch (error) {
    logger.error(error);
  }
};

const userBannedMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('user_banned'));
  } catch (error) {
    logger.error(error);
  }
};

const userUnBannedMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('user_unbanned'));
  } catch (error) {
    logger.error(error);
  }
};

const notFoundUserMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('user_not_found'));
  } catch (error) {
    logger.error(error);
  }
};

const errorParsingInvoiceMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('parse_invoice_error'));
  } catch (error) {
    logger.error(error);
  }
};

const notValidIdMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invalid_id'));
  } catch (error) {
    logger.error(error);
  }
};

const addInvoiceMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  buyer: IUser,
  seller: IUser,
  order: IOrder
) => {
  try {
    await bot.telegram.sendMessage(
      buyer.tg_id,
      ctx.i18n.t('get_in_touch_with_seller', {
        orderId: order.id,
        currency: order.fiat_code,
        sellerUsername: seller.username,
        fiatAmount: numberFormat(order.fiat_code, order.fiat_amount),
        paymentMethod: order.payment_method,
        order,
      })
    );
    await bot.telegram.sendMessage(
      buyer.tg_id,
      ctx.i18n.t('fiatsent_order_cmd'),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    logger.error(error);
  }
};

const sendBuyerInfo2SellerMessage = async (
  bot: Telegraf<MainContext>,
  buyer: IUser,
  seller: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      seller.tg_id,
      i18n.t('get_in_touch_with_buyer', {
        currency: order.fiat_code,
        orderId: order.id,
        order,
        buyerUsername: buyer.username,
        fiatAmount: numberFormat(order.fiat_code, order.fiat_amount),
        paymentMethod: order.payment_method,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const cantTakeOwnOrderMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('cant_take_own_order')
    );
  } catch (error) {
    logger.error(error);
  }
};

const notLightningInvoiceMessage = async (ctx: MainContext, order: IOrder) => {
  try {
    await ctx.reply(ctx.i18n.t('send_me_lninvoice', { amount: order.amount }));
    await ctx.reply(
      ctx.i18n.t('setinvoice_cmd_order', { orderId: order._id }),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    logger.error(error);
  }
};

const notOrdersMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('you_have_no_orders'));
  } catch (error) {
    logger.error(error);
  }
};

const notRateForCurrency = async (
  bot: MainContext,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('not_rate_for_currency', {
        fiatRateProvider: process.env.FIAT_RATE_NAME,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const incorrectAmountInvoiceMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_with_incorrect_amount'));
  } catch (error) {
    logger.error(error);
  }
};

const invoiceUpdatedMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_updated'));
  } catch (error) {
    logger.error(error);
  }
};

const invoiceUpdatedPaymentWillBeSendMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_updated_and_will_be_paid'));
  } catch (error) {
    logger.error(error);
  }
};

const invoiceAlreadyUpdatedMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invoice_already_being_paid'));
  } catch (error) {
    logger.error(error);
  }
};
const successSetAddress = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('lightning_address_saved'));
  } catch (error) {
    logger.error(error);
  }
};

const badStatusOnCancelOrderMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('cancel_error'));
  } catch (error) {
    logger.error(error);
  }
};

const successCancelOrderMessage = async (
  ctx: Telegraf<MainContext> | MainContext,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('cancel_success', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const counterPartyCancelOrderMessage = async (
  ctx: MainContext | Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('order_cancelled_by_counterparty', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const successCancelAllOrdersMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('cancelall_success'));
  } catch (error) {
    logger.error(error);
  }
};

const successCancelOrderByAdminMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('order_cancelled_by_admin', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const successCompleteOrderMessage = async (ctx: MainContext, order: IOrder) => {
  try {
    await ctx.reply(ctx.i18n.t('order_completed', { orderId: order._id }));
  } catch (error) {
    logger.error(error);
  }
};

const successCompleteOrderByAdminMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('order_completed_by_admin', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const shouldWaitCooperativeCancelMessage = async (
  ctx: MainContext,
  user: IUser
) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('have_to_wait_for_counterpart')
    );
  } catch (error) {
    logger.error(error);
  }
};

const okCooperativeCancelMessage = async (
  ctx: MainContext,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('ok_cooperativecancel', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const refundCooperativeCancelMessage = async (
  ctx: MainContext | Telegraf<MainContext>,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('refund_cooperativecancel')
    );
  } catch (error) {
    logger.error(error);
  }
};

const initCooperativeCancelMessage = async (
  ctx: MainContext,
  order: IOrder
) => {
  try {
    await ctx.reply(
      ctx.i18n.t('init_cooperativecancel', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const counterPartyWantsCooperativeCancelMessage = async (
  ctx: MainContext,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('counterparty_wants_cooperativecancel', { orderId: order._id })
    );
    await ctx.telegram.sendMessage(
      user.tg_id,
      i18n.t('cancel_order_cmd', { orderId: order._id }),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    logger.error(error);
  }
};

const invoicePaymentFailedMessage = async (
  bot: MainContext,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('invoice_payment_failed', {
        pendingPaymentWindow: process.env.PENDING_PAYMENT_WINDOW,
        attempts: process.env.PAYMENT_ATTEMPTS,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const userCantTakeMoreThanOneWaitingOrderMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('cant_take_more_orders')
    );
  } catch (error) {
    logger.error(error);
  }
};

const sellerPaidHoldMessage = async (ctx: MainContext, user: IUser) => {
  try {
    await ctx.telegram.sendMessage(user.tg_id, ctx.i18n.t('seller_released'));
  } catch (error) {
    logger.error(error);
  }
};

const showInfoMessage = async (
  ctx: MainContext,
  user: IUser,
  config?: IConfig
) => {
  try {
    // user info
    const volume_traded = sanitizeMD(user.volume_traded.toString());
    const total_rating = user.total_rating;
    const disputes = user.disputes;
    let ratingText = '';
    if (total_rating) {
      ratingText = getStars(total_rating, user.total_reviews);
    }
    ratingText = sanitizeMD(ratingText);
    const user_info = ctx.i18n.t('user_info', {
      volume_traded,
      total_rating: ratingText,
      disputes,
    });

    // node info
    const status = config?.node_status == 'up' ? '🟢' : '🔴';
    const node_uri = sanitizeMD(config?.node_uri ?? '<unknown>');
    let bot_fee = (Number(process.env.MAX_FEE) * 100).toString() + '%';
    bot_fee = bot_fee.replace('.', '\\.');
    let routing_fee =
      (Number(process.env.MAX_ROUTING_FEE) * 100).toString() + '%';
    routing_fee = routing_fee.replace('.', '\\.');
    await ctx.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('bot_info', {
        bot_fee,
        routing_fee,
        status,
        node_uri,
        user_info,
      }),
      {
        parse_mode: 'MarkdownV2',
      }
    );
  } catch (error) {
    logger.error(error);
  }
};

const buyerReceivedSatsMessage = async (
  bot: MainContext,
  buyerUser: IUser,
  sellerUser: IUser,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      buyerUser.tg_id,
      i18n.t('your_purchase_is_completed', {
        sellerUsername: sellerUser.username,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const listCurrenciesResponse = async (
  ctx: MainContext,
  currencies: Array<IFiat>
) => {
  try {
    let response = `Code |   Name   |\n`;
    currencies.forEach(currency => {
      response += `${currency.code} | ${currency.name} | ${currency.emoji}\n`;
    });
    await ctx.reply(response);
  } catch (error) {
    logger.error(error);
  }
};

const priceApiFailedMessage = async (
  ctx: MainContext,
  bot: Telegraf<MainContext>,
  user: IUser
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      ctx.i18n.t('problem_getting_price')
    );
  } catch (error) {
    logger.error(error);
  }
};

const updateUserSettingsMessage = async (
  ctx: MainContext,
  field: string,
  newState: string
) => {
  try {
    await ctx.reply(
      ctx.i18n.t('update_user_setting', {
        field,
        newState,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const disableLightningAddress = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('lightning_address_disabled'));
  } catch (error) {
    logger.error(error);
  }
};

const invalidRangeWithAmount = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('invalid_range_with_amount'));
  } catch (error) {
    logger.error(error);
  }
};

const tooManyPendingOrdersMessage = async (
  ctx: MainContext,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    ctx.telegram
      .sendMessage(user.tg_id, i18n.t('too_many_pending_orders'))
      .catch(e => logger.error(e));
  } catch (error) {
    logger.error(error);
  }
};

const wizardAddInvoiceInitMessage = async (
  ctx: MainContext,
  order: IOrder,
  currency: string,
  expirationTime: number
) => {
  try {
    await ctx.sendMessage(
      ctx.i18n.t('wizard_add_invoice_init', {
        expirationTime,
        satsAmount: numberFormat(order.fiat_code, order.amount),
        currency,
        fiatAmount: numberFormat(order.fiat_code, order.fiat_amount),
      }),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: ctx.i18n.t('extwallet_prompt_request_wallet_button'),
                callback_data: `extWalletRequestAddress(${order._id})`,
              },
            ],
          ],
        },
      }
    );
  } catch (error) {
    logger.error(error);
  }
};

const wizardAddInvoiceExitMessage = async (ctx: MainContext, order: IOrder) => {
  try {
    await ctx.reply(
      ctx.i18n.t('wizard_add_invoice_exit', {
        amount: numberFormat(order.fiat_code, order.amount),
        orderId: order._id,
      }),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    logger.error(error);
  }
};

const wizardExitMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('wizard_exit'));
  } catch (error) {
    logger.error(error);
  }
};

const orderExpiredMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('order_expired'));
  } catch (error) {
    logger.error(error);
  }
};

const cantAddInvoiceMessage = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('cant_add_invoice'));
  } catch (error) {
    logger.error(error);
  }
};

const sendMeAnInvoiceMessage = async (
  ctx: MainContext,
  amount: number,
  i18nCtx: I18nContext
) => {
  try {
    await ctx.reply(i18nCtx.t('send_me_lninvoice', { amount }));
  } catch (error) {
    logger.error(error);
  }
};

const wizardAddFiatAmountMessage = async (
  ctx: MainContext,
  currency: string,
  action: string,
  order: IOrder
) => {
  try {
    await ctx.reply(
      ctx.i18n.t('wizard_add_fiat_amount', {
        action,
        currency,
        fiatAmount: numberFormat(order.fiat_code, order.fiat_amount),
        minAmount: numberFormat(order.fiat_code, order.min_amount),
        maxAmount: numberFormat(order.fiat_code, order.max_amount),
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const wizardAddFiatAmountWrongAmountMessage = async (
  ctx: MainContext,
  order: IOrder
) => {
  try {
    await ctx
      .deleteMessage()
      .catch(() => {})
      .catch(e => logger.error(e));
    await ctx.reply(
      ctx.i18n.t('wizard_add_fiat_wrong_amount', {
        minAmount: numberFormat(order.fiat_code, order.min_amount),
        maxAmount: numberFormat(order.fiat_code, order.max_amount),
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const wizardAddFiatAmountCorrectMessage = async (
  ctx: MainContext,
  currency: IFiat,
  fiatAmount: number
) => {
  try {
    await ctx.reply(
      ctx.i18n.t('wizard_add_fiat_correct_amount', {
        currency: currency.symbol_native,
        fiatAmount,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const expiredOrderMessage = async (
  bot: Telegraf<MainContext>,
  order: IOrder,
  buyerUser: UserDocument,
  sellerUser: UserDocument,
  i18n: I18nContext
) => {
  try {
    const detailedOrder = getDetailedOrder(
      i18n as unknown as I18nFix,
      order,
      buyerUser,
      sellerUser
    );
    await bot.telegram.sendMessage(
      String(process.env.ADMIN_CHANNEL),
      i18n.t('expired_order', {
        detailedOrder,
        buyerUser,
        sellerUser,
      }),
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    logger.error(error);
  }
};

const toBuyerExpiredOrderMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('expired_order_to_buyer', { helpGroup: process.env.HELP_GROUP })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toSellerExpiredOrderMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('expired_order_to_seller', { helpGroup: process.env.HELP_GROUP })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toBuyerDidntAddInvoiceMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('didnt_add_invoice', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toSellerBuyerDidntAddInvoiceMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('buyer_havent_add_invoice', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toAdminChannelBuyerDidntAddInvoiceMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      String(process.env.ADMIN_CHANNEL),
      i18n.t('buyer_havent_add_invoice_to_admin_channel', {
        orderId: order._id,
        username: user.username,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toSellerDidntPayInvoiceMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('havent_paid_invoice', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toBuyerSellerDidntPayInvoiceMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('seller_havent_paid_invoice', { orderId: order._id })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toAdminChannelSellerDidntPayInvoiceMessage = async (
  bot: Telegraf<MainContext>,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      String(process.env.ADMIN_CHANNEL),
      i18n.t('seller_havent_add_invoice_to_admin_channel', {
        orderId: order._id,
        username: user.username,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toAdminChannelPendingPaymentSuccessMessage = async (
  bot: MainContext,
  user: IUser,
  order: IOrder,
  pending: IPendingPayment,
  payment: { secret: string },
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      String(process.env.ADMIN_CHANNEL),
      i18n.t('pending_payment_success_to_admin', {
        orderId: order._id,
        username: user.username,
        attempts: pending.attempts,
        amount: numberFormat(order.fiat_code, order.amount),
        paymentSecret: payment.secret,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toBuyerPendingPaymentSuccessMessage = async (
  bot: MainContext,
  user: IUser,
  order: IOrder,
  payment: { secret: string },
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('pending_payment_success', {
        id: order._id,
        amount: numberFormat(order.fiat_code, order.amount),
        paymentSecret: payment.secret,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const toBuyerPendingPaymentFailedMessage = async (
  bot: MainContext,
  user: IUser,
  order: IOrder,
  i18n: I18nContext
) => {
  try {
    const attempts = process.env.PAYMENT_ATTEMPTS;
    await bot.telegram.sendMessage(
      user.tg_id,
      i18n.t('pending_payment_failed', {
        attempts,
      })
    );
    await bot.telegram.sendMessage(user.tg_id, i18n.t('press_to_continue'), {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: i18n.t('continue'),
              callback_data: `addInvoicePHIBtn_${order._id}`,
            },
          ],
        ],
      },
    });
  } catch (error) {
    logger.error(error);
  }
};

const toAdminChannelPendingPaymentFailedMessage = async (
  bot: MainContext,
  user: IUser,
  order: IOrder,
  pending: IPendingPayment,
  i18n: I18nContext
) => {
  try {
    await bot.telegram.sendMessage(
      String(process.env.ADMIN_CHANNEL),
      i18n.t('pending_payment_failed_to_admin', {
        attempts: pending.attempts,
        orderId: order._id,
        username: user.username,
      })
    );
  } catch (error) {
    logger.error(error);
  }
};

const currencyNotSupportedMessage = async (
  ctx: MainContext,
  currencies: Array<string>
) => {
  try {
    const currenciesStr = currencies.join(', ');
    await ctx.reply(ctx.i18n.t('currency_not_supported', { currenciesStr }));
  } catch (error) {
    logger.error(error);
  }
};

const notAuthorized = async (ctx: MainContext, tgId?: string) => {
  try {
    if (tgId) {
      await ctx.telegram.sendMessage(tgId, ctx.i18n.t('not_authorized'));
    } else {
      await ctx.reply(ctx.i18n.t('not_authorized'));
    }
  } catch (error) {
    logger.error(error);
  }
};

const mustBeANumber = async (ctx: MainContext) => {
  try {
    await ctx.reply(ctx.i18n.t('not_number'));
  } catch (error) {
    logger.error(error);
  }
};

const showConfirmationButtons = async (
  ctx: MainContext,
  orders: Array<IOrder>,
  commandString: string
) => {
  try {
    commandString = commandString.slice(1);
    const inlineKeyboard = [];
    while (orders.length > 0) {
      const lastTwo = orders.splice(-2);
      const lineBtn = lastTwo
        .map(ord => {
          return {
            _id: ord._id.toString(),
            fiat: ord.fiat_code,
            amount: ord.fiat_amount || '-',
            type: ord.type,
          };
        })
        .map(ord => ({
          text: `${ord._id.slice(0, 2)}..${ord._id.slice(-2)} - ${ord.type} - ${
            ord.fiat
          } ${ord.amount}`,
          callback_data: `${commandString}_${ord._id}`,
        }));
      inlineKeyboard.push(lineBtn);
    }

    const message =
      commandString === 'fiatsent'
        ? ctx.i18n.t('tap_fiatsent')
        : commandString === 'release'
        ? ctx.i18n.t('tap_release')
        : ctx.i18n.t('tap_button');

    await ctx.reply(message, {
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  } catch (error) {
    logger.error(error);
  }
};

export {
  startMessage,
  initBotErrorMessage,
  invoicePaymentRequestMessage,
  sellOrderCorrectFormatMessage,
  buyOrderCorrectFormatMessage,
  minimunAmountInvoiceMessage,
  minimunExpirationTimeInvoiceMessage,
  expiredInvoiceMessage,
  requiredAddressInvoiceMessage,
  invoiceMustBeLargerMessage,
  invoiceExpiryTooShortMessage,
  invoiceHasExpiredMessage,
  invoiceHasWrongDestinationMessage,
  invoiceInvalidMessage,
  requiredHashInvoiceMessage,
  publishBuyOrderMessage,
  invalidOrderMessage,
  invalidTypeOrderMessage,
  alreadyTakenOrderMessage,
  onGoingTakeSellMessage,
  invalidDataMessage,
  beginTakeBuyMessage,
  notActiveOrderMessage,
  publishSellOrderMessage,
  onGoingTakeBuyMessage,
  pendingSellMessage,
  pendingBuyMessage,
  notOrderMessage,
  customMessage,
  nonHandleErrorMessage,
  checkOrderMessage,
  mustBeValidCurrency,
  mustBeANumberOrRange,
  unavailableLightningAddress,
  invalidLightningAddress,
  helpMessage,
  disclaimerMessage,
  mustBeGreatherEqThan,
  bannedUserErrorMessage,
  fiatSentMessages,
  orderOnfiatSentStatusMessages,
  takeSellWaitingSellerToPayMessage,
  userBannedMessage,
  userUnBannedMessage,
  notFoundUserMessage,
  errorParsingInvoiceMessage,
  notValidIdMessage,
  addInvoiceMessage,
  cantTakeOwnOrderMessage,
  notLightningInvoiceMessage,
  notOrdersMessage,
  notRateForCurrency,
  incorrectAmountInvoiceMessage,
  beginTakeSellMessage,
  invoiceUpdatedMessage,
  counterPartyWantsCooperativeCancelMessage,
  initCooperativeCancelMessage,
  okCooperativeCancelMessage,
  shouldWaitCooperativeCancelMessage,
  successCompleteOrderByAdminMessage,
  successCompleteOrderMessage,
  successCancelOrderByAdminMessage,
  successCancelOrderMessage,
  badStatusOnCancelOrderMessage,
  invoicePaymentFailedMessage,
  userCantTakeMoreThanOneWaitingOrderMessage,
  buyerReceivedSatsMessage,
  releasedSatsMessage,
  rateUserMessage,
  listCurrenciesResponse,
  priceApiFailedMessage,
  showHoldInvoiceMessage,
  waitingForBuyerOrderMessage,
  invoiceUpdatedPaymentWillBeSendMessage,
  invoiceAlreadyUpdatedMessage,
  successSetAddress,
  sellerPaidHoldMessage,
  showInfoMessage,
  sendBuyerInfo2SellerMessage,
  updateUserSettingsMessage,
  expiredInvoiceOnPendingMessage,
  successCancelAllOrdersMessage,
  disableLightningAddress,
  invalidRangeWithAmount,
  tooManyPendingOrdersMessage,
  wizardAddInvoiceInitMessage,
  wizardAddInvoiceExitMessage,
  orderExpiredMessage,
  cantAddInvoiceMessage,
  wizardExitMessage,
  wizardAddFiatAmountMessage,
  wizardAddFiatAmountWrongAmountMessage,
  wizardAddFiatAmountCorrectMessage,
  expiredOrderMessage,
  toBuyerDidntAddInvoiceMessage,
  toSellerBuyerDidntAddInvoiceMessage,
  toAdminChannelBuyerDidntAddInvoiceMessage,
  toSellerDidntPayInvoiceMessage,
  toBuyerSellerDidntPayInvoiceMessage,
  toAdminChannelSellerDidntPayInvoiceMessage,
  toAdminChannelPendingPaymentSuccessMessage,
  toBuyerPendingPaymentSuccessMessage,
  toBuyerPendingPaymentFailedMessage,
  toAdminChannelPendingPaymentFailedMessage,
  genericErrorMessage,
  refundCooperativeCancelMessage,
  toBuyerExpiredOrderMessage,
  toSellerExpiredOrderMessage,
  currencyNotSupportedMessage,
  sendMeAnInvoiceMessage,
  notAuthorized,
  mustBeANumber,
  showConfirmationButtons,
  counterPartyCancelOrderMessage,
  checkInvoiceMessage,
};
