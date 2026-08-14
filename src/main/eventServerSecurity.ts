import type { IncomingHttpHeaders } from "node:http";

export const EVENT_SERVER_DEV_ORIGIN = "http://127.0.0.1:5273";

export function isAcceptedEventServerRequest(method: string | undefined, headers: IncomingHttpHeaders): boolean {
  const origin = headers.origin;
  if (Array.isArray(origin)) return false;
  if (origin !== undefined && origin !== EVENT_SERVER_DEV_ORIGIN) return false;
  if (method === "POST") {
    const contentType = headers["content-type"];
    if (Array.isArray(contentType)) return false;
    if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) return false;
  }
  return true;
}
