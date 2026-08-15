// @ts-nocheck
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

const locales = { zh, en } as const;
type LocaleKey = keyof typeof locales;
type Messages = typeof zh;
export type I18nValues = Record<string, string | number>;
export type I18nTranslate = (path: string, fallback?: string, values?: I18nValues) => string;

const I18nContext = createContext<{
  t: I18nTranslate;
  locale: LocaleKey;
  setLocale: (locale: LocaleKey) => void;
}>({
  t: (p: string, f?: string, values?: I18nValues) => formatI18n(f ?? p, values),
  locale: "zh",
  setLocale: () => {}
});

function deepGet(obj: any, path: string): string | undefined {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[k];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function formatI18n(template: string, values?: I18nValues): string {
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder);
}

export function I18nProvider({ children, initialLocale = "zh" }: { children: React.ReactNode; initialLocale?: LocaleKey }) {
  const [locale, setLocaleState] = useState<LocaleKey>(initialLocale);

  useEffect(() => {
    setLocaleState(initialLocale);
  }, [initialLocale]);

  const t = useCallback((path: string, fallback?: string, values?: I18nValues) => {
    const msgs = locales[locale];
    const val = deepGet(msgs, path);
    return formatI18n(val ?? fallback ?? path, values);
  }, [locale]);

  const setLocale = useCallback((l: LocaleKey) => {
    setLocaleState(l);
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  return (
    <I18nContext.Provider value={{ t, locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function detectLocale(): LocaleKey {
  const lang = (navigator.language || "zh").toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

