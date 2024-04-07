import { I18n, I18nContext, LanguageCode, TemplateData } from '@grammyjs/i18n';
import currencies from './fiat.json';
import languages from './languages.json';
import { Order, Community } from '../models';
import { logger } from '../logger';
import { IUser, UserDocument } from '../models/user';
import { IFiat } from './fiatModel';
import { Telegram } from 'telegraf';
import { IOrder } from '../models/order';
import { ICommunity } from '../models/community';
import { getI18nGlobalContext } from './i18n';

export declare class I18nFix extends I18n {
  createContext(
    languageCode: LanguageCode,
    templateData: Readonly<TemplateData>
  ): I18nContext;
  createContext(languageCode: LanguageCode): I18nContext;
  t(languageCode: LanguageCode, templateData?: Readonly<TemplateData>): string;
  t(
    languageCode: LanguageCode,
    resourceKey: string,
    templateData?: Readonly<TemplateData>
  ): string;
}

// ISO 4217, all ISO currency codes are 3 letters but users can trade shitcoins

const isIso4217 = (code: string) => {
  if (code.length < 3 || code.length > 5) {
    return false;
  }
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const codeParts = code.toLowerCase().split('');
  return codeParts.every(letter => {
    if (!alphabet.includes(letter)) {
      return false;
    }
    return true;
  });
};

export { isIso4217 };

const getCurrency = (code: string): IFiat | false => {
  if (!isIso4217(code)) return false;
  const currency = currencies[code as keyof typeof currencies];
  if (!currency) return false;

  return currency;
};

export { getCurrency };

const plural = (n: number) => {
  if (n === 1) {
    return '';
  }
  return 's';
};

export { plural };

// This function formats a number to locale strings.
// If Iso code or locale code doesn´t exist, the function will return a number without format.

export const numberFormat = (code: string, number: number) => {
  if (!isIso4217(code)) return false;

  const fiat = currencies[code as keyof typeof currencies] as IFiat;
  if (!fiat) return number;

  const locale = fiat.locale;
  const numberToLocaleString = Intl.NumberFormat(locale);

  if (!locale || isNaN(number)) return number;

  return numberToLocaleString.format(number);
};

// This function checks if the current buyer and seller were doing circular operations
// In order to increase their trades_completed and volume_traded.
// If we found those trades in the last 24 hours we decrease both variables to both users

// EVMTODO: Change amount to bigint, mongoose needs to be updated
export const handleReputationItems = async (
  buyer: UserDocument,
  seller: UserDocument,
  amount: number
) => {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const orders = await Order.find({
      status: 'SUCCESS',
      seller_id: buyer._id,
      buyer_id: seller._id,
      taken_at: { $gte: yesterday },
    });
    if (orders.length > 0) {
      let totalAmount = 0;
      orders.forEach(order => {
        totalAmount += order.amount;
      });
      const lastAmount = orders[orders.length - 1].amount;
      let buyerTradesCompleted;
      let sellerTradesCompleted;
      let buyerVolumeTraded;
      let sellerVolumeTraded;
      if (amount > lastAmount) {
        buyerTradesCompleted =
          buyer.trades_completed - orders.length <= 0
            ? 0
            : buyer.trades_completed - orders.length;
        sellerTradesCompleted =
          seller.trades_completed - orders.length <= 0
            ? 0
            : seller.trades_completed - orders.length;
        buyerVolumeTraded =
          buyer.volume_traded - totalAmount <= 0
            ? 0
            : buyer.volume_traded - totalAmount;
        sellerVolumeTraded =
          seller.volume_traded - totalAmount <= 0
            ? 0
            : seller.volume_traded - totalAmount;
      } else {
        buyerTradesCompleted =
          buyer.trades_completed <= 1 ? 0 : buyer.trades_completed - 1;
        sellerTradesCompleted =
          seller.trades_completed <= 1 ? 0 : seller.trades_completed - 1;
        buyerVolumeTraded =
          buyer.volume_traded - amount <= 0 ? 0 : buyer.volume_traded - amount;
        sellerVolumeTraded =
          seller.volume_traded - amount <= 0
            ? 0
            : seller.volume_traded - amount;
      }
      buyer.trades_completed = buyerTradesCompleted;
      seller.trades_completed = sellerTradesCompleted;
      buyer.volume_traded = buyerVolumeTraded;
      seller.volume_traded = sellerVolumeTraded;
    } else {
      buyer.trades_completed++;
      seller.trades_completed++;
      buyer.volume_traded += amount;
      seller.volume_traded += amount;
    }
    await buyer.save();
    await seller.save();
  } catch (error) {
    logger.error(error);
  }
};

