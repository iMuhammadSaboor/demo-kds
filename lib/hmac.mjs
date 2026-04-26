// ===========================================================
// lib/hmac.mjs
//   Pure HMAC-SHA256 webhook signature verification, written
//   to Square's spec: hash the (subscription URL + raw body)
//   with the subscription's signature key, base64-encode, and
//   timing-safe-compare against the X-Square-HmacSHA256-Signature
//   header.
//
// Pulled out of server.mjs so it can be unit-tested without
// spinning up the HTTP server or touching env vars.
// ===========================================================

import crypto from "node:crypto";

/**
 * Verify a Square webhook signature.
 *
 * @param {string} rawBody    — exact raw request body as received (string)
 * @param {string} sigHeader  — value of the X-Square-HmacSHA256-Signature header
 * @param {string} sigKey     — the subscription's signature key (from Square dashboard)
 * @param {string} hookUrl    — the registered webhook URL (must match exactly what's in Square)
 * @returns {boolean} true iff the signature is valid
 */
export function verifySquareSig(rawBody, sigHeader, sigKey, hookUrl) {
  if (!sigKey || !hookUrl) return false;
  if (!sigHeader) return false;

  const expected = crypto
    .createHmac("sha256", sigKey)
    .update(hookUrl + rawBody)
    .digest("base64");

  // Timing-safe compare so attackers can't binary-search the signature
  // by measuring response time on partial matches.
  const a = Buffer.from(sigHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Compute the signature for a given body+url+key. Useful in tests and
 * for debugging "did Square send the right thing?" sessions.
 *
 * @param {string} rawBody
 * @param {string} sigKey
 * @param {string} hookUrl
 * @returns {string} base64-encoded HMAC-SHA256
 */
export function computeSquareSig(rawBody, sigKey, hookUrl) {
  return crypto
    .createHmac("sha256", sigKey)
    .update(hookUrl + rawBody)
    .digest("base64");
}
