'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_LOCALE, detectLocale, format, isLocale, MESSAGES, type Locale, type MessageKey, type Vars } from '.';

const STORAGE_KEY = 'neje.locale';
export type LocalePreference = Locale | 'auto';

// Tiny external store so the stored preference, the browser language and other tabs stay in sync.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readPreference(): LocalePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('languagechange', listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('languagechange', listener);
    window.removeEventListener('storage', listener);
  };
}

interface I18n {
  readonly locale: Locale;
  readonly preference: LocalePreference;
  setPreference(preference: LocalePreference): void;
  t(key: MessageKey, vars?: Vars): string;
  formatNumber(value: number, maximumFractionDigits?: number): string;
  formatDate(timestamp: number): string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  // The static HTML is rendered in English; the client switches after hydration.
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'auto' as const);
  const browserLocale = useSyncExternalStore(subscribe, () => detectLocale(navigator.languages), () => DEFAULT_LOCALE);
  const locale = preference === 'auto' ? browserLocale : preference;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setPreference = useCallback((next: LocalePreference) => {
    try {
      if (next === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice then lasts for this page view only
    }
    notify();
  }, []);

  const value = useMemo<I18n>(() => {
    const messages = MESSAGES[locale];
    const numbers = new Map<number, Intl.NumberFormat>();
    const dates = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return {
      locale,
      preference,
      setPreference,
      t: (key, vars) => format(messages[key], vars),
      formatNumber: (n, digits = 1) => {
        let f = numbers.get(digits);
        if (!f) numbers.set(digits, (f = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })));
        return f.format(n);
      },
      formatDate: (ts) => dates.format(ts),
    };
  }, [locale, preference, setPreference]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