export const getBtcFiatPrice = async (fiatCode: string, fiatAmount: bigint) => {
  try {
    const currency = getCurrency(fiatCode);
    if (!currency || !currency.price) return;
    return 0; // EVMTODO
  } catch (error) {
    logger.error(error);
  }
};

export const getBtcExchangePrice = (fiatAmount: number, satsAmount: number) => {
  try {
    const satsPerBtc = BigInt(1e8);
    const feeRate = (satsPerBtc * BigInt(fiatAmount)) / BigInt(satsAmount);

    return feeRate;
  } catch (error) {
    logger.error(error);
  }
};

const objectToArray = (object: Record<any, any>) => {
  const array = [];

  for (const i in object) array.push(object[i]);

  return array;
};

export { objectToArray };

export const getCurrenciesWithPrice = () => {
  const currenciesArr = objectToArray(currencies);
  const withPrice = currenciesArr.filter(currency => currency.price);

  return withPrice;
};

const getEmojiRate = (rate: number) => {
  const star = '⭐';
  const roundedRate = Math.round(rate);
  const output = [];
  for (let i = 0; i < roundedRate; i++) output.push(star);

  return output.join('');
};

export { getEmojiRate };

// Round number to exp decimal digits
// Source: https://developer.mozilla.org/es/docs/Web/JavaScript/Reference/Global_Objects/Math/round#redondeo_decimal

const decimalRound = (value: number, exp?: number) => {
  if (typeof exp === 'undefined' || +exp === 0) {
    return Math.round(value);
  }
  value = +value;
  exp = +exp;

  if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
    return NaN;
  }
  // Shift
  let valueParts = value.toString().split('e');
  value = Math.round(
    +(valueParts[0] + 'e' + (valueParts[1] ? +valueParts[1] - exp : -exp))
  );
  // Shift back
  valueParts = value.toString().split('e');
  return +(valueParts[0] + 'e' + (valueParts[1] ? +valueParts[1] + exp : exp));
};

export { decimalRound };

export const extractId = (text: string) => {
  const matches = text.match(/:([a-f0-9]{24}):/);
  if (!matches) {
    throw new Error('No matched ID');
  }

  return matches[1];
};

// Clean strings that are going to be rendered with markdown

