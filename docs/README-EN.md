# BASPAR FOAM GARB — Smart CRM

Enterprise-grade CRM + AI platform for **BASPAR FOAM GARB** (a spinoff/knowledge-based foam manufacturing company). It manages the full customer lifecycle: *first contact → lead → opportunity → quote → order → invoice → payment → delivery → laboratory → support → complaint → loyalty → repeat sales*.

## Highlights
- **Customers 360** (contacts, purchases, receivables, complaints, timeline), credit limits, CLV, **AI churn risk**
- **Sales**: leads with **AI Lead Score**, visual **drag & drop pipeline**, opportunities, quote → order → invoice flow, payments, **commission engine**
- **Inventory**: raw materials & finished goods, in/out/transfer/adjust, reorder-point with **automatic alerts**
- **Suppliers** & purchase orders with quality/delivery/price ratings
- **Laboratory**: requests, test results (pass/fail), **lab report PDF**
- **Service**: complaints with **SLA + automatic escalation**, AI classification/sentiment/root-cause, CSAT, tickets, warranties, contracts
- **Marketing**: SMS/Email/WhatsApp campaigns with audience targeting, **loyalty program** (points/tiers/discounts)
- **Communication**: internal **messenger** (direct/group/channel, files, @mentions), **WebRTC voice/video**, meetings, outbox
- **AI**: Persian-language assistant answering from real DB data, smart complaint analytics, **sales forecasting**, churn prediction, anomaly detection, action recommendations, **RAG over company knowledge base**
- **Reports**: report builder (source/columns/filters/grouping) with **Excel/CSV export**, automated daily/weekly/monthly reports with AI analysis in Persian
- **Admin**: RBAC users/roles/permissions (own/team/department/all scopes), **2FA (TOTP)**, **audit log**, workflows, integrations, **backup/restore**
- **Localization**: fully RTL Persian + English, **Jalali (Shamsi) calendar**, Persian/Western digits, Rial/Toman, Vazirmatn font
- **Platform**: **PWA** (installable), limited **offline + auto-sync**, global search, command palette (Ctrl+K), print/PDF of documents with company logo

## Stack
- Frontend: modular SPA (ES Modules, no build step) — runs from any static host
- Backend: **Node.js 20+** (HTTP + WebSocket + scheduler + AI engine)
- Database: **SQLite** (better-sqlite3, WAL, FTS5) — ~75 relational tables, migration + seed included
- AI: local statistical/linguistic engine out of the box; **provider-based** (Gemini / OpenAI / Anthropic / custom) via Admin panel, keys encrypted (AES-256-GCM)

## Quick start
```bash
cd baspar-crm
npm install
npm start          # → http://localhost:3000
```
First login: **admin / admin1234** (change it on first login).

Demo data (34 customers, ~250 invoices over 20 months, leads, orders, complaints, lab…) is seeded on first run and can be removed from **Admin → Settings → Delete demo data**. Start clean: `SEED_DEMO=0 npm start`.

### Docker
```bash
docker build -t baspar-crm .
docker run -d -p 3000:3000 -v baspar-data:/app/data --name baspar-crm baspar-crm
```

### Windows desktop (Setup.exe)
```bash
cd electron
npm install
npm run dist      # → dist/BasparFoamCRM-Setup-x.y.z.exe (NSIS installer + desktop shortcut)
```
The desktop app embeds the same server + database (local server mode — no terminal for end users).
Quick alternative without compilation: open the web app → **Install App** (PWA) from Chrome/Edge on Windows.

## Environment variables (see `.env.example`)
| Var | Default | Notes |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DATA_DIR` | `./data` | DB + backups + uploads |
| `DB_PATH` | `$DATA_DIR/baspar-crm.sqlite` | Database file |
| `SEED_DEMO` | 1 | 1 = seed demo data on first run |
| `JWT_SECRET` | auto | set a fixed value for multi-instance deployments |

## Integrations (Admin → Settings)
SMS panel / Email / WhatsApp / Telegram / payment gateway / accounting / Iran tax system (modian): base URL + API key. Inbound webhook for delivery/opened status: `POST /api/webhook/:provider`. AI provider selection (local by default).

## API
`GET /api/docs` lists all endpoints. All modules follow the unified CRUD pattern:
`GET/POST /api/r/:resource`, `GET/PUT/DELETE /api/r/:resource/:id`, plus `/archive`, `/duplicate`, `/comments`, `/tags`, `/activities`, `/audit`, `/attachments`, `/items`, `/export?format=xlsx|csv`, `/import` → `/import/commit` (preview + validation + error report).

## Backup
Automatic daily backup + manual backup and **one-click restore** from Admin → Backup (portable SQLite file).

## Roles (predefined)
Super admin, CEO, sales manager, sales rep, finance manager/analyst, production manager, quality manager, lab, R&D, warehouse, support, marketing, field representative — plus fully custom roles with per-entity actions (view/create/edit/delete/export/approve/archive) and record scopes (own/team/department/all).
