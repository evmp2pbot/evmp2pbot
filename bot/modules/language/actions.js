const { User } = require('../../../models');

exports.setLanguage = async ctx => {
  const tgId = ctx.update.callback_query.from.id;
  const user = await User.findOne({ tg_id: tgId });
  if (!user) return;
  const code = ctx.match[1];
  await ctx.deleteMessage().catch(() => {});
  user.lang = code;
  ctx.i18n.locale(code);
  await user.save();
  await ctx.reply(ctx.i18n.t('operation_successful'));
};