const sanitizeMD = (text: string) => {
  if (!text) return '';

  return text.toString().replace(/(?=[|<>(){}[\]\-_!#.`=+])/g, '\\');
};

export { sanitizeMD };

export const secondsToTime = (secs: number) => {
  const hours = Math.floor(secs / (60 * 60));

  const divisor = secs % (60 * 60);
  const minutes = Math.floor(divisor / 60);

  return {
    hours,
    minutes,
  };
};

export const isGroupAdmin = async (
  groupId: string | number,
  user: IUser,
  telegram: Telegram
) => {
  try {
    const member = await telegram.getChatMember(
      groupId,
      parseInt(user.tg_id, 10)
    );
    if (
      member &&
      (member.status === 'creator' || member.status === 'administrator')
    ) {
      return {
        success: true,
        message: `@${user.username} is ${member.status}`,
      };
    } else if (member.status === 'left') {
      return {
        success: false,
        message: `@${user.username} is not a member of this chat`,
      };
    }

    return {
      success: false,
      message: `@${user.username} is not an admin`,
    };
  } catch (error) {
    logger.error(error);
    return {
      success: false,
      message: (error as any).toString(),
    };
  }
};

export const getOrderChannel = async (order: IOrder) => {
  let channel = process.env.CHANNEL;
  if (order.community_id) {
    const community = await Community.findOne({ _id: order.community_id });
    if (!community) {
      return channel;
    }
    if (community.order_channels.length === 1) {
      channel = community.order_channels[0].name;
    } else {
      community.order_channels.forEach(c => {
        if (c.type === order.type) {
          channel = c.name;
        }
      });
    }
  }

  return channel;
};

export const getDisputeChannel = async (order: IOrder) => {
  let channel = process.env.DISPUTE_CHANNEL;
  if (order.community_id) {
    const community = await Community.findOne({ _id: order.community_id });
    if (!community) {
      throw new Error(`No community: ${order.community_id}`);
    }
    channel = community.dispute_channel;
  }

  return channel;
};

/**
 * Returns a i18n context
 * @param {*} user
 * @returns i18n context
 */
export const getUserI18nContext = async (user: {
  language?: string;
  lang: string;
}) => {
  const language = user.language || 'en';
  const i18n = new I18n({
    ...{ locale: language },
    defaultLanguageOnMissing: true,
    directory: 'locales',
    templateData: getI18nGlobalContext(),
  }) as I18nFix;

  return i18n.createContext(user.lang);
};

export const getDetailedOrder = (
  i18n: I18nFix,
  order: IOrder,
  buyer: UserDocument,
  seller: UserDocument
) => {
  try {
    const buyerUsername = buyer ? sanitizeMD(buyer.username ?? '') : '';
    const buyerReputation = buyer
      ? sanitizeMD(buyer.total_rating.toFixed(2))
      : '';
    const sellerUsername = seller ? sanitizeMD(seller.username ?? '') : '';
    const sellerReputation = seller
      ? sanitizeMD(seller.total_rating.toFixed(2))
      : '';
    const buyerId = buyer ? buyer._id : '';
    const paymentMethod = sanitizeMD(order.payment_method);
    const priceMargin = sanitizeMD(order.price_margin.toString());
    let createdAt = order.created_at.toISOString();
    let takenAt = order.taken_at ? order.taken_at.toISOString() : '';
    createdAt = sanitizeMD(createdAt);
    takenAt = sanitizeMD(takenAt);
    const status = sanitizeMD(order.status);
    const fee = order.fee ? parseInt(String(order.fee)) : '';
    const creator =
      order.creator_id === buyerId ? buyerUsername : sellerUsername;
    const message = i18n.t('order_detail', {
      order,
      creator,
      buyerUsername,
      sellerUsername,
      createdAt,
      takenAt,
      status,
      fee,
      paymentMethod,
      priceMargin,
      buyerReputation,
      sellerReputation,
    });

    return message;
  } catch (error) {
    logger.error(error);
  }
};

// We need to know if this user is a dispute solver for this community
export const isDisputeSolver = (community: ICommunity, user: UserDocument) => {
  if (!community || !user) {
    return false;
  }

  return community.solvers.some(solver => solver.id == user._id);
};

// Return the fee the bot will charge to the seller
// this fee is a combination from the global bot fee and the community fee
export const getFee = async (amount: number, communityId?: string) => {
  const maxFee = Math.round(amount * parseFloat(process.env.MAX_FEE || '0'));
  if (!communityId) return maxFee;

  const botFee = maxFee * parseFloat(process.env.FEE_PERCENT || '0');
  let communityFee = Math.round(maxFee - botFee);
  const community = await Community.findOne({ _id: communityId });
  communityFee = communityFee * ((community?.fee ?? 0) / 100);

  return botFee + communityFee;
};

export const itemsFromMessage = (str: string) => {
  return str
    .split(' ')
    .map(e => e.trim())
    .filter(e => !!e);
};

// Check if a number is int
const isInt = (n: any): n is number => parseInt(n) === n;

export { isInt };

// Check if a number is float
export const isFloat = (n: any): n is number =>
  typeof n === 'number' && !isInt(n);

// Returns an emoji flag for a language
export const getLanguageFlag = (code: string): IFiat | undefined => {
  return languages[code as keyof typeof languages] as IFiat;
};

export const delay = (time: number) => {
  return new Promise(resolve => setTimeout(resolve, time));
};

// Returns the hold invoice expiration time in seconds,
// and the hold invoice safety window in seconds
export const holdInvoiceExpirationInSecs = () => {
  const expirationTimeInSecs =
    parseInt(process.env.HOLD_INVOICE_CLTV_DELTA || '0') * 10 * 60;
  const safetyWindowInSecs =
    parseInt(process.env.HOLD_INVOICE_CLTV_DELTA_SAFETY_WINDOW || '0') *
    10 *
    60;
  return {
    expirationTimeInSecs,
    safetyWindowInSecs,
  };
};

// Returns the user age in days
export const getUserAge = (user: IUser, userCreationDate?: Date) => {
  userCreationDate = userCreationDate || new Date(user.created_at);
  const today = new Date();
  const ageInDays = Math.floor(
    (today.getTime() - userCreationDate.getTime()) / (1000 * 3600 * 24)
  );
  return ageInDays;
};

/**
 * Returns order expiration time text
 * @param {*} order order object
 * @param {*} i18n context
 * @returns String with the remaining time to expiration in format '1 hours 30 minutes'
 */
export const getTimeToExpirationOrder = (order: IOrder, i18n: I18nFix) => {
  const initialDateObj = new Date(order.created_at);
  const timeToExpire = parseInt(
    process.env.ORDER_PUBLISHED_EXPIRATION_WINDOW || '0'
  );
  initialDateObj.setSeconds(initialDateObj.getSeconds() + timeToExpire);

  const currentDateObj = new Date();
  const timeDifferenceMs = +initialDateObj - +currentDateObj;
  const totalSecondsRemaining = Math.floor(timeDifferenceMs / 1000);
  const textHour = i18n.t('hours');
  const textMin = i18n.t('minutes');

  if (totalSecondsRemaining <= 0) {
    return `0 ${textHour} 0 ${textMin}`; // If the date has already passed, show remaining time as 00 hours 00 minutes
  }
  // Calculate hours, minutes, and seconds
  const hours = Math.floor(totalSecondsRemaining / 3600);
  const minutes = Math.floor((totalSecondsRemaining % 3600) / 60);
  return `${hours} ${textHour} ${minutes} ${textMin}`;
};

export const getStars = (rate: number, totalReviews: number | string) => {
  const stars = getEmojiRate(rate);
  const roundedRating = decimalRound(rate, -1);

  return `${roundedRating} ${stars} (${totalReviews})`;
};

export const ensureEnv = (key: string) => {
  const ret = process.env[key];
  if (!ret) {
    console.error('Error: Environment variable not set:', key);
    setTimeout(() => process.exit(1), 0); // Check more variables before exiting
    return '';
  }
  return ret;
};

export function lazyMemo<T>(
  refreshMs: number,
  invalidMs: number,
  getter: () => Promise<T>
): () => Promise<T> {
  let ts = 0;
  let value: T;
  async function refresh() {
    value = await getter();
    ts = Date.now();
    return value;
  }
  return async () => {
    if (Date.now() > ts + invalidMs) {
      return await refresh();
    }
    if (Date.now() > ts + refreshMs) {
      refresh().catch(() => {
        ts = 0; // Retry on next access, throw at that time if still error
      });
    }
    return value;
  };
}

export const beginningCase = (s: string) =>
  s.slice(0, 1).toUpperCase() + s.slice(1);
