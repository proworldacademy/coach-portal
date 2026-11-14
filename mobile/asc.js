/* App Store Connect, with the upload key (ASC_KEY_P8): registers the app's bundle id if it is not there, and says whether the app
   itself exists (Apple lets only a signed-in person create an app, not a key). Writes app=yes|no to GITHUB_OUTPUT. Never prints the key. */
'use strict';
const crypto = require('crypto'); const fs = require('fs');
const KEY_ID = process.env.ASC_KEY_ID, ISSUER = process.env.ASC_ISSUER_ID; const P8 = (process.env.ASC_KEY_P8 || '').trim();
const BUNDLE = process.env.BUNDLE_ID || 'com.proworldacademy.app'; const NAME = 'ProWorld Academy';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const pem = () => /BEGIN PRIVATE KEY/.test(P8) ? P8 : '-----BEGIN PRIVATE KEY-----\n' + (P8.replace(/[^A-Za-z0-9+/=]/g, '').match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n';
function token() {
  const key = crypto.createPrivateKey(pem()); const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }), body = b64({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  return head + '.' + body + '.' + crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
async function api(method, path, body) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + path, { method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j, err: j && j.errors ? j.errors.map((e) => e.title + ' — ' + e.detail).join(' | ').slice(0, 500) : '' };
}
(async () => {
  if (!P8) { console.log('KEY: the secret ASC_KEY_P8 is empty'); process.exit(1); }
  if (process.argv[2] === 'writekey') {   // the key file xcodebuild reads, outside the repository folder
    const dir = process.argv[3]; fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dir + '/AuthKey_' + KEY_ID + '.p8', pem(), { mode: 0o600 }); console.log('KEY: written for xcodebuild'); return;
  }
  let b = await api('GET', '/v1/bundleIds?filter[identifier]=' + encodeURIComponent(BUNDLE) + '&limit=5');
  if (!b.ok) { console.log('APPLE: HTTP ' + b.status + ' ' + b.err); process.exit(1); }
  let found = (b.j.data || []).find((x) => x.attributes.identifier === BUNDLE);
  if (!found) {
    const c = await api('POST', '/v1/bundleIds', { data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: NAME, platform: 'IOS' } } });
    console.log(c.ok ? 'BUNDLE: registered ' + BUNDLE : 'BUNDLE: could not register (HTTP ' + c.status + ') ' + c.err);
    if (!c.ok) process.exit(1); found = c.j.data;
  } else console.log('BUNDLE: ' + BUNDLE + ' is registered (' + found.attributes.name + ')');
  const a = await api('GET', '/v1/apps?filter[bundleId]=' + encodeURIComponent(BUNDLE) + '&fields[apps]=name,bundleId,sku');
  if (!a.ok) { console.log('APPLE: HTTP ' + a.status + ' ' + a.err); process.exit(1); }
  const app = (a.j.data || [])[0];
  console.log(app ? 'APP: ' + app.attributes.name + ' · ' + app.attributes.bundleId + ' · id ' + app.id : 'APP: not created yet in App Store Connect (My Apps → + → New App, bundle id ' + BUNDLE + ')');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'app=' + (app ? 'yes' : 'no') + '\n' + (app ? 'appid=' + app.id + '\n' : ''));
  if (app && process.argv[2] === 'builds') { const bl = await api('GET', '/v1/builds?filter[app]=' + app.id + '&limit=5&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate,expired'); (bl.j && bl.j.data || []).forEach((x) => console.log('BUILD: ' + x.attributes.version + ' · ' + x.attributes.processingState + ' · ' + x.attributes.uploadedDate)); if (!(bl.j && bl.j.data || []).length) console.log('BUILD: none yet'); }
})().catch((e) => { console.log('ERROR: ' + e.message); process.exit(1); });
