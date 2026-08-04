# Pending items (updated 2026-08-04)

Read this first in any new session — it captures open threads so context isn't lost across machines/sessions.

## 🔴 Critical — unresolved bug under active investigation
Dashboard shows ₪0 for ALL fields (income/expense/balance/pie chart) even for months
with confirmed real data in the DB (verified directly via Supabase service-role query —
July 2026 has hundreds of transactions, but the UI showed zero).

- **Confirmed NOT a data-loss issue** — all data is intact in Supabase (checked directly).
- Leading theory: same root cause as the repeated forced-logout issue (see below) — a
  stale/invalid Supabase session JWT that still "looks" signed in client-side, but
  RLS silently returns 0 rows for every query since `auth.uid()` doesn't resolve to
  a real membership. No error is thrown, so the UI just renders all zeros instead of
  showing an error state.
- Waiting on: a browser DevTools Console screenshot from the user (F12 → Console tab)
  taken while the bug is happening, to confirm/deny this theory. Not yet received as
  of this note.
- If confirmed: likely fix is prompting a fresh sign-out/sign-in when a "signed in but
  RLS returns nothing" state is detected, rather than just trusting the local session.

## 🟡 Repeated forced logouts
User reported being bounced to the login screen very frequently. Root cause: Supabase
refresh-token rotation — the same account signed in on multiple tabs/devices
simultaneously causes whichever client refreshes second to get invalidated.
Mitigation already shipped: `onAuthStateChange` now re-checks `sb.auth.getSession()`
before treating a null session as a real logout (reduces false positives, doesn't
eliminate the underlying multi-device conflict). User's own fix: stay signed in on
only one tab/device at a time.

## SQL migrations written but not yet confirmed run
Check with the user whether these have been run in the Supabase SQL Editor:
- `supabase_category_budgets.sql` — adds the `category_budgets` table (monthly
  budget-per-category feature in the Categories tab + dashboard progress bars).
- `supabase_advisor_conversations.sql` — adds the `advisor_conversations` table
  (saved/personal AI-advisor chat history). Without this, the advisor tab's
  "start consultation" and chat will fail to save (though they degrade gracefully —
  no crash, just nothing persists).

## Architecture notes for continuity
- Single Render service now (`budget-web`, running `budget-ai-server.js`, which
  serves both the frontend AND the AI/backend routes — the old separate `budget-ai`
  service was merged in to halve cold-start latency on the free tier).
- Frontend: `public/index.html` (single file, ~3000+ lines, vanilla JS + Supabase).
- Backend: `budget-ai-server.js` (Gemini primary / Grok fallback for all AI features:
  import, advisor analysis + chat, quick-add, goal-plan suggestions).
- `server/`, root `server.js` — legacy/dead code, not part of the deployed app.
- Full visual redesign completed this session: sidebar nav, transaction cards,
  category color system (`catColor()`/`PALETTE`), custom modal kit (`UI.alert/confirm/prompt`
  replacing native browser dialogs), mobile responsive pass.
