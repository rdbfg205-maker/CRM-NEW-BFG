'use strict';
// Unified AI Gateway with online -> local -> builtin failover.
// - online: Gemini / OpenAI / Claude / custom (OpenAI-compatible)
// - local: OpenAI-compatible local endpoint (Ollama / llama.cpp / LM Studio)
// - builtin: always-available deterministic analysis on REAL data (never fabricates)
// Logs every request. Never leaks API keys.
const { get, getSetting, setSetting } = require('../db/db');
const { nowIso, fmtNum } = require('../lib/util');

const DEFAULTS = {
  online_enabled: true, offline_enabled: true, failover: true,
  ai_mode: 'hybrid', // auto | online_only | offline_only | hybrid
  ai_privacy: { online_allowed: true, offline_allowed: true, customer: true, contact: true, financial: true, sales: true, notes: true, files: false, masking: true },
  online_provider: 'gemini', online_model: 'gemini-1.5-flash', online_api_key: '', online_base_url: '', online_timeout_ms: 15000, online_temperature: 0.4,
  local_enabled: true, local_endpoint: 'http://127.0.0.1:11434/v1', local_model: 'llama3', local_timeout_ms: 12000,
  module_flags: { customer: true, complaint: true, order: true, invoice: true, lead: true, opportunity: true, lab_request: true, reporting: true, workflow: true, voip: true, general: true },
  permission_level: 'scoped',
};
function aiConfig() {
  const stored = getSetting('ai_settings');
  return { ...DEFAULTS, ...(stored || {}) };
}
function saveAiConfig(patch) {
  const next = { ...aiConfig(), ...patch };
  setSetting('ai_settings', next);
  return next;
}
function moduleEnabled(module) {
  const c = aiConfig();
  return c.module_flags ? c.module_flags[module] !== false : true;
}
function permissionLevel() { const c = aiConfig(); return c.permission_level || 'scoped'; }
function configForUi() {
  const c = aiConfig();
  return {
    online_enabled: !!c.online_enabled, offline_enabled: !!c.offline_enabled, failover: c.failover !== false,
    ai_mode: c.ai_mode || 'hybrid',
    ai_privacy: { online_allowed: true, offline_allowed: true, customer: true, contact: true, financial: true, sales: true, notes: true, files: false, masking: true, ...(c.ai_privacy || {}) },
    online_provider: c.online_provider || 'gemini', online_model: c.online_model || 'gemini-1.5-flash',
    online_api_key_masked: c.online_api_key ? '••••' + String(c.online_api_key).slice(-4) : '',
    online_base_url: c.online_base_url || '', online_timeout_ms: c.online_timeout_ms || 15000, online_temperature: c.online_temperature || 0.4,
    ai_rate_limit: c.ai_rate_limit || { max: 60, window_ms: 300000 },
    local_enabled: !!c.local_enabled, local_endpoint: c.local_endpoint || 'http://127.0.0.1:11434/v1',
    local_model: c.local_model || 'llama3', local_timeout_ms: c.local_timeout_ms || 12000,
    module_flags: c.module_flags || {}, permission_level: c.permission_level || 'scoped',
  };
}
function saveConfigForUi(user, patch) {
  const cur = aiConfig();
  // keep existing key if masked value sent back unchanged
  if (patch.online_api_key && patch.online_api_key.startsWith('•')) patch.online_api_key = cur.online_api_key;
  return saveAiConfig(patch);
}
function logAi(user, module, requestType, provider, model, source, success, error, durationMs, tokens) {
  try {
    get().prepare('INSERT INTO ai_logs(user_id, module, request_type, provider, model, source, success, error, duration_ms, tokens, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(user ? user.id : null, module || '', requestType || '', provider || '', model || '', source || '', success ? 1 : 0, error || '', durationMs || 0, tokens || 0, nowIso());
  } catch (e) { /* never break flow */ }
}
async function callOnline(c, messages, system, timeoutMs) {
  const key = c.online_api_key;
  if (!key) throw new Error('no online api key configured');
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), c.online_timeout_ms || 15000);
  try {
    if (c.online_provider === 'gemini') {
      const model = c.online_model || 'gemini-1.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const body = { contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), systemInstruction: system ? { parts: [{ text: system }] } : undefined, generationConfig: { temperature: c.online_temperature || 0.4 } };
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!r.ok) throw new Error('gemini http ' + r.status);
      const j = await r.json();
      const text = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || []).map(x => x.text || '').join('');
      if (!text) throw new Error('empty response');
      return { text, model: model, tokens: (j.usageMetadata && j.usageMetadata.totalTokenCount) || 0 };
    }
    // openai / claude / custom -> OpenAI-compatible
    const base = (c.online_base_url || 'https://api.openai.com/v1').replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    const msgs = [system ? { role: 'system', content: system } : null, ...messages].filter(Boolean);
    const r = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model: c.online_model || 'gpt-4o-mini', temperature: c.online_temperature || 0.4, messages: msgs }), signal: controller.signal });
    if (!r.ok) throw new Error('provider http ' + r.status);
    const j = await r.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (!text) throw new Error('empty response');
      return { text, model: c.online_model, tokens: (j.usage && j.usage.total_tokens) || 0 };
  } finally { clearTimeout(to); }
}
async function callLocal(c, messages, system, timeoutMs) {
  const base = (c.local_endpoint || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), c.local_timeout_ms || 12000);
  try {
    const msgs = [system ? { role: 'system', content: system } : null, ...messages].filter(Boolean);
    const r = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: c.local_model || 'llama3', temperature: 0.4, messages: msgs }), signal: controller.signal });
    if (!r.ok) throw new Error('local http ' + r.status);
    const j = await r.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    if (!text) throw new Error('empty local response');
    return { text, model: c.local_model || 'llama3', tokens: (j.usage && j.usage.total_tokens) || 0 };
  } finally { clearTimeout(to); }
}
// main entry with failover. builtinFn provides the deterministic real-data answer.
async function ask(user, module, requestType, messages, system, builtinFn) {
  aiRateLimit(user);
  const c = aiConfig();
  const t0 = Date.now();
  if (c.online_enabled && c.failover !== false && c.online_api_key) {
    try {
      const r = await callOnline(c, messages, system, c.online_timeout_ms);
      logAi(user, module, requestType, c.online_provider, r.model, 'online', true, '', Date.now() - t0, r.tokens);
      return { text: r.text, source: 'online', provider: c.online_provider, model: r.model, tokens: r.tokens };
    } catch (e) {
      logAi(user, module, requestType, c.online_provider, c.online_model, 'online', false, e.message, Date.now() - t0, 0);
      if (c.failover === false) return { text: null, source: 'none', error: 'online failed (failover off): ' + e.message };
    }
  }
  if (c.offline_enabled && c.local_endpoint) {
    try {
      const r = await callLocal(c, messages, system, c.local_timeout_ms);
      logAi(user, module, requestType, 'local', r.model, 'local', true, '', Date.now() - t0, r.tokens);
      return { text: r.text, source: 'local', provider: 'local', model: r.model, tokens: r.tokens };
    } catch (e) {
      logAi(user, module, requestType, 'local', c.local_model, 'local', false, e.message, Date.now() - t0, 0);
    }
  }
  if (builtinFn) {
    try {
      const text = builtinFn();
      logAi(user, module, requestType, 'builtin', 'builtin', 'builtin', true, '', Date.now() - t0, 0);
      return { text, source: 'builtin', provider: 'builtin', model: 'builtin', tokens: 0 };
    } catch (e) {
      logAi(user, module, requestType, 'builtin', 'builtin', 'builtin', false, e.message, Date.now() - t0, 0);
      return { text: null, source: 'none', error: e.message };
    }
  }
  logAi(user, module, requestType, 'none', 'none', 'none', false, 'no provider available', Date.now() - t0, 0);
  return { text: null, source: 'none', error: 'no provider available' };
}
function aiLogList(limit = 200) {
  const items = get().prepare('SELECT a.*, u.full_name FROM ai_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?').all(limit);
  return { items };
}
// Section 9: per-user rate limit for AI calls (abuse / cost protection).
// Config: ai_settings.ai_rate_limit = { max, window_ms } — default 60 per 5 min.
const _aiBuckets = new Map();
function aiRateLimit(user) {
  const c = aiConfig();
  const rl = c.ai_rate_limit || { max: 60, window_ms: 5 * 60000 };
  const max = Math.max(1, Number(rl.max) || 60);
  const windowMs = Math.max(10000, Number(rl.window_ms) || 5 * 60000);
  const key = user ? ('u' + user.id) : 'anon';
  const now = Date.now();
  let b = _aiBuckets.get(key);
  if (!b || now > b.reset) { _aiBuckets.set(key, { count: 1, reset: now + windowMs }); return; }
  b.count++;
  if (_aiBuckets.size > 5000) { for (const [k, v] of _aiBuckets) if (now > v.reset) _aiBuckets.delete(k); }
  if (b.count > max) {
    const err = new Error('ai_rate_limited');
    err.status = 429;
    err.code = 'AI_RATE_LIMITED';
    err.message = 'درخواست‌های هوش مصنوعی بیش از حد مجاز است. کمی صبر کنید و دوباره تلاش کنید.';
    throw err;
  }
}
module.exports = { aiConfig, saveAiConfig, configForUi, saveConfigForUi, moduleEnabled, permissionLevel, ask, aiLogList, aiRateLimit, callOnline, callLocal };
