export type DisplayCurrency = "CNY" | "USD" | "EUR";

export type CurrencyRatesStatus = {
  base: "USD";
  rates: Record<DisplayCurrency, number>;
  source: "exchange-api" | "embedded";
  updatedAt: number;
  stale: boolean;
};

export const EMBEDDED_CURRENCY_RATES: CurrencyRatesStatus["rates"] = {
  CNY: 7,
  USD: 1,
  EUR: 0.9
};

export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return value === "CNY" || value === "USD" || value === "EUR";
}

export function parseExchangeApiRates(value: unknown): CurrencyRatesStatus["rates"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usd = (value as { usd?: unknown }).usd;
  if (!usd || typeof usd !== "object" || Array.isArray(usd)) return null;
  const cny = (usd as { cny?: unknown }).cny;
  const eur = (usd as { eur?: unknown }).eur;
  if (typeof cny !== "number" || !Number.isFinite(cny) || cny <= 0) return null;
  if (typeof eur !== "number" || !Number.isFinite(eur) || eur <= 0) return null;
  return { CNY: cny, USD: 1, EUR: eur };
}

export function formatUsdInCurrency(amountUsd: number, currency: DisplayCurrency, rates: CurrencyRatesStatus["rates"], locale: string): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return "—";
  const value = amountUsd * rates[currency];
  const symbol = currency === "CNY" ? "¥" : currency === "EUR" ? "€" : "$";
  if (value < 0.000001) return `<${symbol}0.000001`;
  const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 0.01 ? 2 : value >= 0.0001 ? 4 : 6;
  return `${symbol}${value.toLocaleString(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;
}
