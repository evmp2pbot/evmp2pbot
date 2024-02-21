const {
  validateUser,
  validateAdmin,
  validateSuperAdmin,
} = require('../validations');

exports.userMiddleware = async (ctx, next) => {
  const user = await validateUser(ctx, false);
  if (!user) return false;
  ctx.i18n.locale(user.lang);
  ctx.user = user;

  return next();
};

exports.adminMiddleware = async (ctx, next) => {
  const admin = await validateAdmin(ctx);
  if (!admin) return false;
  ctx.i18n.locale(admin.lang);
  ctx.admin = admin;

  return next();
};

exports.superAdminMiddleware = async (ctx, next) => {
  const admin = await validateSuperAdmin(ctx);
  if (!admin) return false;
  ctx.i18n.locale(admin.lang);
  ctx.admin = admin;

  return next();
};
