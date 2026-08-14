import type { IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import { EVENT_SERVER_DEV_ORIGIN, isAcceptedEventServerRequest } from "../src/main/eventServerSecurity";

describe("event server request boundary", () => {
  it("accepts the Node forwarder's originless JSON requests", () => {
    expect(isAcceptedEventServerRequest("POST", { "content-type": "application/json; charset=utf-8" })).toBe(true);
    expect(isAcceptedEventServerRequest("GET", {})).toBe(true);
  });

  it("rejects browser simple POSTs that bypass a JSON preflight", () => {
    expect(isAcceptedEventServerRequest("POST", { "content-type": "text/plain" })).toBe(false);
    expect(isAcceptedEventServerRequest("POST", {})).toBe(false);
  });

  it("allows only the pinned development origin when Origin is present", () => {
    expect(isAcceptedEventServerRequest("POST", {
      origin: EVENT_SERVER_DEV_ORIGIN,
      "content-type": "application/json"
    })).toBe(true);
    expect(isAcceptedEventServerRequest("POST", {
      origin: "https://attacker.example",
      "content-type": "application/json"
    })).toBe(false);
    expect(isAcceptedEventServerRequest("GET", { origin: "https://attacker.example" })).toBe(false);
    const duplicateOrigin = { origin: [EVENT_SERVER_DEV_ORIGIN, "https://attacker.example"] } as unknown as IncomingHttpHeaders;
    expect(isAcceptedEventServerRequest("GET", duplicateOrigin)).toBe(false);
  });
});
