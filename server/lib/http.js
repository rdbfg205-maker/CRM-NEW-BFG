'use strict';
const fs = require('fs');
const path = require('path');
const { randomToken } = require('./util');

// ---------- router ----------
function createRouter() {
  const routes = [];
  function add(method, pattern, handler) {
    if (typeof handler !== 'function') { console.error('ROUTER BAD HANDLER for', method, pattern, typeof handler); }
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    routes.push({ method, rx, keys, handler });
  }
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.rx.exec(pathname);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
          return { handler: r.handler, params };
        }
      }
      return null;
    },
  };
}
// ---------- body parsing ----------
function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function findBoundary(buf, needle, from) {
  // case-insensitive search
  const lower = buf.slice(from).toString('latin1').toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  return idx < 0 ? -1 : from + idx;
}
function parseMultipart(buf, boundary) {
  const files = [];
  const fields = {};
  const b = '--' + boundary;
  let i = findBoundary(buf, b, 0);
  while (i >= 0) {
    const e = findBoundary(buf, b, i + b.length);
    if (e < 0) break;
    let part = buf.slice(i + b.length, e);
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd >= 0) {
      const head = part.slice(0, headEnd).toString('utf8');
      let body = part.slice(headEnd + 4);
      if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);
      const nm = head.match(/name="([^"]*)"/);
      const fm = head.match(/filename="([^"]*)"/);
      const tm = head.match(/Content-Type:\s*([^\r\n]+)/i);
      if (nm) {
        if (fm) {
          files.push({ field: nm[1], filename: fm[1], data: body, mime: tm ? tm[1].trim() : 'application/octet-stream' });
        } else {
          fields[nm[1]] = body.toString('utf8');
        }
      }
    }
    i = e;
  }
  return { fields, files };
}
async function parseBody(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  const len = parseInt(req.headers['content-length'] || '0', 10);
  if (!len || len < 1) return { json: null, fields: {}, files: [] };
  const buf = await readBody(req);
  if (ct.includes('application/json')) {
    try { return { json: JSON.parse(buf.toString('utf8') || '{}'), fields: {}, files: [] }; }
    catch { throw new HttpError(400, 'BODY_INVALID', 'ورودی نامعتبر است (JSON).'); }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const p = new URLSearchParams(buf.toString('utf8'));
    const fields = {};
    for (const [k, v] of p) fields[k] = v;
    return { json: fields, fields, files: [] };
  }
  if (ct.includes('multipart/form-data')) {
    const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    const boundary = m ? (m[1] || m[2]).trim() : null;
    if (!boundary) throw new HttpError(400, 'BODY_INVALID', 'boundary یافت نشد.');
    const { fields, files } = parseMultipart(buf, boundary);
    return { json: fields, fields, files };
  }
  return { json: null, fields: {}, files: [] };
}
// ---------- errors ----------
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function sendError(res, err, log = true) {
  if (log && err && err.status !== 404) console.error('[error]', err.message, err.stack ? err.stack.split('\n')[1] : '');
  let status = err.status || 500, code = err.code || 'ERROR', msg = err.message || 'خطای ناشناخته';
  if (status === 500) msg = 'خطای سیستمی رخ داد. لطفاً دوباره تلاش کنید.';
  if (res.headersSent) { try { res.end(); } catch {} return; }
  sendJson(res, status, { error: { code, message: msg } });
}
// ---------- static ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};
function serveStatic(req, res, filePath) {
  try {
    const st = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff' };
    // ETag from size+mtime: enables cheap 304 revalidation so browsers/SW never serve silently-stale code
    const etag = '"baspar-' + st.size + '-' + Math.round(st.mtimeMs) + '"';
    headers['ETag'] = etag;
    headers['Last-Modified'] = st.mtime.toUTCString();
    if (['.png', '.jpg', '.jpeg', '.woff2', '.svg', '.ico', '.webp'].includes(ext)) headers['Cache-Control'] = 'public, max-age=604800';
    // code + html: never serve stale — always revalidate (304 keeps it cheap)
    else headers['Cache-Control'] = 'no-cache';
    const inm = (req && (req.headers['if-none-match'] || '')) || '';
    if (inm === etag || inm.includes(etag)) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': headers['Cache-Control'] });
      return res.end();
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  }
}
// ---------- rate limit ----------
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) { buckets.set(key, { count: 1, reset: now + windowMs }); return true; }
  b.count++;
  if (buckets.size > 20000) { for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k); }
  return b.count <= max;
}
module.exports = { createRouter, parseBody, HttpError, sendJson, sendError, serveStatic, rateLimit, randomToken };
