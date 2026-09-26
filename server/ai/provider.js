'use strict';
const { getSetting, setSetting } = require('../db/db');
const { decSecret } = require('../lib/crypto');
const { HttpError } = require('../lib/http');

// Provider-based AI architecture: local (built-in) | gemini | openai | claude | custom
const PROVIDERS = ['local', 'gemini', 'openai', 'claude', 'custom'];
function getConfig() {
  return getSetting('ai_provider', { provider: 'local', model: '', apiKey: '', baseUrl: '', temperature: 0.4 }) || { provider: 'local' };
}
function isConfigured() {
  const c = getConfig();
  if (c.provider === 'local') return true;
  return !!(c.apiKey && c.model);
}
async function chat(messages, system = '', maxTokens = 800) {
  const c = getConfig();
  if (c.provider === 'local') return null; // caller falls back to local engine
  const key = decSecret(c.apiKey);
  const temp = c.temperature ?? 0.4;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 60000);
  try {
    if (c.provider === 'gemini') {
      const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const body = { contents, generationConfig: { temperature: temp, maxOutputTokens: maxTokens } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('Gemini API: ' + res.status + ' ' + (await res.text()).slice(0, 200));
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      if (!text) throw new Error('پاسخ خالی از Gemini');
      return { text, provider: 'gemini' };
    }
    if (c.provider === 'openai' || c.provider === 'custom') {
      const base = (c.baseUrl || (c.provider === 'openai' ? 'https://api.openai.com' : '')).replace(/\/$/, '');
      if (!base) throw new Error('OpenAI/Custom: baseUrl تنظیم نشده است.');
      const res = await fetch(base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system || 'تو دستیار هوشمند CRM هستی. به فارسی و مختصر پاسخ بده.' }, ...messages], temperature: temp, max_tokens: maxTokens }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('OpenAI API: ' + res.status + ' ' + (await res.text()).slice(0, 200));
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('پاسخ خالی');
      return { text, provider: c.provider };
    }
    if (c.provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system: system || 'تو دستیار هوشمند CRM هستی. به فارسی و مختصر پاسخ بده.', messages }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('Claude API: ' + res.status + ' ' + (await res.text()).slice(0, 200));
      const j = await res.json();
      const text = (j.content || []).map(p => p.text || '').join('');
      if (!text) throw new Error('پاسخ خالی');
      return { text, provider: 'claude' };
    }
    throw new Error('Provider نامعتبر');
  } catch (e) {
    if (e.name === 'AbortError') throw new HttpError(504, 'AI_TIMEOUT', 'سرور هوش مصنوعی پاسخ نداد.');
    throw new HttpError(502, 'AI_ERROR', 'خطا در ارتباط با سرویس هوش مصنوعی: ' + e.message);
  } finally { clearTimeout(to); }
}
module.exports = { PROVIDERS, getConfig, isConfigured, chat };
