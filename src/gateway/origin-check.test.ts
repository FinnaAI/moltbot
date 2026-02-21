import { describe, expect, it } from "vitest";
import { checkBrowserOrigin, resolveEffectiveAllowedOrigins } from "./origin-check.js";

describe("checkBrowserOrigin", () => {
  it("accepts same-origin host matches", () => {
    const result = checkBrowserOrigin({
      requestHost: "127.0.0.1:18789",
      origin: "http://127.0.0.1:18789",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts loopback host mismatches for dev", () => {
    const result = checkBrowserOrigin({
      requestHost: "127.0.0.1:18789",
      origin: "http://localhost:5173",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts allowlisted origins", () => {
    const result = checkBrowserOrigin({
      requestHost: "gateway.example.com:18789",
      origin: "https://control.example.com",
      allowedOrigins: ["https://control.example.com"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing origin", () => {
    const result = checkBrowserOrigin({
      requestHost: "gateway.example.com:18789",
      origin: "",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects mismatched origins", () => {
    const result = checkBrowserOrigin({
      requestHost: "gateway.example.com:18789",
      origin: "https://attacker.example.com",
    });
    expect(result.ok).toBe(false);
  });
});

describe("resolveEffectiveAllowedOrigins", () => {
  it("returns config origins when no env var", () => {
    const result = resolveEffectiveAllowedOrigins(["https://a.example.com"], {
      OPENCLAW_ALLOWED_ORIGINS: undefined,
    });
    expect(result).toEqual(["https://a.example.com"]);
  });

  it("returns env origins when no config origins", () => {
    const result = resolveEffectiveAllowedOrigins(undefined, {
      OPENCLAW_ALLOWED_ORIGINS: "https://b.example.com",
    });
    expect(result).toEqual(["https://b.example.com"]);
  });

  it("merges config and env origins", () => {
    const result = resolveEffectiveAllowedOrigins(["https://a.example.com"], {
      OPENCLAW_ALLOWED_ORIGINS: "https://b.example.com",
    });
    expect(result).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("deduplicates merged origins", () => {
    const result = resolveEffectiveAllowedOrigins(["https://a.example.com"], {
      OPENCLAW_ALLOWED_ORIGINS: "https://a.example.com,https://b.example.com",
    });
    expect(result).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("handles empty env var", () => {
    const result = resolveEffectiveAllowedOrigins(["https://a.example.com"], {
      OPENCLAW_ALLOWED_ORIGINS: "",
    });
    expect(result).toEqual(["https://a.example.com"]);
  });

  it("returns empty when both sources are empty", () => {
    const result = resolveEffectiveAllowedOrigins(undefined, {
      OPENCLAW_ALLOWED_ORIGINS: undefined,
    });
    expect(result).toEqual([]);
  });

  it("trims whitespace from env var entries", () => {
    const result = resolveEffectiveAllowedOrigins([], {
      OPENCLAW_ALLOWED_ORIGINS: " https://a.example.com , https://b.example.com ",
    });
    expect(result).toEqual(["https://a.example.com", "https://b.example.com"]);
  });
});
