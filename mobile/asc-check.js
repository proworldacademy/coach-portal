/* Checks the App Store Connect upload key (Nov 13, 2026): signs a short-lived token with the key in ASC_KEY_P8 and asks Apple for
   the account's apps. Prints the status and the apps' names and bundle ids — never the key. Run by .github/workflows/apple-key-check.yml. */
'use strict';
const crypto = require('crypto');
const KEY_ID = process.env.ASC_KEY_ID, ISSUER = process.env.ASC_ISSUER_ID; const P8 = (process.env.ASC_KEY_P8 || '').trim();
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
(async () => {
  if (!P8) { console.log('KEY: the secret ASC_KEY_P8 is empty'); process.exit(1); }
  // pasted without its first and last line (only the letters in between)? put them back
  const pem = /BEGIN PRIVATE KEY/.test(P8) ? P8 : '-----BEGIN PRIVATE KEY-----\n' + (P8.replace(/[^A-Za-z0-9+/=]/g, '').match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n';
  if (!/BEGIN PRIVATE KEY/.test(P8)) console.log('KEY: pasted without the BEGIN/END lines (' + P8.length + ' characters) — reading it anyway');
  let key; try { key = crypto.createPrivateKey(pem); } catch (e) { console.log('KEY: the file could not be read as a key: ' + e.message); process.exit(1); }
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }), body = b64({ iss: ISSUER, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const r = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=20&fields[apps]=name,bundleId,sku', { headers: { Authorization: 'Bearer ' + head + '.' + body + '.' + sig } });
  const j = await r.json().catch(() => null);
  console.log('APPLE: HTTP ' + r.status);
  if (!r.ok) { console.log('APPLE: ' + JSON.stringify((j && j.errors && j.errors.map((e) => e.title + ' — ' + e.detail)) || j).slice(0, 400)); process.exit(1); }
  (j.data || []).forEach((a) => console.log('APP: ' + a.attributes.name + ' · ' + a.attributes.bundleId));
  console.log('KEY: good');
})().catch((e) => { console.log('ERROR: ' + e.message); process.exit(1); });
