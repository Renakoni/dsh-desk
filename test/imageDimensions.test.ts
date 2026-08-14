import { describe, expect, it } from "vitest";
import { parseImageDimensions } from "../src/shared/imageDimensions";
import { makePngHeader, makeVp8lHeader } from "./helpers/imageFixtures";

function makeVp8xHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  ascii(0, "RIFF");
  ascii(8, "WEBP");
  ascii(12, "VP8X");
  bytes[16] = 10; // chunk size
  const w = width - 1;
  const h = height - 1;
  bytes[24] = w & 0xff;
  bytes[25] = (w >> 8) & 0xff;
  bytes[26] = (w >> 16) & 0xff;
  bytes[27] = h & 0xff;
  bytes[28] = (h >> 8) & 0xff;
  bytes[29] = (h >> 16) & 0xff;
  return bytes;
}

function makeVp8Header(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  ascii(0, "RIFF");
  ascii(8, "WEBP");
  ascii(12, "VP8 ");
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  bytes[26] = width & 0xff;
  bytes[27] = (width >> 8) & 0x3f;
  bytes[28] = height & 0xff;
  bytes[29] = (height >> 8) & 0x3f;
  return bytes;
}

describe("parseImageDimensions", () => {
  it("parses the real-world lossless WebP header of the verified sample sheet", () => {
    // First 25 bytes of yuexinmiao spritesheet.webp (1536x1872 VP8L).
    const sample = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x71, 0x1a, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c,
      0xf3, 0x70, 0x1a, 0x00, 0x2f, 0xff, 0xc5, 0xd3, 0x11, 0x11, 0x89, 0x91, 0x24, 0x09
    ]);
    expect(parseImageDimensions(sample)).toEqual({ width: 1536, height: 1872, format: "webp" });
  });

  it("round-trips synthetic VP8L dimensions", () => {
    expect(parseImageDimensions(makeVp8lHeader(1536, 1872))).toEqual({ width: 1536, height: 1872, format: "webp" });
    expect(parseImageDimensions(makeVp8lHeader(256, 288))).toEqual({ width: 256, height: 288, format: "webp" });
    expect(parseImageDimensions(makeVp8lHeader(16383, 16383))).toEqual({ width: 16383, height: 16383, format: "webp" });
  });

  it("parses extended (VP8X) and lossy (VP8) WebP headers", () => {
    expect(parseImageDimensions(makeVp8xHeader(1536, 1872))).toEqual({ width: 1536, height: 1872, format: "webp" });
    expect(parseImageDimensions(makeVp8Header(1536, 1872))).toEqual({ width: 1536, height: 1872, format: "webp" });
  });

  it("parses PNG IHDR dimensions", () => {
    expect(parseImageDimensions(makePngHeader(1536, 1872))).toEqual({ width: 1536, height: 1872, format: "png" });
    expect(parseImageDimensions(makePngHeader(256, 288))).toEqual({ width: 256, height: 288, format: "png" });
  });

  it("rejects unrecognized or truncated input", () => {
    expect(parseImageDimensions(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]))).toBeNull(); // GIF
    expect(parseImageDimensions(makeVp8lHeader(1536, 1872).slice(0, 12))).toBeNull();
    expect(parseImageDimensions(new Uint8Array(0))).toBeNull();
    const badSig = makeVp8lHeader(100, 100);
    badSig[20] = 0x00; // wrong VP8L signature byte
    expect(parseImageDimensions(badSig)).toBeNull();
  });
});
