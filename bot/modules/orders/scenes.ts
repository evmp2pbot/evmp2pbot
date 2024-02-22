/* eslint-disable @typescript-eslint/await-thenable */
import { Scenes, Markup } from 'telegraf';
import { logger } from '../../../logger';
import { getCurrency } from '../../../util';
import * as ordersActions from '../../ordersActions';
import {
  publishBuyOrderMessage,
  publishSellOrderMessage,
} from '../../messages';
import { MainContext } from '../../start';
import { UserDocument } from '../../../models/user';
import { CommunityDocument } from '../../../models/community';
import { Community, User } from '../../../models';
import { Message } from 'telegraf/types';
const messages = require('./messages');

export const CREATE_ORDER = 'CREATE_ORDER_WIZARD';

exports.middleware = () => {
  const stage = new Scenes.Stage([createOrder]);
  return stage.middleware();
};

interface WizardState {
  user: UserDocument;
  community: CommunityDocument;
  type: string;
  currency: string;
  fiatAmount: number[];
  sats: string | number;
  priceMargin: number;
  method: string;

  statusMessage?: Message.TextMessage;
  currentStatusText?: string;
  error?: string | null;
  currencies?: string[];

  handler: any;
  updateUI: any;
}

const wizardState = (ctx: MainContext) => {
  const ret = ctx.wizard.state as WizardState;
  if (ret.user && !(ret.user instanceof User)) {
    ret.user = User.hydrate(ret.user);
  }
  if (ret.community && !(ret.community instanceof Community)) {
    ret.community = Community.hydrate(ret.community);
  }
  return ret;
};

