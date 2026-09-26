'use strict';
// AI Gateway API routes: per-module analyze, workflow AI, report assistant, settings, logs.
const aigw = require('./aigw');
const aireport = require('./aireport');
const { get, getSetting, setSetting } = require('../../db/db');
const { requirePerm, requireUser } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const gw = require('../../core/ai-gateway');
const { HttpError } = require('../../lib/http');

function analyze(user, module, entityId) { return aigw.analyze(user, module, entityId); }
function analyzeProcess(user, processId) { return aigw.analyzeProcess(user, processId); }
async function reportAssistant(user, query) { return await aireport.reportAssistant(user, query); }
function settings() { return gw.configForUi(); }
function saveSettings(user, patch) {
  requirePerm(user, 'settings', 'edit');
  const cur = gw.configForUi();
  if (patch.online_api_key && patch.online_api_key.startsWith('•')) patch.online_api_key = cur.online_api_key;
  const next = gw.saveConfigForUi(user, patch);
  audit(user, 'settings', 0, 'ai_settings_update', null, { keys: Object.keys(patch) });
  return gw.configForUi();
}
async function testConnection(user) {
  const c = gw.aiConfig();
  const out = { online: null, local: null };
  if (c.online_enabled && c.online_api_key) {
    try {
      const r = await gw.callOnline(c, [{ role: 'user', content: 'ping' }], 'ping', c.online_timeout_ms);
      out.online = { ok: true, model: r.model, sample: (r.text || '').slice(0, 60) };
    } catch (e) { out.online = { ok: false, error: e.message }; }
  } else out.online = { ok: false, error: 'غیرفعال یا بدون کلید' };
  if (c.offline_enabled && c.local_endpoint) {
    try {
      const r = await gw.callLocal(c, [{ role: 'user', content: 'ping' }], 'ping', c.local_timeout_ms);
      out.local = { ok: true, model: r.model, sample: (r.text || '').slice(0, 60) };
    } catch (e) { out.local = { ok: false, error: e.message }; }
  } else out.local = { ok: false, error: 'غیرفعال یا بدون endpoint' };
  return out;
}
function listLogs(user) { return gw.aiLogList(300); }
module.exports = { analyze, analyzeProcess, reportAssistant, settings, saveSettings, testConnection, listLogs };
