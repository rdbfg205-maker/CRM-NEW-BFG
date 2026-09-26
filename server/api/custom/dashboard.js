'use strict';
const { get } = require('../../db/db');
const { jalaliPeriodRange, fmtNum, faDigits, nowTehran } = require('../../lib/util');
const engine = require('../../ai/engine');

function base() {
  const d = get();
  const cur = jalaliPeriodRange('month');
  const prev = jalaliPeriodRange('last_month');
  const today = jalaliPeriodRange('today');
  const year = jalaliPeriodRange('year');
  const q = (sql, ...p) => d.prepare(sql).get(...p);
  const invCond = "status IN ('unpaid','partial','paid','overdue')";
  const salesToday = q(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM invoices WHERE ${invCond} AND issue_date>=? AND issue_date<=?`, today.from, today.to);
  const salesMonth = q(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM invoices WHERE ${invCond} AND issue_date>=? AND issue_date<=?`, cur.from, cur.to);
  const salesPrev = q(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM invoices WHERE ${invCond} AND issue_date>=? AND issue_date<=?`, prev.from, prev.to);
  const salesYear = q(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM invoices WHERE ${invCond} AND issue_date>=? AND issue_date<=?`, year.from, year.to);
  const growth = salesPrev.s > 0 ? Math.round(((salesMonth.s - salesPrev.s) / salesPrev.s) * 1000) / 10 : null;
  const customers = q(`SELECT COUNT(*) c FROM customers WHERE archived_at IS NULL AND status='active'`);
  const customersTotal = q(`SELECT COUNT(*) c FROM customers WHERE archived_at IS NULL`);
  const churnCount = q(`SELECT COUNT(*) c FROM customers WHERE churn_score>=60 AND archived_at IS NULL`);
  const pipeline = q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) v FROM opportunities WHERE status='open' AND archived_at IS NULL`);
  const receivables = q(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE status IN ('unpaid','partial','overdue')`);
  const openOrders = q(`SELECT COUNT(*) c FROM orders WHERE status IN ('confirmed','in_production','ready','shipped') AND archived_at IS NULL`);
  const complaintsOpen = q(`SELECT COUNT(*) c FROM complaints WHERE status IN ('new','in_progress','waiting')`);
  const slaBreach = q(`SELECT COUNT(*) c FROM complaints WHERE status IN ('new','in_progress','waiting') AND datetime(due_at) < datetime('now')`);
  const lowStock = q(`SELECT COUNT(*) c FROM stock_alerts WHERE resolved_at IS NULL`);
  // 12-month series
  const series = monthlySeries(12);
  // calendar KPIs (today + overdue) for drill-down
  const cal = (() => {
    try {
      const calmod = require('./calendar');
      const today = calmod.todayPlan(null, { allScope: true }); // org-wide exec view
      return {
        meetingsToday: today.counts.meetings,
        followupsToday: today.counts.followups,
        tasksToday: today.counts.tasks,
        deadlinesToday: today.counts.deadlines,
        overdueToday: today.counts.overdue,
      };
    } catch { return { meetingsToday: 0, followupsToday: 0, tasksToday: 0, deadlinesToday: 0, overdueToday: 0 }; }
  })();
  // VoIP / calls KPIs (additive)
  const calls = (() => {
    try {
      const v = require('./voip');
      const d = v.dashboard();
      return { callsToday: d.today, callsInbound: d.inbound, callsOutbound: d.outbound, callsMissed: d.missed, callsTalkMin: Math.round((d.talk_sec || 0) / 60), callsUnfollowed: d.unfollowed };
    } catch { return { callsToday: 0, callsInbound: 0, callsOutbound: 0, callsMissed: 0, callsTalkMin: 0, callsUnfollowed: 0 }; }
  })();
  return {
    kpi: {
      salesToday: salesToday.s, salesTodayCount: salesToday.c,
      salesMonth: salesMonth.s, salesMonthCount: salesMonth.c,
      salesYear: salesYear.s, salesYearCount: salesYear.c,
      growth, receivables: receivables.s,
      customers: customers.c, customersTotal: customersTotal.c, churnCount: churnCount.c,
      pipelineCount: pipeline.c, pipelineValue: pipeline.v,
      openOrders: openOrders.c, complaintsOpen: complaintsOpen.c, slaBreach: slaBreach.c, lowStock: lowStock.c,
      ...cal,
      ...calls,
    },
    series,
  };
}
function monthlySeries(months) {
  const d = get();
  const rows = d.prepare(`SELECT issue_date, total FROM invoices WHERE status IN ('unpaid','partial','paid','overdue') AND issue_date >= datetime('now','-13 month')`).all();
  const { gregorianToJalaali } = require('../../lib/jalali');
  const map = {};
  for (const r of rows) {
    const dt = new Date(r.issue_date);
    const t = new Date(dt.getTime() + 4.5 * 3600e3);
    const [jy, jm] = gregorianToJalaali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    const key = `${jy}-${String(jm).padStart(2, '0')}`;
    map[key] = (map[key] || 0) + r.total;
  }
  const n = nowTehran();
  const out = [];
  let [y, m] = [n.jy, n.jm];
  for (let i = months - 1; i >= 0; i--) {
    let mm = m - i, yy = y;
    while (mm < 1) { mm += 12; yy--; }
    const key = `${yy}-${String(mm).padStart(2, '0')}`;
    out.push({ key, label: `${faDigits(String(mm).padStart(2, '0'))} ${faDigits(yy)}`, value: map[key] || 0 });
  }
  return out;
}
// complaint bank analytics (structured defect bank) — real DB aggregates only
function complaintBank() {
  const d = get();
  const d90 = "datetime('now','-90 day')";
  const byFamily = d.prepare(`SELECT defect_family, COUNT(*) c FROM complaints WHERE defect_family != '' AND created_at >= ${d90} GROUP BY defect_family ORDER BY c DESC`).all();
  const topTypes = d.prepare(`SELECT defect_type, COUNT(*) c FROM complaints WHERE defect_type != '' AND created_at >= ${d90} GROUP BY defect_type ORDER BY c DESC LIMIT 6`).all();
  const topProducts = d.prepare(`SELECT p.name, COUNT(*) c FROM complaints cp LEFT JOIN products p ON p.id=cp.product_id WHERE cp.product_id IS NOT NULL AND cp.created_at >= ${d90} GROUP BY cp.product_id ORDER BY c DESC LIMIT 6`).all();
  const byTeam = d.prepare(`SELECT department, COUNT(*) c FROM complaints WHERE department != '' AND created_at >= ${d90} GROUP BY department ORDER BY c DESC`).all();
  const byStatus90 = d.prepare(`SELECT status, COUNT(*) c FROM complaints WHERE created_at >= ${d90} GROUP BY status`).all();
  const trend = d.prepare(`SELECT substr(created_at,1,7) m, COUNT(*) c FROM complaints WHERE created_at >= datetime('now','-6 month') GROUP BY m ORDER BY m`).all();
  const openSla = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE status IN ('new','in_progress','waiting') AND datetime(due_at) < datetime('now')`).get().c;
  return { byFamily, topTypes, topProducts, byTeam, byStatus90, trend, openSla };
}
function roleData(role) {
  const d = get();
  const cur = jalaliPeriodRange('month');
  const base2 = base();
  const bank = complaintBank();
  if (role === 'ceo' || role === 'super_admin') {
    const churn = engine.churnList(5).filter(c => c.score >= 60);
    const topCust = d.prepare(`SELECT c.id, c.name, COALESCE(SUM(i.total),0) s FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? GROUP BY c.id ORDER BY s DESC LIMIT 5`).all(cur.from);
    const hotOpps = d.prepare(`SELECT o.id, o.title, c.name, o.amount, o.probability FROM opportunities o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.status='open' AND o.probability>=70 ORDER BY o.amount DESC LIMIT 5`).all();
    const alerts = [];
    for (const a of d.prepare('SELECT sa.*, p.name product FROM stock_alerts sa JOIN products p ON p.id=sa.product_id WHERE sa.resolved_at IS NULL ORDER BY sa.id DESC LIMIT 5').all()) alerts.push({ type: 'stock', text: a.message, id: a.id });
    for (const o of d.prepare(`SELECT id, number, subject, due_at FROM complaints WHERE status IN ('new','in_progress','waiting') AND datetime(due_at) < datetime('now') ORDER BY due_at LIMIT 5`).all()) alerts.push({ type: 'sla', text: `شکایت ${o.number} از SLA عبور کرده: ${o.subject}`, id: o.id });
    for (const r of d.prepare(`SELECT i.id, i.number, c.name, i.total, i.due_date FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','overdue') AND i.due_date < datetime('now','-3 day') ORDER BY i.due_date LIMIT 5`).all()) alerts.push({ type: 'payment', text: `فاکتور ${r.number} — ${r.name} (${fmtNum(r.total)} ریال) سررسیدگذشته`, id: r.id });
    return { ...base2, churn, topCust, hotOpps, alerts, summary: null, complaintBank: bank };
  }
  if (role === 'sales_manager' || role === 'sales') {
    const funnel = d.prepare(`SELECT st.name, st.position, COUNT(o.id) c, COALESCE(SUM(o.amount),0) v FROM pipeline_stages st LEFT JOIN opportunities o ON o.stage_id=st.id AND o.status='open' AND o.archived_at IS NULL GROUP BY st.id ORDER BY st.position`).all();
    const perf = d.prepare(`SELECT u.id, u.full_name, COALESCE(SUM(i.total),0) s, COUNT(DISTINCT i.id) n, (SELECT COUNT(*) FROM tasks t2 WHERE t2.assignee_id=u.id AND t2.status='done' AND t2.created_at>=?) d, (SELECT COUNT(*) FROM followups f2 WHERE f2.user_id=u.id AND f2.done_at>=?) f FROM users u LEFT JOIN invoices i ON i.created_by=u.id AND i.status IN ('unpaid','partial','paid','overdue') AND i.issue_date>=? AND i.issue_date<=? WHERE u.archived_at IS NULL GROUP BY u.id ORDER BY s DESC`).all(cur.from, cur.from, cur.from, cur.to);
    const conv = (() => { const w = d.prepare("SELECT COUNT(*) c FROM opportunities WHERE status='won' AND won_at IS NOT NULL AND won_at>=?").get(cur.from).c; const t = d.prepare("SELECT COUNT(*) c FROM opportunities WHERE status IN ('won','lost') AND (won_at IS NOT NULL OR status='lost')").get().c; return t ? Math.round(w / t * 100) : 0; })();
    // sales chain KPIs (quote → order → invoice → payment)
    const chain = {
      openQuotes: d.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM quotes WHERE status IN ('draft','sent','viewed','accepted')`).get(),
      openOrders: d.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) v FROM orders WHERE status IN ('draft','confirmed','in_production','ready','shipped')`).get(),
      openInvoices: d.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total-paid_amount),0) v FROM invoices WHERE status IN ('unpaid','partial','overdue')`).get(),
      collectionsMonth: d.prepare(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM payments WHERE status='paid' AND paid_at>=? AND paid_at<=?`).get(cur.from, cur.to),
      commissions: d.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('calculated','pending') THEN amount ELSE 0 END),0) pending, COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END),0) approved, COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid, COALESCE(SUM(CASE WHEN status NOT IN ('cancelled') THEN amount ELSE 0 END),0) total FROM commissions`).get(),
    };
    return { ...base2, funnel, perf, winRate: conv, chain };
  }
  if (role === 'quality_manager') {
    const byCat = d.prepare(`SELECT category, COUNT(*) c FROM complaints WHERE created_at >= datetime('now','-90 day') GROUP BY category`).all();
    const byStatus = d.prepare(`SELECT status, COUNT(*) c FROM complaints GROUP BY status`).all();
    const sla = (() => { const t = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE status IN ('resolved','closed')`).get().c; const b = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE status IN ('resolved','closed') AND resolved_at > due_at`).get().c; const ok = t - b; return t ? Math.round(ok / t * 100) : 0; })();
    const csat = d.prepare(`SELECT AVG(csat) a FROM complaints WHERE csat IS NOT NULL`).get().a;
    const repeats = d.prepare(`SELECT COUNT(*) c FROM complaints WHERE repeat_of IS NOT NULL`).get().c;
    const rootCauses = d.prepare(`SELECT ai_root_cause, COUNT(*) c FROM complaints WHERE ai_root_cause != '' GROUP BY ai_root_cause ORDER BY c DESC LIMIT 5`).all();
    return { ...base2, byCat, byStatus, slaCompliance: sla, csat: csat ? Math.round(csat * 10) / 10 : null, repeats, rootCauses, complaintBank: bank };
  }
  if (role === 'warehouse_manager') {
    const value = d.prepare(`SELECT COALESCE(SUM(p.stock_qty * COALESCE(p.price_cost,0)),0) v FROM products p WHERE p.active=1 AND p.archived_at IS NULL`).get().v;
    const low = d.prepare(`SELECT p.id, p.name, p.stock_qty, p.unit, p.reorder_point FROM products p WHERE p.active=1 AND p.reorder_point>0 AND p.stock_qty<=p.reorder_point AND p.archived_at IS NULL ORDER BY p.stock_qty LIMIT 10`).all();
    const moves = d.prepare(`SELECT st.*, p.name FROM stock_transactions st JOIN products p ON p.id=st.product_id ORDER BY st.id DESC LIMIT 15`).all();
    const rawValue = d.prepare(`SELECT COALESCE(SUM(p.stock_qty * COALESCE(p.price_cost,0)),0) v FROM products p WHERE p.is_raw_material=1 AND p.active=1`).get().v;
    return { ...base2, stockValue: value, rawMaterialValue: rawValue, lowStockItems: low, moves };
  }
  if (role === 'lab_manager') {
    const byStatus = d.prepare(`SELECT status, COUNT(*) c FROM lab_requests GROUP BY status`).all();
    const overdue = d.prepare(`SELECT id, number, sample_desc, due_at FROM lab_requests WHERE status IN ('received','in_progress') AND datetime(due_at) < datetime('now')`).all();
    const passFail = d.prepare(`SELECT status, COUNT(*) c FROM lab_results WHERE status IN ('pass','fail') GROUP BY status`).all();
    const recent = d.prepare('SELECT lr.*, c.name customer_name FROM lab_requests lr LEFT JOIN customers c ON c.id=lr.customer_id ORDER BY lr.id DESC LIMIT 10').all();
    return { ...base2, byStatus, overdue, passFail, recent };
  }
  if (role === 'finance_manager') {
    const aging = d.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN datetime(due_date) < datetime('now','-30 day') THEN total-paid_amount ELSE 0 END),0) a1,
        COALESCE(SUM(CASE WHEN datetime(due_date) >= datetime('now','-30 day') AND datetime(due_date) < datetime('now') THEN total-paid_amount ELSE 0 END),0) a2,
        COALESCE(SUM(CASE WHEN datetime(due_date) >= datetime('now') THEN total-paid_amount ELSE 0 END),0) a3,
        COALESCE(SUM(CASE WHEN due_date IS NULL THEN total-paid_amount ELSE 0 END),0) a0
      FROM invoices WHERE status IN ('unpaid','partial','overdue')`).get();
    const collections = d.prepare(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM payments WHERE status='paid' AND paid_at >= ? AND paid_at <= ?`).get(cur.from, cur.to);
    const topDebtors = d.prepare(`SELECT c.id, c.name, COALESCE(SUM(i.total-i.paid_amount),0) s FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','overdue') GROUP BY c.id HAVING s>0 ORDER BY s DESC LIMIT 5`).all();
    const commissions = d.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('calculated','approved','pending') THEN amount ELSE 0 END),0) payable, COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid FROM commissions`).get();
    const receivablesTotal = d.prepare(`SELECT COALESCE(SUM(total-paid_amount),0) s FROM invoices WHERE status IN ('unpaid','partial','overdue')`).get().s;
    return { ...base2, aging, collections: collections.s, collectionsCount: collections.c, topDebtors, commissionsPayable: commissions.payable, commissionsPaid: commissions.paid, receivablesTotal };
  }
  return { ...base2 };
}
// Section 9: KPI for an arbitrary period (real DB only) — used by /api/dashboard?from=&to=
function periodKpi(from, to) {
  const d = get();
  const q = (sql, ...p) => d.prepare(sql).get(...p);
  const invCond = "status IN ('unpaid','partial','paid','overdue')";
  return {
    from, to,
    sales: q(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM invoices WHERE ${invCond} AND issue_date>=? AND issue_date<=?`, from, to),
    payments: q(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM payments WHERE status='paid' AND paid_at>=? AND paid_at<=?`, from, to),
    newCustomers: q(`SELECT COUNT(*) c FROM customers WHERE created_at>=? AND created_at<=? AND archived_at IS NULL`, from, to),
    newOrders: q(`SELECT COUNT(*) c FROM orders WHERE created_at>=? AND created_at<=? AND archived_at IS NULL`, from, to),
  };
}
module.exports = { base, roleData, monthlySeries, periodKpi };
