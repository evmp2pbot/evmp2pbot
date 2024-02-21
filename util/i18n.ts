import { pluralize } from '@grammyjs/i18n';

export const GLOBAL_TRANSLATION_CONTEXT_GETTERS = [] as (() => Record<
  string,
  unknown
>)[];

GLOBAL_TRANSLATION_CONTEXT_GETTERS.push(() => ({ pluralize }));

export const getI18nGlobalContext = () =>
  Object.assign({}, ...GLOBAL_TRANSLATION_CONTEXT_GETTERS.map(x => x()));
