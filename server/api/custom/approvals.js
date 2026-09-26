'use strict';
// ============ Approval Chains (signature-based approvals) ============
// Generic, role-based, SEQUENTIAL approval workflow with e-signature capture.
//   - A chain is defined per document type (approval_chains + stages with a
//     required role each). Admins manage chains (permission approval_chain:edit).
//   - When a document is created, its chain is instantiated (doc_approvals):
//     stage 1 = 'pending', the rest 'awaiting'.
//   - A stage can only be approved when ALL previous stages are 'approved'
//     (sequential enforcement — no skipping).
//   - Approving requires: the stage's required role (or super admin), the
//     `signature:approve` permission, and the approver's OWN registered
//     e-signature (impersonation impossible: the signature attached is always
//     the signed-in user's own row — never another user's).
//   - Every approval/rejection stores approver identity, timestamp, note and
//     the signature image — full history via getDocApprovals.
//   - Extensible: any document type with an active chain gets this workflow
//     with zero code changes (startChainForDoc is called for every create).
const fs = require('fs');
const path = require('path');
const { get, DATA_DIR } = require('../../db/db');
const { requirePerm, hasPerm, requireAdmin } = require('../../auth/auth');
const { audit } = require('../../core/audit');
const { notifyRoles } = require('../../core/notify');
const { R } = require('../resources');
const generic = require('../generic');
const { HttpError } = require('../../lib/http');
const { nowIso, parseId } = require('../../lib/util');
const sig = require('./signatures');

const STAGE_STATUS = ['pending', 'awaiting', 'approved', 'rejected', 'cancelled'];

