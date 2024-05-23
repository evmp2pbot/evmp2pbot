// @ts-check
const { userMiddleware } = require('../../middleware/user');
const { logger } = require('../../../logger');
const ordersActions = require('../../ordersActions');

const commands = require('./commands');
const messages = require('./messages');
const { tooManyPendingOrdersMessage } = require('../../messages');
const {
  takeOrderActionValidation,
  takeOrderValidation,
  takesell,
  takebuyValidation,
  takebuy,
} = require('./takeOrder');
const { extractId } = require('../../../util');
exports.Scenes = require('./scenes');

exports.configure = bot => {
  bot.command(
    'takeorder',
    userMiddleware,
    takeOrderValidation,
    commands.takeOrder
  );
  bot.command(
    'buy',
    userMiddleware,
    async (ctx, next) => {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) return next();
      if (ctx.message.chat.type !== 'private') return next();
      if (await commands.isMaxPending(ctx.user, 'buy'))
        return await tooManyPendingOrdersMessage(ctx, ctx.user, ctx.i18n);

      return await commands.buyWizard(ctx);
    },
    commands.buy
  );
  bot.command(
    'sell',
    userMiddleware,
    async (ctx, next) => {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) return next();
      if (ctx.message.chat.type !== 'private') return next();
      if (await commands.isMaxPending(ctx.user, 'sell'))
        return await tooManyPendingOrdersMessage(ctx, ctx.user, ctx.i18n);

      return await commands.sellWizard(ctx);
    },
    commands.sell
  );

  bot.command('listorders', userMiddleware, async ctx => {
    try {
      const orders = await ordersActions.getOrders(ctx, ctx.user);
      if (!orders) return false;

      const { text, extra } = await messages.listOrdersResponse(
        orders,
        ctx.i18n
      );
      return ctx.reply(text, extra);
    } catch (error) {
      return logger.error(error);
    }
  });

  bot.action(
    'takesell',
    userMiddleware,
    takeOrderActionValidation,
    takeOrderValidation,
    async ctx => {
      const text = ctx.update.callback_query.message.text;
      console.log('takesell', text);
      console.log(JSON.stringify(ctx.update));
      const orderId = extractId(text);
      if (!orderId) {
        logger.error('takesell: Invalid order id');
        return;
      }
      await takesell(ctx, bot, orderId);
    }
  );
  bot.action(
    'takebuy',
    userMiddleware,
    takeOrderActionValidation,
    takeOrderValidation,
    takebuyValidation,
    async ctx => {
      const text = ctx.update.callback_query.message.text;
      const orderId = extractId(text);
      if (!orderId) return;
      await takebuy(ctx, bot, orderId);
    }
  );
};
