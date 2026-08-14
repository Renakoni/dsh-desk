import { describe, expect, it } from "vitest";
import {
  ModelPricingMemo,
  computeClaudeCost,
  embeddedDeepSeekPricing,
  findDynamicPricingRate,
  parseDeepSeekOfficialPricing,
  parseLiteLlmPricing,
  parseModelsDevPricing,
  pricingRatesAt,
  resolveModelPricingRates,
  type ModelPricingRates
} from "../src/main/claudePricing";

const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 0, cacheCreationTokens: 0 };

describe("resolveModelPricingRates (hardcoded fallback, no dynamic table)", () => {
  it("prices known Claude tiers", () => {
    expect(resolveModelPricingRates(null, "claude-sonnet-4-6")).toEqual({ input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 });
    expect(resolveModelPricingRates(null, "anthropic/claude-opus-4-8")).toEqual({ input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 });
    expect(resolveModelPricingRates(null, "claude-haiku-4-5")).toEqual({ input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 });
  });

  it("returns null for an unknown model", () => {
    expect(resolveModelPricingRates(null, "totally-unknown-model")).toBeNull();
  });
});

describe("findDynamicPricingRate", () => {
  const rates = new Map<string, ModelPricingRates>([
    ["claude-sonnet-4-6", { input: 3, output: 15 }],
    ["claude-sonnet-4-6-1m", { input: 6, output: 22.5 }]
  ]);

  it("prefers an exact normalized match", () => {
    expect(findDynamicPricingRate(rates, "anthropic/claude-sonnet-4-6")).toEqual({ input: 3, output: 15 });
  });

  it("falls back to the longest fuzzy match", () => {
    expect(findDynamicPricingRate(rates, "claude-sonnet-4-6-1m-preview")).toEqual({ input: 6, output: 22.5 });
  });

  it("returns null when the table is empty or null", () => {
    expect(findDynamicPricingRate(null, "x")).toBeNull();
    expect(findDynamicPricingRate(new Map(), "x")).toBeNull();
  });
});

describe("parseLiteLlmPricing", () => {
  it("normalizes keys, converts per-token to per-million, and skips entries missing input/output", () => {
    const parsed = parseLiteLlmPricing({
      "anthropic/claude-sonnet-4-6": { input_cost_per_token: 0.000003, output_cost_per_token: 0.000015, cache_read_input_token_cost: 0.0000003 },
      "no-output": { input_cost_per_token: 0.000001 }
    });
    expect(parsed.get("claude-sonnet-4-6")).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: undefined });
    expect(parsed.has("no-output")).toBe(false);
  });
});

