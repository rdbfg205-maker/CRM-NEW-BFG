'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'baspar-crm.sqlite');
let db = null;

function open() {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations();
  return db;
}
function get() {
  if (!db) open();
  return db;
}
// close the live handle so the next get() reopens against the (possibly replaced) file —
// used by backup restore so the server serves the restored DB immediately (no restart needed).
// NOTE: db is nulled BEFORE close — if close() throws, a broken handle can never be
// returned by get()/open() again.
function reopen() {
  const old = db;
  db = null;
  if (old) { try { old.pragma('wal_checkpoint(TRUNCATE)'); } catch {} try { old.close(); } catch {} }
  return open();
}
// detach without closing (caller closes the returned handle after replacing the file)
function detach() {
  const old = db;
  db = null;
  return old;
}
function runMigrations() {
  const d = get();
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT)`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set(d.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)').run(f, new Date().toISOString());
    })();
    console.log(`[db] applied migration ${f}`);
  }
}
// ---------- settings ----------
function getSetting(key, def = null) {
  const r = get().prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
function setSetting(key, value) {
  get().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value === null ? null : value));
}
function getUserSetting(userId, key, def = null) {
  const r = get().prepare('SELECT value FROM user_settings WHERE user_id=? AND key=?').get(userId, key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
function setUserSetting(userId, key, value) {
  get().prepare('INSERT INTO user_settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value')
    .run(userId, key, JSON.stringify(value));
}
// ---------- numbering ----------
function nextNumber(prefix, table, column = 'number') {
  const d = get();
  const n = nowJalaaliNum();
  const cols = d.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) return `${prefix}-${n}-0001`;
  // max-based sequence: count-based (COUNT(*)+1) breaks after deletes → UNIQUE collision
  const rows = d.prepare(`SELECT ${column} v FROM ${table} WHERE ${column} LIKE ?`).all(prefix + '-%');
  let max = 0;
  for (const r of rows) {
    const m = String(r.v).match(/(\d+)$/);
    if (m) { const v = parseInt(m[1], 10); if (v > max) max = v; }
  }
  return `${prefix}-${n}-${String(max + 1).padStart(4, '0')}`;
}
function nowJalaaliNum() {
  const { jy, jm } = require('../lib/util').nowTehran();
  return `${jy}${String(jm).padStart(2, '0')}`;
}
// ---------- activity ----------
function addActivity(entityType, entityId, userId, type, summary, data = null) {
  get().prepare('INSERT INTO activities(entity_type, entity_id, user_id, type, summary, data, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(entityType, entityId, userId || 0, type, summary, data ? JSON.stringify(data) : null, new Date().toISOString());
}
// ---------- search index ----------
function searchIndex(kind, id, title, body) {
  const d = get();
  // remove any existing index entries for this record (also clears orphaned map rows)
  const existing = d.prepare('SELECT fts_rowid FROM search_map WHERE kind=? AND id=?').all(kind, id);
  for (const m of existing) {
    d.prepare('DELETE FROM search_index WHERE rowid=?').run(m.fts_rowid);
    d.prepare('DELETE FROM search_map WHERE fts_rowid=?').run(m.fts_rowid);
  }
  // explicit rowid: FTS5 may REUSE a deleted max rowid, while orphaned search_map rows
  // (from out-of-band deletes) still hold those rowids → PK collision. Use a rowid that
  // is guaranteed free in BOTH tables: max(search_index.rowid, search_map.fts_rowid) + 1
  // (deterministic; no bounded probing that could still collide on dense orphan runs).
  const maxIdx = Number(d.prepare('SELECT COALESCE(MAX(rowid),0) m FROM search_index').get().m);
  const maxMap = Number(d.prepare('SELECT COALESCE(MAX(fts_rowid),0) m FROM search_map').get().m);
  let rowid = Math.max(maxIdx, maxMap) + 1;
  while (d.prepare('SELECT 1 FROM search_map WHERE fts_rowid=?').get(rowid) || d.prepare('SELECT 1 FROM search_index WHERE rowid=?').get(rowid)) rowid++;
  d.prepare('INSERT INTO search_index(rowid, title, body, kind) VALUES(?,?,?,?)').run(rowid, String(title || ''), String(body || ''), kind);
  d.prepare('INSERT INTO search_map(fts_rowid, kind, id) VALUES(?,?,?)').run(rowid, kind, id);
}
function searchRemove(kind, id) {
  const d = get();
  const rows = d.prepare('SELECT fts_rowid FROM search_map WHERE kind=? AND id=?').all(kind, id);
  for (const m of rows) {
    d.prepare('DELETE FROM search_index WHERE rowid=?').run(m.fts_rowid);
    d.prepare('DELETE FROM search_map WHERE fts_rowid=?').run(m.fts_rowid);
  }
}
// full rebuild: wipe the FTS index and re-index every active record (repairs orphaned rows)
function searchRebuild() {
  const d = get();
  d.transaction(() => {
    d.prepare('DELETE FROM search_map').run();
    for (const r of d.prepare('SELECT rowid FROM search_index').all()) d.prepare('DELETE FROM search_index WHERE rowid=?').run(r.rowid);
  })();
  const { R } = require('../api/resources');
  let n = 0;
  for (const r of Object.values(R)) {
    if (!r.table || r.entity === 'document') continue;
    let rows = [];
    try { rows = d.prepare(`SELECT * FROM ${r.table}`).all(); } catch { continue; }
    for (const row of rows) {
      const title = row.name || row.title || row.number || row.subject || row.company || row.subject || '';
      const body = [row.description, row.notes, row.company, row.contact_name, row.address, row.subject, row.sample_desc].filter(Boolean).join(' ').slice(0, 2000);
      searchIndex(r.entity, row.id, String(title), String(body));
      n++;
    }
  }
  // documents are indexed with their full text_content
  for (const doc of d.prepare('SELECT id, title, text_content FROM documents').all()) {
    searchIndex('document', doc.id, doc.title || '', String(doc.text_content || '').slice(0, 2000));
    n++;
  }
  return n;
}
module.exports = { reopen, detach, get, open, DB_PATH, DATA_DIR, getSetting, setSetting, getUserSetting, setUserSetting, nextNumber, addActivity, searchIndex, searchRemove, searchRebuild };
