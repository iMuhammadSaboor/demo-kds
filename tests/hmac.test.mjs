// ===========================================================
// tests/hmac.test.mjs
//   Unit tests for the Square webhook HMAC-SHA256 verifier
//   (lib/hmac.mjs). These run without any server or env vars.
// ===========================================================

import { describe, it, expect } from "vitest";
import { verifySquareSig, computeSquareSig } from "../lib/hmac.mjs";

const SIG_KEY  = "test-signature-key-abcdef-1234567890";
const HOOK_URL = "https://demo-kds1.onrender.com/square/webhook";
const RAW_BODY = JSON.stringify({
  type: "order.created",
  event_id: "evt_123",
  data: { id: "ORDER_ABC", type: "order" },
});

describe("verifySquareSig", () => {
  it("accepts a valid signature for the exact body and url", () => {
    const sig = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    expect(verifySquareSig(RAW_BODY, sig, SIG_KEY, HOOK_URL)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const bogus = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 random base64
    expect(verifySquareSig(RAW_BODY, bogus, SIG_KEY, HOOK_URL)).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(verifySquareSig(RAW_BODY, "", SIG_KEY, HOOK_URL)).toBe(false);
    expect(verifySquareSig(RAW_BODY, undefined, SIG_KEY, HOOK_URL)).toBe(false);
    expect(verifySquareSig(RAW_BODY, null, SIG_KEY, HOOK_URL)).toBe(false);
  });

  it("rejects when the body has been tampered with", () => {
    const sig = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    const tamperedBody = RAW_BODY.replace("ORDER_ABC", "ORDER_XYZ");
    expect(verifySquareSig(tamperedBody, sig, SIG_KEY, HOOK_URL)).toBe(false);
  });

  it("rejects when the URL has been tampered with", () => {
    // Square's spec hashes (URL + body), so a different URL = different sig.
    // This protects against an attacker replaying a webhook against a
    // different endpoint of the same server.
    const sig = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    const wrongUrl = HOOK_URL.replace("demo-kds1", "demo-kds-evil");
    expect(verifySquareSig(RAW_BODY, sig, SIG_KEY, wrongUrl)).toBe(false);
  });

  it("rejects when the signature key is wrong", () => {
    const sig = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    expect(verifySquareSig(RAW_BODY, sig, "wrong-key", HOOK_URL)).toBe(false);
  });

  it("rejects when sigKey or hookUrl is empty (defence in depth)", () => {
    const sig = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    expect(verifySquareSig(RAW_BODY, sig, "", HOOK_URL)).toBe(false);
    expect(verifySquareSig(RAW_BODY, sig, SIG_KEY, "")).toBe(false);
  });
});

describe("computeSquareSig", () => {
  it("is deterministic — same inputs produce the same output", () => {
    const a = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    const b = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    expect(a).toBe(b);
  });

  it("produces a base64 string of the expected length (32-byte SHA256 → 44 chars)", () => {
    const sig = computeSquareSig(RAW_BODY, SIG_KEY, HOOK_URL);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(sig.length).toBe(44);
  });
});
