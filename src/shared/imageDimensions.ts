/**
 * Minimal header-only dimension parsing for the two image formats the
 * codex-pet ecosystem uses. The main process needs pixel dimensions to
 * validate a pack's sheet geometry but must not decode pixels (Chromium in
 * the renderer is the only decoder this app relies on), so this reads just
 * the container headers: PNG IHDR, and WebP VP8 / VP8L / VP8X.
 */

export interface ImageDimensions {
  width: number;
  height: number;
  format: "png" | "webp";
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function parsePng(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width < 1 || height < 1) return null;
  return { width, height, format: "png" };
}

function parseWebp(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const chunk = ascii(bytes, 12, 4);

  if (chunk === "VP8X") {
    // Extended format: 24-bit little-endian canvas size minus one.
    const width = readU24LE(bytes, 24) + 1;
    const height = readU24LE(bytes, 27) + 1;
    return { width, height, format: "webp" };
  }

  if (chunk === "VP8L") {
    // Lossless: signature byte then 14-bit width-1 / height-1, LSB-first.
    if (bytes[20] !== 0x2f) return null;
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    const width = 1 + (b1 | ((b2 & 0x3f) << 8));
    const height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
    return { width, height, format: "webp" };
  }

  if (chunk === "VP8 ") {
    // Lossy: key frame start code 0x9D 0x01 0x2A, then 14-bit dimensions.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = readU16LE(bytes, 26) & 0x3fff;
    const height = readU16LE(bytes, 28) & 0x3fff;
    if (width < 1 || height < 1) return null;
    return { width, height, format: "webp" };
  }

  return null;
}

/** Parse PNG or WebP pixel dimensions from raw file bytes; null when unrecognized. */
export function parseImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return parsePng(bytes) ?? parseWebp(bytes);
}
