import { pluralize } from '@grammyjs/i18n';

export const GLOBAL_TRANSLATION_CONTEXT_GETTERS = [] as (() => Record<
  string,
  unknown
>)[];

GLOBAL_TRANSLATION_CONTEXT_GETTERS.push(() => ({
  pluralize,
  extWalletDisplayName: process.env.EXTWALLET_DISPLAY_NAME,
  extWalletBotHandle: process.env.EXTWALLET_BOT_HANDLE,
}));

export const getI18nGlobalContext = () =>
  Object.assign({}, ...GLOBAL_TRANSLATION_CONTEXT_GETTERS.map(x => x()));