describe("DeepSeek V4 pricing sources", () => {
  const officialHtml = `
    <table>
      <tr><td>MODEL</td><td>deepseek-v4-flash</td><td>deepseek-v4-pro</td></tr>
      <tr><td>PRICING</td><td>1M INPUT TOKENS (CACHE HIT)</td><td>$0.0028</td><td>$0.003625</td></tr>
      <tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>$0.14</td><td>$0.435</td></tr>
      <tr><td>1M OUTPUT TOKENS</td><td>$0.28</td><td>$0.87</td></tr>
    </table>
    <table>
      <tr><td>MODEL</td><td>1M INPUT TOKENS (CACHE HIT)</td><td>1M INPUT TOKENS (CACHE MISS)</td><td>1M OUTPUT TOKENS</td></tr>
      <tr><td>deepseek-v4-flash</td><td>OFF-PEAK</td><td>$0.007</td><td>$0.22</td><td>$0.66</td></tr>
      <tr><td>PEAK</td><td>$0.014</td><td>$0.44</td><td>$1.32</td></tr>
      <tr><td>deepseek-v4-pro</td><td>OFF-PEAK</td><td>$0.022</td><td>$0.66</td><td>$1.98</td></tr>
      <tr><td>PEAK</td><td>$0.044</td><td>$1.32</td><td>$3.96</td></tr>
    </table>`;

  it("parses the authoritative current and announced time-of-use tables", () => {
    const parsed = parseDeepSeekOfficialPricing(officialHtml);
    expect(parsed.get("deepseek-v4-flash")).toEqual(expect.objectContaining({
      input: 0.14,
      output: 0.28,
      cacheRead: 0.0028,
      cacheWrite: 0.14,
      timeOfUse: expect.objectContaining({
        offPeak: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0.22 },
        peak: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 }
      })
    }));
    expect(parsed.get("deepseek-v4-pro")).toEqual(expect.objectContaining({ input: 0.435, output: 0.87, cacheRead: 0.003625 }));
  });

  it("uses request timestamps for the announced peak and off-peak rates", () => {
    const flash = parseDeepSeekOfficialPricing(officialHtml).get("deepseek-v4-flash")!;
    expect(pricingRatesAt(flash, Date.UTC(2026, 7, 17, 2))).toEqual({ input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 });
    expect(pricingRatesAt(flash, Date.UTC(2026, 7, 17, 5))).toEqual({ input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0.22 });
    expect(pricingRatesAt(flash, Date.UTC(2026, 7, 15, 2))).toEqual(expect.objectContaining({ input: 0.14, output: 0.28 }));
  });

  it("parses the structured models.dev fallback", () => {
    const parsed = parseModelsDevPricing({
      deepseek: { models: {
        "deepseek-v4-flash": { cost: { input: 0.14, output: 0.28, cache_read: 0.0028 } },
        "deepseek-v4-pro": { cost: { input: 0.435, output: 0.87, cache_read: 0.003625 } }
      } }
    });
    expect(parsed.get("deepseek-v4-pro")).toEqual({ input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0.435 });
  });

  it("keeps an embedded non-zero fallback for both DSH default models", () => {
    const embedded = embeddedDeepSeekPricing();
    expect(embedded.get("deepseek-v4-flash")?.input).toBe(0.14);
    expect(resolveModelPricingRates(null, "deepseek-v4-pro")?.output).toBe(0.87);
  });
});

describe("computeClaudeCost", () => {
  it("computes cost from the resolved (hardcoded) rates", () => {
    const { costUsd, priced } = computeClaudeCost(null, "claude-sonnet-4-6", usage);
    // 1M input * $3/M + 0.5M output * $15/M = 3 + 7.5
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(10.5, 6);
  });

  it("reports unpriced for an unknown model", () => {
    expect(computeClaudeCost(null, "unknown", usage)).toEqual({ costUsd: 0, priced: false });
  });
});

describe("ModelPricingMemo", () => {
  it("returns the same result as the non-memoized resolver", () => {
    const memo = new ModelPricingMemo();
    for (const model of ["claude-sonnet-4-6", "claude-opus-4-8", "unknown"]) {
      expect(memo.resolve(null, model)).toEqual(resolveModelPricingRates(null, model));
    }
  });

  it("caches within one table but re-resolves when the table instance changes", () => {
    const memo = new ModelPricingMemo();
    const tableA = new Map<string, ModelPricingRates>([["my-model", { input: 1, output: 2 }]]);
    const tableB = new Map<string, ModelPricingRates>([["my-model", { input: 9, output: 9 }]]);

    expect(memo.resolve(tableA, "my-model")).toEqual({ input: 1, output: 2 });
    expect(memo.resolve(tableA, "my-model")).toEqual({ input: 1, output: 2 }); // cached
    expect(memo.resolve(tableB, "my-model")).toEqual({ input: 9, output: 9 }); // invalidated
  });

  it("cost() matches computeClaudeCost", () => {
    const memo = new ModelPricingMemo();
    expect(memo.cost(null, "claude-sonnet-4-6", usage)).toEqual(computeClaudeCost(null, "claude-sonnet-4-6", usage));
  });
});
