// @ts-nocheck
import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

const locales = { zh, en } as const;
type LocaleKey = keyof typeof locales;
type Messages = typeof zh;

const I18nContext = createContext<{
  t: (path: string, fallback?: string) => string;
  locale: LocaleKey;
  setLocale: (locale: LocaleKey) => void;
}>({
  t: (p: string, f?: string) => f ?? p,
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

export function I18nProvider({ children, initialLocale = "zh" }: { children: React.ReactNode; initialLocale?: LocaleKey }) {
  const [locale, setLocaleState] = useState<LocaleKey>(initialLocale);

  useEffect(() => {
    setLocaleState(initialLocale);
  }, [initialLocale]);

  const t = useCallback((path: string, fallback?: string) => {
    const msgs = locales[locale];
    const val = deepGet(msgs, path);
    return val ?? fallback ?? path;
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

