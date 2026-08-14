/**
 * Token pricing resolution and upstream parsers, extracted from index.ts so
 * it is unit-testable (no Electron / fs / fetch). The main process owns fetching &
 * caching the dynamic LiteLLM table; this module turns a (model, usage) pair into a
 * cost, and memoizes the per-model rate resolution.
 *
 * Why the memo matters: resolving a model that isn't an exact key does a fuzzy scan
 * over the whole ~1000-entry LiteLLM map. A cold token-stats scan calls this for
 * thousands of records, but across only a handful of distinct models — so caching
 * the resolved rate per model turns thousands of O(n log n) scans into a few.
 */

import { parse } from "node-html-parser";

export type BaseModelPricingRates = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

export type ModelPricingRates = BaseModelPricingRates & {
  timeOfUse?: {
    effectiveAt: number;
    peakHoursUtc: Array<[start: number, end: number]>;
    peak: BaseModelPricingRates;
    offPeak: BaseModelPricingRates;
  };
};

export interface PricingUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  timestamp?: number;
}

export const DEEPSEEK_PRICING_EFFECTIVE_AT = Date.UTC(2026, 7, 16, 16, 0, 0);
const DEEPSEEK_PEAK_HOURS_UTC: Array<[number, number]> = [[1, 4], [6, 10]];
const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;

const EMBEDDED_DEEPSEEK_RATES: Record<typeof DEEPSEEK_MODELS[number], ModelPricingRates> = {
  "deepseek-v4-flash": {
    input: 0.14,
    output: 0.28,
    cacheRead: 0.0028,
    cacheWrite: 0.14,
    timeOfUse: {
      effectiveAt: DEEPSEEK_PRICING_EFFECTIVE_AT,
      peakHoursUtc: DEEPSEEK_PEAK_HOURS_UTC,
      offPeak: { input: 0.22, output: 0.66, cacheRead: 0.007, cacheWrite: 0.22 },
      peak: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0.44 }
    }
  },
  "deepseek-v4-pro": {
    input: 0.435,
    output: 0.87,
    cacheRead: 0.003625,
    cacheWrite: 0.435,
    timeOfUse: {
      effectiveAt: DEEPSEEK_PRICING_EFFECTIVE_AT,
      peakHoursUtc: DEEPSEEK_PEAK_HOURS_UTC,
      offPeak: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0.66 },
      peak: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 1.32 }
    }
  }
};

function cloneRates(rates: ModelPricingRates): ModelPricingRates {
  return {
    ...rates,
    ...(rates.timeOfUse ? {
      timeOfUse: {
        ...rates.timeOfUse,
        peakHoursUtc: rates.timeOfUse.peakHoursUtc.map(([start, end]) => [start, end]),
        peak: { ...rates.timeOfUse.peak },
        offPeak: { ...rates.timeOfUse.offPeak }
      }
    } : {})
  };
}

export function embeddedDeepSeekPricing(): Map<string, ModelPricingRates> {
  return new Map(DEEPSEEK_MODELS.map(model => [model, cloneRates(EMBEDDED_DEEPSEEK_RATES[model])]));
}