function validRole(d, name) {
  return !!d.prepare('SELECT 1 FROM roles WHERE name=?').get(String(name || ''));
}
function userRoles(d, userId) {
  return d.prepare('SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?').all(userId).map(x => x.name);
}
function userHasRole(d, user, roleName) {
  const roles = userRoles(d, user.id);
  return roles.includes('super_admin') || roles.includes(roleName);
}
// ---------- chain management (admin) ----------
function listChains(user) {
  requirePerm(user, 'approval_chain', 'edit');
  const d = get();
  const chains = d.prepare('SELECT * FROM approval_chains ORDER BY id').all();
  const stages = d.prepare('SELECT * FROM approval_chain_stages ORDER BY chain_id, position').all();
  for (const c of chains) c.stages = stages.filter(s => s.chain_id === c.id);
  return { items: chains };
}
function saveChain(user, docType, body) {
  requirePerm(user, 'approval_chain', 'edit');
  const dt = String(docType || '');
  if (!R[dt]) throw new HttpError(422, 'VALIDATION', 'نوع سند معتبر نیست.');
  const d = get();
  const stages = Array.isArray(body.stages) ? body.stages : null;
  if (!stages || !stages.length || stages.length > 10) throw new HttpError(422, 'VALIDATION', 'حداقل ۱ و حداکثر ۱۰ مرحله لازم است.');
  for (const s of stages) {
    if (!s.label || String(s.label).length > 120) throw new HttpError(422, 'VALIDATION', 'برچسب مرحله نامعتبر است.');
    if (!validRole(d, s.role)) throw new HttpError(422, 'VALIDATION', 'نقش مرحله معتبر نیست: ' + s.role);
  }
  const ts = nowIso();
  d.transaction(() => {
    const existing = d.prepare('SELECT id FROM approval_chains WHERE doc_type=?').get(dt);
    if (existing) {
      d.prepare('UPDATE approval_chains SET name=?, active=?, updated_at=? WHERE id=?')
        .run(String(body.name || '').slice(0, 120) || 'فرآیند تأیید', body.active === false || body.active === 0 ? 0 : 1, ts, existing.id);
      d.prepare('DELETE FROM approval_chain_stages WHERE chain_id=?').run(existing.id);
      stages.forEach((s, i) => d.prepare('INSERT INTO approval_chain_stages(chain_id, position, label, role, created_at) VALUES(?,?,?,?,?)')
        .run(existing.id, i + 1, String(s.label).slice(0, 120), String(s.role), ts));
    } else {
      const info = d.prepare('INSERT INTO approval_chains(doc_type, name, active, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?)')
        .run(dt, String(body.name || '').slice(0, 120) || 'فرآیند تأیید', body.active === false || body.active === 0 ? 0 : 1, user.id, ts, ts);
      const cid = Number(info.lastInsertRowid);
      stages.forEach((s, i) => d.prepare('INSERT INTO approval_chain_stages(chain_id, position, label, role, created_at) VALUES(?,?,?,?,?)')
        .run(cid, i + 1, String(s.label).slice(0, 120), String(s.role), ts));
    }
  })();
  audit(user, 'approval_chain', 0, 'save', { doc_type: dt }, { stages: stages.length });
  return { ok: true };
}
// ---------- instantiation ----------
function startChainForDoc(docType, docId, createdBy) {
  const d = get();
  const chain = d.prepare('SELECT * FROM approval_chains WHERE doc_type=? AND active=1').get(docType);
  if (!chain) return null;
  const exists = d.prepare('SELECT 1 FROM doc_approvals WHERE doc_type=? AND doc_id=?').get(docType, docId);
  if (exists) return null;
  const stages = d.prepare('SELECT * FROM approval_chain_stages WHERE chain_id=? ORDER BY position').all(chain.id);
  if (!stages.length) return null;
  const ts = nowIso();
  d.transaction(() => {
    stages.forEach((s, i) => d.prepare(`INSERT INTO doc_approvals(doc_type, doc_id, chain_id, stage_id, position, label, required_role, status, created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(docType, docId, chain.id, s.id, s.position, s.label, s.role, i === 0 ? 'pending' : 'awaiting', ts));
  })();
  // notify the first approvers
  try { notifyRoles([stages[0].role], 'approval', 'تأیید جدید در انتظار شما', `مرحلهٔ «${stages[0].label}» — ${docType} #${docId}`, 'doc_approval', docId, [], user.id); } catch { /* best-effort */ }
  return { started: true, chain_id: chain.id, stages: stages.length };
}
// ---------- viewing ----------
function docRowAs(user, docType, docId) {
  const r = R[docType];
  if (!r) throw new HttpError(422, 'VALIDATION', 'نوع سند معتبر نیست.');
  const d = get();
  const row = d.prepare(`SELECT * FROM ${r.table} WHERE id=?`).get(Number(docId));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'سند پیدا نشد.');
  generic.assertRowScope(r, user, row, 'view');
  return row;
}
function getDocApprovals(user, docType, docId) {
  docRowAs(user, docType, docId);
  const d = get();
  const rows = d.prepare('SELECT * FROM doc_approvals WHERE doc_type=? AND doc_id=? ORDER BY position').all(docType, Number(docId));
  if (!rows.length) return { configured: false, items: [] };
  const meRoles = userRoles(d, user.id);
  const iAmSuper = meRoles.includes('super_admin');
  const iCanSign = hasPerm(user, 'signature', 'approve').ok;
  const sigRow = d.prepare('SELECT 1 FROM user_signatures WHERE user_id=?').get(user.id);
  const items = rows.map(x => ({
    position: x.position, label: x.label, required_role: x.required_role, status: x.status,
    approver_id: x.approver_id, approver_name: x.approver_name, note: x.note, signed_at: x.signed_at,
    signature: x.signature_path ? `/api/approvals/${docType}/${Number(docId)}/signature/${x.id}` : null,
    i_can_sign_here: (x.status === 'pending') && (iAmSuper || meRoles.includes(x.required_role)) && iCanSign && !!sigRow,
  }));
  const rejected = items.find(x => x.status === 'rejected');
  const overall = rejected ? 'rejected' : items.every(x => x.status === 'approved') ? 'approved' : 'in_progress';
  return {
    configured: true, overall,
    my_roles: meRoles.filter(r => r !== 'super_admin'),
    i_can_sign_any: iCanSign && !!sigRow,
    has_my_signature: !!sigRow,
    items,
  };
}
// ---------- core actions ----------
function currentPendingStage(d, docType, docId) {
  const rows = d.prepare('SELECT * FROM doc_approvals WHERE doc_type=? AND doc_id=? ORDER BY position').all(docType, Number(docId));
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'فرآیند تأیید برای این سند تعریف نشده است.');
  if (rows.some(x => x.status === 'rejected')) throw new HttpError(409, 'CHAIN_REJECTED', 'فرآیند تأیید این سند رد شده است.');
  const firstNotApproved = rows.find(x => x.status !== 'approved');
  if (!firstNotApproved) throw new HttpError(409, 'CHAIN_DONE', 'فرآیند تأیید این سند کامل شده است.');
  // sequential: every stage before it must be approved
  for (const x of rows) if (x.position < firstNotApproved.position && x.status !== 'approved') {
    throw new HttpError(409, 'SEQUENTIAL', 'ابتدا مراحل قبلی باید تأیید شوند.');
  }
  return firstNotApproved;
}
function captureSignature(user, signaturePayload) {
  // Returns {file_path, mime} — ALWAYS the signed-in user's own signature
  // (their registered row, or a freshly drawn image uploaded in this request).
  const d = get();
  const row = d.prepare('SELECT * FROM user_signatures WHERE user_id=?').get(user.id);
  if (signaturePayload && typeof signaturePayload === 'string' && signaturePayload.startsWith('data:image/')) {
    // freshly drawn from the pad (dataURL PNG)
    const m = signaturePayload.match(/^data:(image\/(png|jpeg|webp));base64,(.+)$/);
    if (!m) throw new HttpError(422, 'BAD_SIGNATURE', 'دادهٔ امضا نامعتبر است.');
    const buf = Buffer.from(m[3], 'base64');
    const mime = sig.sniffImage(buf);
    if (!mime || buf.length > sig.MAX_SIZE) throw new HttpError(422, 'BAD_SIGNATURE', 'فایل امضا نامعتبر است.');
    const dir = path.join(DATA_DIR, 'uploads', 'signatures', 'approvals');
    fs.mkdirSync(dir, { recursive: true });
    const name = `appr_u${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'}`;
    const dest = path.join(dir, name);
    fs.writeFileSync(dest, buf);
    return { file_path: dest, mime };
  }
  if (row) return { file_path: row.file_path, mime: row.mime };
  throw new HttpError(422, 'NO_SIGNATURE', 'ابتدا امضای الکترونیکی خود را ثبت کنید (تنظیمات ← پروفایل).');
}
function guardStageAction(user, docType, docId, stage) {
  const d = get();
  if (stage.status !== 'pending') throw new HttpError(409, 'NOT_PENDING', 'این مرحله در حال حاضر قابل اقدام نیست.');
  if (!userHasRole(d, user, stage.required_role)) {
    audit(user, 'approval', docId, 'permission_denied', null, { stage: stage.position, required_role: stage.required_role });
    throw new HttpError(403, 'FORBIDDEN', 'شما نقش این مرحله را ندارید (' + stage.required_role + ').');
  }
  if (!hasPerm(user, 'signature', 'approve').ok) {
    audit(user, 'approval', docId, 'permission_denied', null, { stage: stage.position, reason: 'no_signature_permission' });
    throw new HttpError(403, 'FORBIDDEN', 'شما مجوز استفاده از امضای الکترونیکی را ندارید.');
  }
}
function promoteNext(d, docType, docId, afterPosition) {
  d.prepare(`UPDATE doc_approvals SET status='pending', updated_at=? WHERE doc_type=? AND doc_id=? AND position=? AND status='awaiting'`)
    .run(nowIso(), docType, Number(docId), afterPosition + 1);
  const next = d.prepare('SELECT * FROM doc_approvals WHERE doc_type=? AND doc_id=? AND position=?').get(docType, Number(docId), afterPosition + 1);
  if (next) {
    try { notifyRoles([next.required_role], 'approval', 'تأیید جدید در انتظار شما', `مرحلهٔ «${next.label}» — ${docType} #${docId}`, 'doc_approval', docId, [], user.id); } catch { /* best-effort */ }
  } else {
    // chain fully approved — real event for the Workflow Visual Engine
    try { require('../../core/workflow').dispatch(docType + '_approved', docType, Number(docId), { doc_type: docType, overall: 'approved' }); } catch { /* best-effort */ }
  }
}
function approveStage(user, docType, docId, body) {
  docRowAs(user, docType, docId);
  const d = get();
  const stage = currentPendingStage(d, docType, docId);
  guardStageAction(user, docType, docId, stage);
  const captured = captureSignature(user, body && body.signature);
  const ts = nowIso();
  d.transaction(() => {
    d.prepare(`UPDATE doc_approvals SET status='approved', approver_id=?, approver_name=?, note=?, signed_at=?, signature_path=?, signature_mime=?, updated_at=? WHERE doc_type=? AND doc_id=? AND position=?`)
      .run(user.id, user.full_name || user.username, String((body && body.note) || '').slice(0, 500), ts, captured.file_path, captured.mime, ts, docType, Number(docId), stage.position);
    promoteNext(d, docType, docId, stage.position);
  })();
  audit(user, 'approval', Number(docId), 'approve', { stage: stage.position, role: stage.required_role }, { note: (body && body.note) || '', signed_at: ts });
  return getDocApprovals(user, docType, docId);
}
function rejectStage(user, docType, docId, body) {
  const docRow = docRowAs(user, docType, docId);
  const d = get();
  const stage = currentPendingStage(d, docType, docId);
  guardStageAction(user, docType, docId, stage);
  const note = String((body && body.note) || '').slice(0, 500);
  if (!note.trim()) throw new HttpError(422, 'VALIDATION', 'دلیل رد الزامی است.');
  const ts = nowIso();
  d.transaction(() => {
    d.prepare(`UPDATE doc_approvals SET status='rejected', approver_id=?, approver_name=?, note=?, signed_at=?, updated_at=? WHERE doc_type=? AND doc_id=? AND position=?`)
      .run(user.id, user.full_name || user.username, note, ts, ts, docType, Number(docId), stage.position);
    d.prepare(`UPDATE doc_approvals SET status='cancelled', updated_at=? WHERE doc_type=? AND doc_id=? AND position>? AND status='awaiting'`)
      .run(ts, docType, Number(docId), stage.position);
  })();
  // real event for the Workflow Visual Engine
  try { require('../../core/workflow').dispatch(docType + '_rejected', docType, Number(docId), { doc_type: docType, overall: 'rejected', reason: note }); } catch { /* best-effort */ }
  audit(user, 'approval', Number(docId), 'reject', { stage: stage.position }, { note });
  try { if (docRow && docRow.created_by) require('../../core/notify').notify(docRow.created_by, 'approval', `فرآیند تأیید ${docType} رد شد`, `${stage.label}: ${note}`, docType, Number(docId)); } catch { /* best-effort */ }
  return getDocApprovals(user, docType, docId);
}
// Returns the approved approval row (access-controlled) — the route streams it.
function getApprovalSignatureRow(user, docType, docId, approvalId) {
  docRowAs(user, docType, docId);
  const d = get();
  const a = d.prepare('SELECT * FROM doc_approvals WHERE id=? AND doc_type=? AND doc_id=?').get(parseId(approvalId), docType, Number(docId));
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'امضا پیدا نشد.');
  if (a.status !== 'approved' || !a.signature_path || !fs.existsSync(a.signature_path)) throw new HttpError(404, 'NOT_FOUND', 'این مرحله امضا ندارد.');
  return a;
}
module.exports = {
  listChains, saveChain, startChainForDoc, getDocApprovals, approveStage, rejectStage,
  getApprovalSignatureRow, captureSignature, userHasRole, STAGE_STATUS,
};
