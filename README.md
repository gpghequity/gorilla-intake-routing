# gorilla-intake-routing

Branded intake + routing app for Gorilla Realty / Good People Good Homes. Replaces three Google Forms (Buyer Intro, Seller/Deal Submission, Agent Join) with a single Node.js/Express app backed by SQLite locally (Postgres on Railway).

## Run locally

```
cp .env.example .env
# set ADMIN_PASSWORD in .env
npm install
node index.js
```

App runs at http://localhost:3001. Admin dashboard at http://localhost:3001/admin.

## Public routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page with three tiles |
| `/buyer` | Buyer introduction intake |
| `/seller` | Seller / deal submission (with file uploads) |
| `/join` | Agent recruitment intake |

## Admin routes

| Route | Purpose |
| --- | --- |
| `/admin/login` | Password-gated login (uses `ADMIN_PASSWORD` env) |
| `/admin` | Inbox dashboard with filters (inbox, by type, flagged, assigned, closed) |
| `/admin/submissions/:id` | Submission detail — status, assign, notes, close, delete |
| `/admin/agents` | Agent roster — add, edit, activate/deactivate, round-robin position |

## Routing logic

- **BUYER** → emails to Steve (`NOTIFY_STEVE_EMAILS`). Status `new`.
- **SELLER (LISTED)** → listed trigger words (`listed / MLS / agent / realtor / listing / expires`) found in any text field. Routed to Steve + Ryan only. Status `broker_review`. Red banner on detail view.
- **SELLER (storage)** → `property_type = self_storage` or free-text "self storage" / "self-storage". Routed to `NOTIFY_STORAGE_EMAIL`.
- **SELLER (standard)** → Steve + Ryan. Status `new`.
- **AGENT JOIN** → Steve. No round-robin.
- **Round-robin** (buyer + seller only): Steve clicks "Assign" → next active agent by oldest `last_assigned_at`. Manual override available.

## Environment variables

See `.env.example`. If SMTP is blank, emails are logged to the console instead of sent (useful for local dev).

## Deploy (Railway)

1. Push to GitHub (`gpghequity/gorilla-intake-routing`)
2. Create Railway project from repo, add Postgres plugin
3. Set env vars (`ADMIN_PASSWORD`, `SESSION_SECRET`, `SMTP_*`, `NOTIFY_*`, `APP_BASE_URL`)
4. Railway will `npm install` and run `npm start`

_Note: the current DB layer is SQLite-only. Postgres adapter to be added before first Railway deploy._
