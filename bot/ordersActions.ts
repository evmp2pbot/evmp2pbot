import { Types } from 'mongoose';
const { ObjectId } = Types;
import { Order, Community } from '../models';
import * as messages from './messages';
import {
  getCurrency,
  numberFormat,
  getFee,
  getUserAge,
  getStars,
  beginningCase,
} from '../util';
import { logger } from '../logger';

import * as OrderEvents from './modules/events/orders';
import { IOrder } from '../models/order';
import { IUser, UserDocument } from '../models/user';
import { MainContext } from './start';
import { IFiat } from '../util/fiatModel';
import { I18nContext } from '@grammyjs/i18n';
import { getBalance, getDateAdded } from '../ln/extWallet';

const createOrder = async (
  i18n: I18nContext,
  bot: MainContext,
  user: UserDocument,
  {
    type,
    amount,
    fiatAmount,
    fiatCode,
    paymentMethod,
    status,
    priceMargin,
    range_parent_id,
    tgChatId,
    tgOrderMessage,
    community_id,
  }: {
    type: string;
    amount: string | number;
    fiatAmount: number[];
    fiatCode: string;
    paymentMethod: string;
    status: string;
    priceMargin: number;
    range_parent_id?: unknown;
    tgChatId?: unknown;
    tgOrderMessage?: unknown;
    community_id?: string;
  }
) => {
  try {
    amount = parseInt(amount.toString());
    let isPublic = true;
    if (community_id) {
      const community = await Community.findById(community_id);
      isPublic = community?.public || false;
    }
    const fee = await getFee(amount, community_id);
    // Global fee values at the moment of the order creation
    // We will need this to calculate the final amount
    const botFee = parseFloat(process.env.MAX_FEE || '0');
    const communityFee = parseFloat(process.env.FEE_PERCENT || '0');
    const currency: IFiat | undefined = getCurrency(fiatCode) as IFiat;
    const priceFromAPI = !amount;

    if (priceFromAPI && !currency?.price) {
      await messages.notRateForCurrency(bot, user, i18n);
      return;
    }

    const fiatAmountData = getFiatAmountData(fiatAmount);

    if (!user.extwallet_created_at) {
      const extWalletCreatedAt = await getDateAdded({
        telegramId: user.tg_id,
      }).catch(() => undefined);
      if (!extWalletCreatedAt || extWalletCreatedAt.getFullYear() < 2000) {
        await messages.extWalletPromptNotActivatedMessage(bot, user, i18n);
        return;
      }
      user.extwallet_created_at = extWalletCreatedAt;
      await user.save();
    }
    const baseOrderData = {
      ...fiatAmountData,
      amount,
      fee,
      bot_fee: botFee,
      community_fee: communityFee,
      creator_id: user._id,
      type,
      status,
      fiat_code: fiatCode,
      payment_method: paymentMethod,
      tg_chat_id: tgChatId,
      tg_order_message: tgOrderMessage,
      price_from_api: priceFromAPI,
      price_margin: priceMargin || 0,
      description: buildDescription(i18n, {
        user,
        type,
        amount,
        fiatAmount,
        fiatCode,
        paymentMethod,
        priceMargin,
        priceFromAPI,
        currency,
      }),
      range_parent_id,
      community_id,
      is_public: isPublic,
    };

    let order;

    if (type === 'sell') {
      const userBalance = await getBalance({ telegramId: user.tg_id }).catch(
        e => {
          logger.error('Failed to get balance:', e.response?.data || e);
          return '0';
        }
      );
      if (parseFloat(userBalance) < amount) {
        await messages.extWalletPromptNotEnoughBalanceMessage(
          bot,
          user,
          userBalance,
          i18n
        );
        return;
      }
      order = new Order({
        seller_id: user._id,
        ...baseOrderData,
      });
    } else {
      order = new Order({
        buyer_id: user._id,
        ...baseOrderData,
      });
    }
    await order.save();

    OrderEvents.orderCreated(order);

    return order;
  } catch (error) {
    logger.error(error);
  }
};

const getFiatAmountData = (fiatAmount: number[]) => {
  const response: {
    min_amount?: number;
    max_amount?: number;
    fiat_amount?: number;
  } = {};
  if (fiatAmount.length === 2) {
    response.min_amount = fiatAmount[0];
    response.max_amount = fiatAmount[1];
  } else {
    response.fiat_amount = fiatAmount[0];
  }

  return response;
};

