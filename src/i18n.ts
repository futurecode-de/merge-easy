/**
 * i18n.ts – Loads translations from JSON files in the i18n/ directory.
 * Locale is auto-detected from vscode.env.language.
 *
 * Supported: en · de · es · pt · it · fr · ja · zh-TW
 *
 * (c) 2026 FUTURE[code] - Markus Feilen
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type I18n = Record<string, string>;

function loadLocale(locale: string): I18n | null {
  const file = path.join(__dirname, '..', 'i18n', `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function getI18n(): I18n {
  const lang = (vscode.env.language ?? 'en').toLowerCase();

  if (lang.startsWith('de'))                                          { return loadLocale('de') ?? loadLocale('en')!; }
  if (lang.startsWith('es'))                                          { return loadLocale('es') ?? loadLocale('en')!; }
  if (lang.startsWith('pt'))                                          { return loadLocale('pt') ?? loadLocale('en')!; }
  if (lang.startsWith('it'))                                          { return loadLocale('it') ?? loadLocale('en')!; }
  if (lang.startsWith('fr'))                                          { return loadLocale('fr') ?? loadLocale('en')!; }
  if (lang.startsWith('ja'))                                          { return loadLocale('ja') ?? loadLocale('en')!; }
  if (lang === 'zh-tw' || lang === 'zh-hant' || lang === 'zh-hk')    { return loadLocale('zh-tw') ?? loadLocale('en')!; }
  if (lang.startsWith('zh'))                                          { return loadLocale('zh-tw') ?? loadLocale('en')!; }

  return loadLocale('en')!;
}

/** Quick helper: substitute {key} placeholders in a translated string */
export function ti(i18n: I18n, key: string, vars?: Record<string, string | number>): string {
  let s = i18n[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}
