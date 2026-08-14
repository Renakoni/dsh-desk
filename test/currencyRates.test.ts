import { describe, expect, it } from "vitest";
import { formatUsdInCurrency, parseExchangeApiRates } from "../src/shared/currency";

describe("currency rates", () => {
  it("accepts the open-source Exchange API USD payload", () => {
    expect(parseExchangeApiRates({ usd: { cny: 6.744, eur: 0.867 } })).toEqual({ CNY: 6.744, USD: 1, EUR: 0.867 });
    expect(parseExchangeApiRates({ usd: { cny: 0, eur: 0.867 } })).toBeNull();
  });

  it("keeps positive sub-cent costs visible in every display currency", () => {
    const rates = { CNY: 6.744, USD: 1, EUR: 0.867 };
    expect(formatUsdInCurrency(0.0034, "CNY", rates, "zh-CN")).toBe("¥0.02");
    expect(formatUsdInCurrency(0.0034, "USD", rates, "en-US")).toBe("$0.0034");
    expect(formatUsdInCurrency(0.0034, "EUR", rates, "en-US")).toBe("€0.0029");
  });
});