export function normalizePricingModel(model: string): string {
  return model.toLowerCase().replace(/^(anthropic|openai|github-copilot|openrouter|deepseek)\//, "").trim();
}

export function ratesFromLiteLlmEntry(entry: Record<string, unknown>): ModelPricingRates | null {
  const input = typeof entry.input_cost_per_token === "number" ? entry.input_cost_per_token * 1_000_000 : undefined;
  const output = typeof entry.output_cost_per_token === "number" ? entry.output_cost_per_token * 1_000_000 : undefined;
  if (!input || !output) return null;
  const cacheRead = typeof entry.cache_read_input_token_cost === "number" ? entry.cache_read_input_token_cost * 1_000_000 : undefined;
  const cacheWrite = typeof entry.cache_creation_input_token_cost === "number" ? entry.cache_creation_input_token_cost * 1_000_000 : undefined;
  return { input, output, cacheRead, cacheWrite };
}

export function parseLiteLlmPricing(data: unknown): Map<string, ModelPricingRates> {
  const rates = new Map<string, ModelPricingRates>();
  if (!data || typeof data !== "object" || Array.isArray(data)) return rates;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const parsed = ratesFromLiteLlmEntry(value as Record<string, unknown>);
    if (parsed) {
      const normalized = normalizePricingModel(key);
      if (DEEPSEEK_MODELS.includes(normalized as typeof DEEPSEEK_MODELS[number]) && parsed.cacheWrite === 0) {
        parsed.cacheWrite = parsed.input;
      }
      rates.set(normalized, parsed);
    }
  }
  return rates;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseModelsDevPricing(data: unknown): Map<string, ModelPricingRates> {
  const rates = new Map<string, ModelPricingRates>();
  const root = objectValue(data);
  const deepseek = objectValue(root?.deepseek);
  const models = objectValue(deepseek?.models);
  if (!models) return rates;
  for (const model of DEEPSEEK_MODELS) {
    const entry = objectValue(models[model]);
    const cost = objectValue(entry?.cost);
    if (!cost) continue;
    const input = cost.input;
    const output = cost.output;
    if (typeof input !== "number" || input <= 0 || typeof output !== "number" || output <= 0) continue;
    const cacheRead = typeof cost.cache_read === "number" && cost.cache_read >= 0 ? cost.cache_read : undefined;
    rates.set(model, { input, output, cacheRead, cacheWrite: input });
  }
  return rates;
}

function pricesInRow(cells: string[]): number[] {
  return cells.flatMap(cell => {
    const match = cell.match(/\$\s*(\d+(?:\.\d+)?)/);
    return match ? [Number(match[1])] : [];
  });
}

function ratesFromPrices(prices: number[]): BaseModelPricingRates | null {
  if (prices.length < 3 || prices.some(price => !Number.isFinite(price) || price < 0)) return null;
  return { cacheRead: prices[0], input: prices[1], cacheWrite: prices[1], output: prices[2] };
}

export function parseDeepSeekOfficialPricing(html: string): Map<string, ModelPricingRates> {
  const root = parse(html);
  const current = new Map<string, BaseModelPricingRates>();
  const scheduled = new Map<string, { peak?: BaseModelPricingRates; offPeak?: BaseModelPricingRates }>();

  for (const table of root.querySelectorAll("table")) {
    const rows = table.querySelectorAll("tr").map(row => row.querySelectorAll("th, td").map(cell => cell.text.trim().replace(/\s+/g, " ")));
    const tableText = rows.flat().join(" ").toLowerCase();
    if (!DEEPSEEK_MODELS.every(model => tableText.includes(model))) continue;

    const cacheHit = rows.find(row => row.some(cell => cell.toLowerCase().includes("cache hit")));
    const cacheMiss = rows.find(row => row.some(cell => cell.toLowerCase().includes("cache miss")));
    const output = rows.find(row => row.some(cell => cell.toLowerCase().includes("output tokens")));
    const hitPrices = cacheHit ? pricesInRow(cacheHit) : [];
    const missPrices = cacheMiss ? pricesInRow(cacheMiss) : [];
    const outputPrices = output ? pricesInRow(output) : [];
    if (hitPrices.length >= 2 && missPrices.length >= 2 && outputPrices.length >= 2) {
      DEEPSEEK_MODELS.forEach((model, index) => current.set(model, {
        cacheRead: hitPrices[index],
        input: missPrices[index],
        cacheWrite: missPrices[index],
        output: outputPrices[index]
      }));
    }

    let activeModel: typeof DEEPSEEK_MODELS[number] | undefined;
    for (const row of rows) {
      const normalized = row.map(cell => cell.toLowerCase());
      activeModel = DEEPSEEK_MODELS.find(model => normalized.some(cell => cell.includes(model))) ?? activeModel;
      const band = normalized.some(cell => cell === "off-peak") ? "offPeak"
        : normalized.some(cell => cell === "peak") ? "peak" : undefined;
      if (!activeModel || !band) continue;
      const parsed = ratesFromPrices(pricesInRow(row));
      if (!parsed) continue;
      scheduled.set(activeModel, { ...scheduled.get(activeModel), [band]: parsed });
    }
  }

  const result = new Map<string, ModelPricingRates>();
  for (const model of DEEPSEEK_MODELS) {
    const base = current.get(model);
    const schedule = scheduled.get(model);
    if (!base && (!schedule?.peak || !schedule.offPeak)) continue;
    const fallback = EMBEDDED_DEEPSEEK_RATES[model];
    result.set(model, {
      ...(base ?? fallback),
      ...(schedule?.peak && schedule.offPeak ? {
        timeOfUse: {
          effectiveAt: DEEPSEEK_PRICING_EFFECTIVE_AT,
          peakHoursUtc: DEEPSEEK_PEAK_HOURS_UTC.map(([start, end]) => [start, end]),
          peak: schedule.peak,
          offPeak: schedule.offPeak
        }
      } : {})
    });
  }
  return result;
}

export function pricingRatesSignature(rates: Map<string, ModelPricingRates>): string {
  return JSON.stringify([...rates.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function findDynamicPricingRate(rates: Map<string, ModelPricingRates> | null, model: string): ModelPricingRates | null {
  if (!rates || rates.size === 0) return null;
  const normalized = normalizePricingModel(model).replace(/_/g, "-");
  if (rates.has(normalized)) return rates.get(normalized)!;
  const candidates = Array.from(rates.entries())
    .filter(([key]) => normalized === key || normalized.includes(key) || key.includes(normalized))
    .sort((a, b) => b[0].length - a[0].length);
  return candidates[0]?.[1] ?? null;
}

export function resolveModelPricingRates(rates: Map<string, ModelPricingRates> | null, model: string): ModelPricingRates | null {
  const dynamic = findDynamicPricingRate(rates, model);
  if (dynamic) return dynamic;
  const normalized = normalizePricingModel(model).replace(/_/g, "-");
  if (DEEPSEEK_MODELS.includes(normalized as typeof DEEPSEEK_MODELS[number])) {
    return cloneRates(EMBEDDED_DEEPSEEK_RATES[normalized as typeof DEEPSEEK_MODELS[number]]);
  }

  if (normalized.includes("claude")) {
    if (normalized.includes("fable") || normalized.includes("mythos")) return { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 };
    if (normalized.includes("opus-4-8") || normalized.includes("opus-4.8") || normalized.includes("opus-4-7") || normalized.includes("opus-4.7") || normalized.includes("opus-4-6") || normalized.includes("opus-4.6") || normalized.includes("opus-4-5") || normalized.includes("opus-4.5")) return { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
    if (normalized.includes("opus")) return { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 };
    if (normalized.includes("sonnet")) return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
    if (normalized.includes("haiku-4-5") || normalized.includes("haiku-4.5")) return { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
    if (normalized.includes("haiku")) return { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 };
  }

  if (normalized.includes("gpt-5.5") || normalized.includes("gpt-5-5")) return { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 };
  if (normalized.includes("gpt-5.4-mini") || normalized.includes("gpt-5-4-mini")) return { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 };
  if (normalized.includes("gpt-5.4") || normalized.includes("gpt-5-4")) return { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 };
  if (normalized.includes("gpt-5-codex")) return { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 };
  if (normalized === "gpt-5" || normalized.startsWith("gpt-5-")) return { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 };
  if (normalized.includes("gpt-4.1-mini") || normalized.includes("gpt-4-1-mini")) return { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 };
  if (normalized.includes("gpt-4.1-nano") || normalized.includes("gpt-4-1-nano")) return { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 };
  if (normalized.includes("gpt-4.1") || normalized.includes("gpt-4-1")) return { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 };
  if (normalized.includes("gpt-4o-mini")) return { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 };
  if (normalized.includes("gpt-4o")) return { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 };

  return null;
}

export function pricingRatesAt(rates: ModelPricingRates, timestamp = Date.now()): BaseModelPricingRates {
  const schedule = rates.timeOfUse;
  if (!schedule || timestamp < schedule.effectiveAt) return rates;
  const hour = new Date(timestamp).getUTCHours();
  return schedule.peakHoursUtc.some(([start, end]) => hour >= start && hour < end) ? schedule.peak : schedule.offPeak;
}

function costFromRates(rates: ModelPricingRates, usage: PricingUsage): number {
  const effectiveRates = pricingRatesAt(rates, usage.timestamp);
  const cacheWrite = effectiveRates.cacheWrite ?? effectiveRates.input * 1.25;
  const cacheRead = effectiveRates.cacheRead ?? effectiveRates.input * 0.1;
  return (
    usage.inputTokens * effectiveRates.input +
    usage.cacheCreationTokens * cacheWrite +
    usage.cacheReadTokens * cacheRead +
    usage.outputTokens * effectiveRates.output
  ) / 1_000_000;
}

export function computeClaudeCost(rates: Map<string, ModelPricingRates> | null, model: string, usage: PricingUsage): { costUsd: number; priced: boolean } {
  const resolved = resolveModelPricingRates(rates, model);
  if (!resolved) return { costUsd: 0, priced: false };
  return { costUsd: costFromRates(resolved, usage), priced: true };
}

/**
 * Memoizes per-model rate resolution. The cache is keyed by the raw model string
 * and reset whenever the dynamic table *instance* changes (first load / refresh),
 * so results are always consistent with the current table. Bounded by the number
 * of distinct model strings seen (a handful in practice).
 */
export class ModelPricingMemo {
  private memo = new Map<string, ModelPricingRates | null>();
  private source: Map<string, ModelPricingRates> | null = null;

  resolve(rates: Map<string, ModelPricingRates> | null, model: string): ModelPricingRates | null {
    if (this.source !== rates) {
      this.memo.clear();
      this.source = rates;
    }
    if (this.memo.has(model)) return this.memo.get(model)!;
    const resolved = resolveModelPricingRates(rates, model);
    this.memo.set(model, resolved);
    return resolved;
  }

  cost(rates: Map<string, ModelPricingRates> | null, model: string, usage: PricingUsage): { costUsd: number; priced: boolean } {
    const resolved = this.resolve(rates, model);
    if (!resolved) return { costUsd: 0, priced: false };
    return { costUsd: costFromRates(resolved, usage), priced: true };
  }
}
