'use strict';

// Web Push (phone + desktop notifications), with no extra packages.
// Implements VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291).
// Used for: "⏰ time to call back …" and "⚡ your commission was paid".

const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// Creates the server's VAPID key pair once and keeps it in the database.
function vapidKeys(db) {
  if (!db.data.system.vapid) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    db.data.system.vapid = {
      publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])),
      privateJwk: privateKey.export({ format: 'jwk' }),
    };
    db.save();
  }
  return db.data.system.vapid;
}

function vapidJwt(endpoint, vapid, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: vapid.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(sig)}`;
}

// RFC 8291: encrypt the payload so only the subscriber's browser can read it.
function encrypt(payload, keys) {
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

async function send({ subscription, payload, vapid, subject, fetchImpl = fetch }) {
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: '3600',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${vapidJwt(subscription.endpoint, vapid, subject)}, k=${vapid.publicKey}`,
    },
    body: encrypt(JSON.stringify(payload), subscription.keys),
    signal: AbortSignal.timeout(10000),
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}

// Sends to every device a user turned notifications on for; forgets dead ones.
async function notifyUser({ db, user, payload, subject, fetchImpl }) {
  const subs = user.pushSubs || [];
  if (!subs.length) return 0;
  const vapid = vapidKeys(db);
  let sent = 0;
  for (const s of [...subs]) {
    const r = await send({ subscription: s, payload, vapid, subject, fetchImpl }).catch(() => ({ ok: false }));
    if (r.ok) sent++;
    if (r.gone) user.pushSubs = user.pushSubs.filter((x) => x.endpoint !== s.endpoint);
  }
  db.save();
  return sent;
}

module.exports = { vapidKeys, vapidJwt, encrypt, send, notifyUser };
