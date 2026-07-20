export type Translate = (key: string, ...args: Array<boolean | number | string>) => string;

export const translate: Translate = (key, ...args) => eda.sys_I18n.text(key, undefined, undefined, ...args);
