'use strict';
const crypto = require('crypto');
const { base64url, sha256, randomToken } = require('./util');

// ---------- Password hashing (scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 'scrypt:' + salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  try {
    const parts = String(stored).split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const h = crypto.scryptSync(String(pw), parts[1], 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(parts[2], 'hex'));
  } catch { return false; }
}

// ---------- JWT (HS256) ----------
let SECRET = null;
function setSecret(s) { SECRET = s; }
function jwtSign(payload, ttlSec) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec };
  const h = base64url(JSON.stringify(header)), p = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${h}.${p}.${sig}`;
}
function jwtVerify(token) {
  try {
    const [h, p, sig] = String(token).split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (sig !== expect) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ---------- TOTP (RFC 6238) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(c); if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpSecret() { return b32encode(crypto.randomBytes(20)); }
function totpCode(secret, step = 30, digits = 6) {
  const counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = h[19] & 15;
  const code = ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
function totpVerify(secret, code, window = 1) {
  const c = String(code).replace(/\D/g, '');
  for (let i = -window; i <= window; i++) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + i));
    const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
    const o = h[19] & 15;
    const v = ((h[o] & 0x7f) << 24 | (h[o + 1] & 0xff) << 16 | (h[o + 2] & 0xff) << 8 | (h[o + 3] & 0xff)) % 1000000;
    if (String(v).padStart(6, '0') === c) return true;
  }
  return false;
}

// ---------- Symmetric encryption for stored secrets ----------
let ENC_KEY = null;
function setEncKey(hexKey) { ENC_KEY = Buffer.from(hexKey, 'hex'); }
function encSecret(plain) {
  if (plain === '' || plain === null || plain === undefined) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}
function decSecret(stored) {
  if (!stored) return '';
  if (!stored.startsWith('enc:')) return stored;
  try {
    const [, ivh, tagh, datah] = stored.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivh, 'hex'));
    d.setAuthTag(Buffer.from(tagh, 'hex'));
    return Buffer.concat([d.update(Buffer.from(datah, 'hex')), d.final()]).toString('utf8');
  } catch { return ''; }
}

module.exports = {
  hashPassword, verifyPassword, setSecret, setEncKey, jwtSign, jwtVerify,
  totpSecret, totpCode, totpVerify, b32encode, encSecret, decSecret, randomToken, sha256,
};
