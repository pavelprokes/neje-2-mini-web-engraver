import { describe, expect, it } from 'vitest';
import { detectLocale, format, LOCALES, MESSAGES, placeholders } from '.';
import { en } from './messages/en';

describe('translations', () => {
  const keys = Object.keys(en).sort();

  it.each(LOCALES)('%s has exactly the English keys', (locale) => {
    expect(Object.keys(MESSAGES[locale]).sort()).toEqual(keys);
  });

  it.each(LOCALES)('%s keeps every placeholder and has no empty strings', (locale) => {
    for (const key of keys) {
      const value = MESSAGES[locale][key as keyof typeof en];
      expect(value.trim(), `${locale}.${key}`).not.toBe('');
      expect(placeholders(value), `${locale}.${key}`).toEqual(placeholders(en[key as keyof typeof en]));
    }
  });
});

describe('accessible names (WCAG 2.5.3 Label in Name)', () => {
  const pairs = [
    ['historyOpen', 'historyOpenLabel'],
    ['historyApply', 'historyApplyLabel'],
    ['historyDelete', 'historyDeleteLabel'],
  ] as const;

  it.each(LOCALES)('%s aria-labels contain the visible button text', (locale) => {
    const m = MESSAGES[locale];
    for (const [visible, label] of pairs) expect(m[label].toLowerCase(), `${locale}.${label}`).toContain(m[visible].toLowerCase());
  });
});

describe('detectLocale', () => {
  it('uses the first supported browser language', () => {
    expect(detectLocale(['ja-JP', 'cs-CZ', 'en'])).toBe('cs');
    expect(detectLocale(['de-AT'])).toBe('de');
    expect(detectLocale(['zh-Hant-TW'])).toBe('zh');
  });

  it('serves Slovak with Czech and falls back to English', () => {
    expect(detectLocale(['sk-SK'])).toBe('cs');
    expect(detectLocale(['ja', 'ko'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('{a} × {b} mm', { a: 3, b: 4.5 })).toBe('3 × 4.5 mm');
    expect(format('X {x}', {})).toBe('X {x}');
  });
});
