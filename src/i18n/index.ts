import { cs } from './messages/cs';
import { de } from './messages/de';
import { en, type MessageKey, type Messages } from './messages/en';
import { es } from './messages/es';
import { fr } from './messages/fr';
import { it } from './messages/it';
import { pl } from './messages/pl';
import { zh } from './messages/zh';

export type { MessageKey, Messages };

export const LOCALES = ['en', 'cs', 'de', 'fr', 'es', 'it', 'pl', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const MESSAGES: Readonly<Record<Locale, Messages>> = { en, cs, de, fr, es, it, pl, zh };

/** Language names in their own language, as a language picker should show them. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  cs: 'Čeština',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  it: 'Italiano',
  pl: 'Polski',
  zh: '中文',
};

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** Picks the first supported language from the browser's preference list (`navigator.languages`). */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    // Slovak readers are generally served better by Czech than by English.
    const candidate = base === 'sk' ? 'cs' : base;
    if (isLocale(candidate)) return candidate;
  }
  return DEFAULT_LOCALE;
}

export type Vars = Readonly<Record<string, string | number>>;

/** Replaces `{name}` placeholders. Unknown placeholders are left visible to surface bugs. */
export const format = (template: string, vars: Vars = {}): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));

export const placeholders = (template: string): string[] => [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
