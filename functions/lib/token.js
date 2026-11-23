/* The sign-in check, remembered for a minute (Nov 22, 2026, speed). Every request used to ask Google "is this sign-in still valid, and
   was it revoked?", one network call per tap. The full check (with revocation) still runs the first time a sign-in is seen and again
   every 60 seconds; in between the answer is reused. Someone whose access is removed can keep reading for at most one minute. */
'use strict';
const TTL_MS = 60 * 1000; const MAX = 500;
const seen = new Map();
async function verify(token) {
  const now = Date.now(); const hit = seen.get(token);
  if (hit && now - hit.at < TTL_MS && hit.decoded.exp * 1000 > now) return hit.decoded;
  const decoded = await require('firebase-admin/auth').getAuth().verifyIdToken(token, true);
  if (seen.size >= MAX) { for (const [k, v] of seen) { if (now - v.at >= TTL_MS) seen.delete(k); } if (seen.size >= MAX) seen.clear(); }
  seen.set(token, { decoded, at: now });
  return decoded;
}
module.exports = { verify, _forget: () => seen.clear() };
