import { describe, expect, it } from "vitest";
import en from "../src/renderer/clawd-migrated/locales/en.json";
import zh from "../src/renderer/clawd-migrated/locales/zh.json";
import { formatI18n } from "../src/renderer/clawd-migrated/useI18n";

function flatten(value: unknown, prefix = "", output: Record<string, string> = {}): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") output[path] = child;
    else flatten(child, path, output);
  }
  return output;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();
}

describe("i18n catalogs", () => {
  it("keeps locale keys and interpolation placeholders aligned", () => {
    const english = flatten(en);
    const chinese = flatten(zh);
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort());
    for (const key of Object.keys(english)) {
      expect(placeholders(english[key]), key).toEqual(placeholders(chinese[key]));
    }
  });

  it("keeps Chinese text out of the English catalog", () => {
    const mixed = Object.entries(flatten(en)).filter(([, message]) => /\p{Script=Han}/u.test(message));
    expect(mixed).toEqual([]);
  });

  it("formats each locale's complete sentence without imposing one language's word order", () => {
    expect(formatI18n(en.dshResources.switchedTo, { name: "Focused" })).toBe('Switched to "Focused".');
    expect(formatI18n(zh.dshResources.switchedTo, { name: "专注模式" })).toBe("已切换到「专注模式」。");
    expect(formatI18n("{name} {index}", { name: "{index}", index: 2 })).toBe("{index} 2");
  });
});