export const createOrder = new Scenes.WizardScene<MainContext>(
  CREATE_ORDER,
  async (ctx: MainContext) => {
    try {
      const {
        user,
        community,
        statusMessage,
        type,
        currency,
        fiatAmount,
        sats,
        priceMargin,
        method,
      } = wizardState(ctx);
      if (!statusMessage) {
        const { text } = messages.createOrderWizardStatus(
          ctx.i18n,
          ctx.wizard.state
        );
        const res = await ctx.reply(text);
        wizardState(ctx).currentStatusText = text;
        wizardState(ctx).statusMessage = res;
        wizardState(ctx).updateUI = async () => {
          try {
            const { text } = messages.createOrderWizardStatus(
              ctx.i18n,
              ctx.wizard.state
            );
            if (wizardState(ctx).currentStatusText === text) return;
            await ctx.telegram.editMessageText(
              res.chat.id,
              res.message_id,
              undefined,
              text
            );
            wizardState(ctx).currentStatusText = text;
          } catch (err) {
            logger.error(err);
          }
        };
      }
      if (undefined === currency) return createOrderSteps.currency(ctx);
      if (undefined === fiatAmount) return createOrderSteps.fiatAmount(ctx);
      if (undefined === sats) return createOrderSteps.sats(ctx);
      if (undefined === priceMargin && sats === 0)
        return createOrderSteps.priceMargin(ctx);
      if (undefined === method) return createOrderSteps.method(ctx);
      // We remove all special characters from the payment method
      const paymentMethod = method.replace(/[&/\\#,+~%.'":*?<>{}]/g, '');

      const order = await ordersActions.createOrder(ctx.i18n, ctx, user, {
        type,
        amount: sats,
        fiatAmount,
        fiatCode: currency,
        paymentMethod,
        status: 'PENDING',
        priceMargin,
        community_id: community && community._id.toString(),
      });
      if (order) {
        const publishFn =
          type === 'buy' ? publishBuyOrderMessage : publishSellOrderMessage;
        await publishFn(ctx, user, order, ctx.i18n, true);
      }
      return ctx.scene.leave();
    } catch (err) {
      logger.error(err);
      return ctx.scene.leave();
    }
  },
  async ctx => {
    try {
      if (wizardState(ctx).handler) {
        const ret = await wizardState(ctx).handler(ctx);
        if (!ret) return;
        delete wizardState(ctx).handler;
      }
      await ctx.wizard.selectStep(0);
      // eslint-disable-next-line @typescript-eslint/dot-notation
      return ctx.wizard['steps'][ctx.wizard.cursor](ctx);
    } catch (err) {
      logger.error(err);
      return ctx.scene.leave();
    }
  }
);

const createOrderSteps = {
  async currency(ctx: MainContext) {
    const prompt = await createOrderPrompts.currency(ctx);
    const deletePrompt = () =>
      ctx.telegram.deleteMessage(prompt.chat.id, prompt.message_id);
    wizardState(ctx).handler = async (ctx: MainContext) => {
      wizardState(ctx).error = null;
      if (!wizardState(ctx).currencies) {
        await ctx.deleteMessage();
        if (ctx.message === undefined) return ctx.scene.leave();
        const currency = getCurrency((ctx.message as any)?.text?.toUpperCase());
        if (!currency) {
          wizardState(ctx).error = ctx.i18n.t('invalid_currency');
          return await wizardState(ctx).updateUI();
        }
        wizardState(ctx).currency = currency.code;
        await wizardState(ctx).updateUI();
      } else {
        if (!ctx.callbackQuery) return;
        const currency = (ctx.callbackQuery as any).data;
        wizardState(ctx).currency = currency;
        await wizardState(ctx).updateUI();
      }
      return deletePrompt();
    };
    return ctx.wizard.next();
  },
  async fiatAmount(ctx: MainContext) {
    wizardState(ctx).handler = async (ctx: MainContext) => {
      await createOrderHandlers.fiatAmount(ctx);
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const prompt = await createOrderPrompts.fiatAmount(ctx);
    return ctx.wizard.next();
  },
  async method(ctx: MainContext) {
    wizardState(ctx).handler = async (ctx: MainContext) => {
      if (ctx.message === undefined) return ctx.scene.leave();
      const text = (ctx.message as any)?.text as string;
      if (!text) return;
      wizardState(ctx).method = text;
      await wizardState(ctx).updateUI();
      await ctx.deleteMessage();
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    const { currency, fiatAmount } = wizardState(ctx);
    const prompt = await ctx.reply(
      ctx.i18n.t('enter_payment_method', { currency, fiatAmount })
    );
    return ctx.wizard.next();
  },
  async priceMargin(ctx: MainContext) {
    const prompt = await createOrderPrompts.priceMargin(ctx);
    wizardState(ctx).handler = async (ctx: MainContext) => {
      wizardState(ctx).error = null;
      if (!ctx.callbackQuery) {
        if (ctx.message === undefined) return ctx.scene.leave();
        const text = (ctx.message as any)?.text as string;
        if (!text) return;
        await ctx.deleteMessage();
        if (isNaN(parseInt(text, 10))) {
          wizardState(ctx).error = ctx.i18n.t('not_number');

          return await wizardState(ctx).updateUI();
        }
        wizardState(ctx).priceMargin = parseInt(text);
        await wizardState(ctx).updateUI();
      } else {
        wizardState(ctx).priceMargin = parseInt(
          (ctx.callbackQuery as any).data
        );
        await wizardState(ctx).updateUI();
      }
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    return ctx.wizard.next();
  },
  async sats(ctx: MainContext) {
    const prompt = await createOrderPrompts.sats(ctx);
    wizardState(ctx).handler = async (ctx: MainContext) => {
      const ret = await createOrderHandlers.sats(ctx);
      if (!ret) return;
      return await ctx.telegram.deleteMessage(
        prompt.chat.id,
        prompt.message_id
      );
    };
    return ctx.wizard.next();
  },
};

const createOrderPrompts = {
  async priceMargin(ctx: MainContext) {
    const margin = ['-5', '-4', '-3', '-2', '-1', '+1', '+2', '+3', '+4', '+5'];
    const buttons = margin.map(m => Markup.button.callback(m + '%', m));
    const rows = [];
    const chunkSize = 5;
    for (let i = 0; i < buttons.length; i += chunkSize) {
      const chunk = buttons.slice(i, i + chunkSize);
      rows.push(chunk);
    }
    const noMargin = [
      {
        text: ctx.i18n.t('no_premium_or_discount'),
        callback_data: '0',
        hide: false,
      },
    ];
    rows.splice(1, 0, noMargin);
    return ctx.reply(
      ctx.i18n.t('enter_premium_discount'),
      Markup.inlineKeyboard(rows)
    );
  },
  async currency(ctx: MainContext) {
    const { currencies } = wizardState(ctx);
    if (!currencies) return ctx.reply(ctx.i18n.t('enter_currency'));
    const buttons = currencies.map(currency =>
      Markup.button.callback(currency, currency)
    );
    const rows = [];
    const chunkSize = 3;
    for (let i = 0; i < buttons.length; i += chunkSize) {
      const chunk = buttons.slice(i, i + chunkSize);
      rows.push(chunk);
    }
    return ctx.reply(
      ctx.i18n.t('choose_currency'),
      Markup.inlineKeyboard(rows)
    );
  },
  async fiatAmount(ctx: MainContext) {
    const { currency } = wizardState(ctx);
    return ctx.reply(ctx.i18n.t('enter_currency_amount', { currency }));
  },
  async sats(ctx: MainContext) {
    /*
    const button = Markup.button.callback(
      ctx.i18n.t('market_price'),
      'marketPrice'
    );
    */
    const { currency, fiatAmount } = wizardState(ctx);
    return ctx.reply(
      ctx.i18n.t('enter_sats_amount', { fiatAmount, currency })
      // Markup.inlineKeyboard([button])
    );
  },
};

const createOrderHandlers = {
  async fiatAmount(ctx: MainContext) {
    if (ctx.message === undefined) return ctx.scene.leave();
    wizardState(ctx).error = null;
    await ctx.deleteMessage();
    const inputs = (ctx.message as any)?.text.split('-').map(Number);
    // ranges like [100, 0, 2] (originate from ranges like 100--2)
    // will make this conditional fail
    if (inputs.length > 2) {
      wizardState(ctx).error = ctx.i18n.t('must_be_number_or_range');
      await wizardState(ctx).updateUI();
      return false;
    }

    if (inputs.length === 2 && inputs[1] <= inputs[0]) {
      wizardState(ctx).error = ctx.i18n.t('must_be_number_or_range');
      await wizardState(ctx).updateUI();
      return false;
    }
    const notNumbers = inputs.filter(isNaN);
    if (notNumbers.length) {
      wizardState(ctx).error = ctx.i18n.t('not_number');
      await wizardState(ctx).updateUI();
      return;
    }
    const zeros = inputs.filter((n: number) => n === 0);
    if (zeros.length) {
      wizardState(ctx).error = ctx.i18n.t('not_zero');
      await wizardState(ctx).updateUI();
      return;
    }
    if (inputs.length > 1) wizardState(ctx).sats = 0;

    wizardState(ctx).fiatAmount = inputs;
    await wizardState(ctx).updateUI();

    return true;
  },
  async sats(ctx: MainContext) {
    if (ctx.callbackQuery) {
      wizardState(ctx).sats = 0;
      await wizardState(ctx).updateUI();
      return true;
    }
    const input = (ctx.message as any)?.text || 'DUMMY';
    await ctx.deleteMessage();
    if (isNaN(input)) {
      wizardState(ctx).error = ctx.i18n.t('not_number');
      await wizardState(ctx).updateUI();
      return;
    }
    if (input < 0) {
      wizardState(ctx).error = ctx.i18n.t('not_negative');
      await wizardState(ctx).updateUI();
      return;
    }
    wizardState(ctx).sats = parseInt(input, 10);
    await wizardState(ctx).updateUI();
    return true;
  },
};