const buildDescription = (
  i18n: I18nContext,
  {
    user,
    type,
    amount,
    fiatAmount,
    fiatCode,
    paymentMethod,
    priceMargin,
    priceFromAPI,
    currency,
  }: {
    user: IUser;
    type: string;
    amount: number;
    fiatAmount: number[];
    fiatCode: string;
    paymentMethod: string;
    priceMargin: number;
    priceFromAPI: unknown;
    currency: IFiat;
  }
) => {
  try {
    const action = type === 'sell' ? i18n.t('selling') : i18n.t('buying');
    // const hashtag = `#${type.toUpperCase()}${fiatCode}\n`;
    const paymentAction =
      type === 'sell' ? i18n.t('receive_payment') : i18n.t('pay');
    let publisher = type === 'sell' ? i18n.t('seller') : i18n.t('buyer');
    publisher = beginningCase(publisher);
    const trades = user.trades_completed;
    const volume = numberFormat(fiatCode, user.volume_traded);
    const totalRating = user.total_rating;
    const totalReviews = user.total_reviews;
    const username = user.show_username
      ? `@${user.username} ` + i18n.t('is') + ` `
      : ``;
    /*
    const volumeTraded = user.show_volume_traded
      ? i18n.t('trading_volume', { volume }) + `\n`
      : ``;
    */
    const volumeTraded = i18n.t('trading_volume', { volume }) + `\n`;
    const priceMarginString =
      !!priceMargin && priceMargin > 0 ? `+${priceMargin}` : priceMargin;
    const priceMarginText = priceMarginString ? `${priceMarginString}%` : ``;

    const fiatAmountString = fiatAmount
      .map(amt => numberFormat(fiatCode, amt))
      .join(' - ');

    let currencyString = `${fiatCode} ${fiatAmountString}`;

    if (currency) currencyString = `${fiatAmountString} ${currency.code}`;

    let amountText = `${numberFormat(fiatCode, amount)} `;
    let tasaText = '';
    if (priceFromAPI) {
      amountText = '';
      tasaText =
        i18n.t('rate') + `: ${process.env.FIAT_RATE_NAME} ${priceMarginText}\n`;
    } else {
      const exchangePrice = 1; // getBtcExchangePrice(fiatAmount[0], amount);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      tasaText =
        i18n.t('price') + `: ${numberFormat(fiatCode, exchangePrice)}\n`;
    }

    let rateText = '\n';
    if (totalRating) {
      rateText = getStars(totalRating, totalReviews) + '\n';
    }

    const ageInDays = getUserAge(user);
    const ageInDaysExtWallet = getUserAge(user, user.extwallet_created_at);

    let description =
      `${username}${action} ${amountText}$` + i18n.t('sats') + `\n`;
    description += i18n.t('for') + ` ${currencyString}\n`;
    description += `${paymentAction} ` + i18n.t('by') + ` ${paymentMethod}\n`;
    description += '---\n';
    description += `${publisher}:\n`;
    description += i18n.t('has_successful_trades', { trades }) + `\n`;
    description += i18n.t('user_age', { days: ageInDays }) + `\n`;
    description +=
      i18n.t('user_age_extwallet', { days: ageInDaysExtWallet }) + `\n`;
    description += volumeTraded;
    // description += hashtag;
    // description += tasaText;
    description += rateText;

    return description;
  } catch (error) {
    logger.error(error);
  }
};

const getOrder = async (
  ctx: MainContext,
  user: UserDocument,
  orderId: string
) => {
  try {
    if (!ObjectId.isValid(orderId)) {
      await messages.notValidIdMessage(ctx);
      return false;
    }

    const where = {
      _id: orderId,
      $or: [{ seller_id: user._id }, { buyer_id: user._id }],
    };

    const order = await Order.findOne(where);
    if (!order) {
      await messages.notOrderMessage(ctx);
      return false;
    }

    return order;
  } catch (error) {
    logger.error(error);
    return false;
  }
};

const getOrders = async (
  ctx: MainContext,
  user: UserDocument,
  status?: string
) => {
  try {
    const where = {
      $and: [
        {
          $or: [{ buyer_id: user._id }, { seller_id: user._id }],
        },
      ],
    };

    if (status) {
      where.$and.push({ ...({ status } as any) });
    } else {
      const $or = [
        { status: 'WAITING_PAYMENT' },
        { status: 'WAITING_BUYER_INVOICE' },
        { status: 'PENDING' },
        { status: 'ACTIVE' },
        { status: 'FIAT_SENT' },
        { status: 'PAID_HOLD_INVOICE' },
        { status: 'DISPUTE' },
      ];
      where.$and.push({ $or: $or as any });
    }
    const orders = await Order.find(where);

    if (orders.length === 0) {
      await messages.notOrdersMessage(ctx);
      return false;
    }

    return orders;
  } catch (error) {
    logger.error(error);
  }
};

const getNewRangeOrderPayload = async (order: IOrder) => {
  try {
    let newMaxAmount = 0;

    if (order.max_amount !== undefined) {
      newMaxAmount = order.max_amount - order.fiat_amount;
    }

    if (newMaxAmount >= order.min_amount) {
      const orderData = {
        type: order.type,
        amount: 0,
        // drop newMaxAmount if it is equal to min_amount and create a
        // not range order.
        // Set preserves insertion order, so min_amount will be always
        // before newMaxAmount
        fiatAmount: [...new Set([order.min_amount, newMaxAmount])],
        fiatCode: order.fiat_code,
        paymentMethod: order.payment_method,
        status: 'PENDING',
        priceMargin: order.price_margin,
        range_parent_id: order._id,
        tgChatId: order.tg_chat_id,
        tgOrderMessage: order.tg_order_message,
        community_id: order.community_id,
      };

      return orderData;
    }
  } catch (error) {
    logger.error(error);
  }
};

export { createOrder, getOrder, getOrders, getNewRangeOrderPayload };
