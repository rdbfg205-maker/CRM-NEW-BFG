# FINAL MASTER AUDIT — WORKING NOTES
Server: port 3050, /home/user/baspar-crm. Respond in Persian. No mock/fake.

## FINDINGS (verified in code, not assumed)

### Section 2 NOTIFICATIONS
- notify.js core: DB insert + WS push — BUT `setWsHub` NEVER CALLED in server.js → live WS push dead. **BUG-1 (fix: server.js after getHub().attach → notify.setWsHub(getHub()))**
- WS hub (messenger.js): token-auth upgrade, ping/pong, per-user map ✓
- Frontend bell: unread dot, panel list 40, mark read/all, direct link map ✓
- Live toast on ws notification ✓ (but toast NOT clickable → needs click→link. **GAP-2 minor**)
- Event sources exist: complaints, approvals, calendar, campaigns, followup geo, meetings, messenger, portal, sales opp-won/payment/credit, smartsales, voip, stock alerts, workflow steps ✓
- MISSING event sources to check: proforma(quote) create, invoice create, order create, payment create (any), task assignment (generic task?), followup create (non-meeting). **CHECK-3**
- WS reconnect on close? **CHECK-4**

### Section 1 VOICE
- voice-reg.js: fa-IR STT, live interim, honest fallback, editable preview, source=Voice Assistant, status lead when incomplete, geo cascade, /api/voice/parse, real /api/r/customer save ✓
- Only wired in customers.js — need to check CONTACTS view wiring (mission: customer AND contact). **CHECK-5**
- /api/voice/parse route: verify exists + auth + audit. **CHECK-6**

## TODO
- [ ] Fix BUG-1 setWsHub
- [ ] Fix GAP-2 clickable live toast
- [ ] CHECK-3..6
- [ ] Sections 3..18 audit
- [ ] Security matrix
- [ ] Tests + final report
