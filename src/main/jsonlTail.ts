import { open, stat } from "node:fs/promises";

/**
 * Visit the last `maxBytes` bytes of a JSONL file, line by line.
 *
 * The retained region is read as RAW bytes and decoded as a single UTF-8 buffer, so
 * a multibyte character (e.g. CJK) straddling the byte cut is never split into
 * replacement chars — the previous `createReadStream({ encoding: "utf8", start })`
 * decoded from a raw byte offset that could land mid-character, mangling the boundary
 * line (and, when the cut hit exactly a line boundary, dropping a *complete* line).
 *
 * When we cut into the file we read one extra leading byte so we can tell whether
 * `start` already begins a line: if the byte before it is a newline the first line is
 * complete and kept; otherwise the first (partial) line is dropped up to and including
 * the next newline. I/O is async (fs/promises) so a large tail never blocks the loop.
 */
export async function visitJsonlTail(
  filePath: string,
  maxBytes: number,
  visit: (line: string, index: number) => void
) {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be positive");
  const { size } = await stat(filePath);
  const start = Math.max(0, size - Math.floor(maxBytes));
  const readFrom = start > 0 ? start - 1 : 0;
  const length = size - readFrom;

  let buffer = Buffer.allocUnsafe(length);
  const handle = await open(filePath, "r");
  try {
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buffer, read, length - read, readFrom + read);
      if (bytesRead <= 0) break;
      read += bytesRead;
    }
    if (read < length) buffer = buffer.subarray(0, read);
  } finally {
    await handle.close();
  }

  let text: string;
  if (start === 0) {
    text = buffer.toString("utf8");
  } else if (buffer[0] === 0x0a) {
    // `start` begins a complete line (byte before it is a newline).
    text = buffer.toString("utf8", 1);
  } else {
    // `start` is mid-line (possibly mid-character): drop through the next newline so
    // decoding begins on a clean line/character boundary.
    const newline = buffer.indexOf(0x0a);
    if (newline === -1) return { truncated: true, linesRead: 0 };
    text = buffer.toString("utf8", newline + 1);
  }

  // Split into lines without the terminator; a trailing "" from a final newline is not
  // a line (matching readline). Tolerate CRLF. Blank interior lines are preserved (the
  // caller skips them) so line indices stay consistent.
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();

  let index = 0;
  for (const rawLine of parts) {
    visit(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine, index);
    index += 1;
  }

  return { truncated: start > 0, linesRead: index };
}
