# Pending items (updated 2026-08-10)

Read this first in any new session — it captures open threads so context isn't lost across machines/sessions.

## 🔴 Still waiting on the user — nothing to do until this info arrives
1. **Dashboard-₪0 bug** — still unconfirmed. Waiting on a DevTools Console
   screenshot (F12 → Console tab) taken while it's happening. Leading theory:
   a stale/invalid Supabase session JWT that still "looks" signed in
   client-side, but RLS silently returns 0 rows since `auth.uid()` doesn't
   resolve to a real membership — no error thrown, so the UI just renders
   zeros. If confirmed, fix is prompting a fresh sign-out/sign-in when a
   "signed in but RLS returns nothing" state is detected. This is the
   longest-standing open item — keep asking for the screenshot.
2. **Mobile text-size fix (shipped 2026-08-09)** — not yet confirmed by the
   user on their actual phone. Several `@media` breakpoints were shrinking
   text below desktop size (nav labels, dashboard numbers, table cells) —
   fixed, but ask them to check the installed PWA now looks right.
3. **Grok fallback decision** — x.ai account behind `GROK_API_KEY` has zero
   credits (`403 permission-denied`), so the AI fallback path is dead. User
   is hesitant to rely on Gemini alone (says Gemini itself has failed on
   them before too), but hasn't committed to adding billing at console.x.ai.
   A retry-once-before-falling-back mitigation already shipped (see below).
   Raise this again.

## 🟢 Diagnosed and resolved 2026-08-10 (no further action needed)
- **AI import error** — root cause: Grok fallback has zero x.ai credits (see
  above), so any transient Gemini hiccup cascaded into a hard failure with
  no working fallback. Fixed: `generateWithFallback()` in
  `budget-ai-server.js` now retries Gemini once (1.2s delay) before giving
  up. Gemini itself tested fine directly against the live key.
- **Google OAuth redirect URI "stale" item** — investigated and it's a
  non-issue in practice. There are TWO separate Google integrations in this
  codebase: (a) Supabase's own built-in "Sign in with Google"
  (`sb.auth.signInWithOAuth`), configured entirely inside the Supabase
  Dashboard — this is what real users actually use, confirmed working
  (multiple users have signed in this way with recent timestamps in
  `auth.users`); (b) a separate custom "Gmail connect" OAuth flow
  (`GOOGLE_CLIENT_ID`/`GOOGLE_OAUTH_REDIRECT_URI` env vars, `/api/google/*`
  routes in `budget-ai-server.js`) whose redirect URI is indeed stale — but
  it has **zero frontend hookup** (no button/link anywhere in
  `public/index.html` calls it), so nobody can trigger it and the stale
  redirect currently causes no real-world impact. Leave as-is; revisit only
  if this dead "Gmail connect" feature ever gets finished and wired into the
  UI, or delete it outright as dead code (folds into the legacy-code
  cleanup item below).
- **Email reminders "unverified" item** — root cause now confirmed: same as
  the Naomi-signup issue below. The Resend account behind `SMTP_PASS` has
  **zero verified domains** (checked directly via `api.resend.com/domains`),
  so the sandbox sender `onboarding@resend.dev` can only deliver to the
  Resend account owner's own email — reminders almost certainly don't reach
  anyone else. Real fix is verifying a real domain in Resend (see Naomi item
  below, same underlying blocker); not started, low urgency.
- **PNG app icons** — added. `icon-180/192/512.png` (regular) and
  `icon-maskable-192/512.png` (extra-padded variant so Android's
  circular/squircle mask doesn't clip the ₪ symbol) generated from the
  existing `icon.svg` via `sharp` and wired into `manifest.json` +
  `<head>`. iOS should now show the real logo on the home screen instead of
  falling back to a page screenshot.
- **Update-available banner** — added. Compares whether the page already had
  an active SW controller at load time; if a new SW takes over afterward
  (genuine update, not first install), shows a small "גרסה חדשה זמינה" /
  refresh banner instead of silently leaving users on stale cached code.
- **PIN + fingerprint/Face ID app-lock** — shipped (2026-08-10, user
  explicitly asked for this). Settings → "🔒 נעילת אפליקציה": set a 4-6
  digit PIN (salted SHA-256 hash in localStorage, per-device — a privacy
  layer, NOT a real auth boundary, Supabase RLS/login stay the real
  security), full-screen lock overlay on load, quick "🔒 נעל עכשיו" button in
  the sidebar footer, plus an optional WebAuthn platform-authenticator
  (fingerprint/Face ID) fast path once a PIN exists. "שכחתי את הקוד" recovery
  clears the local PIN and forces sign-out/sign-in. Not yet tested by the
  user on a real phone — ask if fingerprint/Face ID actually triggers
  correctly on their device.

## 🟡 Needs a Supabase Dashboard change — I have no programmatic access
**Naomi's registration failure** — confirmed via `auth.users` (service-role
admin API) that no account record was ever created for her signup attempt;
Supabase's own signup call failed outright, not just "email didn't arrive."
Root cause: Supabase Auth's confirmation emails go through Supabase's own
default mailer (separate from this app's Resend/SMTP setup), which is
free-tier rate-limited/unreliable. Wiring the app's existing Resend
credentials into Supabase's SMTP settings was considered, but **Resend has
zero verified domains** so that wouldn't actually have fixed delivery to her
either (see above).

**Decision made:** turn off "Confirm email" in Supabase now (free,
immediate); deal with verifying a real domain in Resend later if reminder
emails to other people matter enough to justify the DNS work.

**Next step — user said the previous instructions weren't clear enough
(2026-08-10), so re-walk through it MUCH more concretely next time, step by
literal step, confirming each screen before moving to the next one** (same
approach as the Render walkthrough, which worked well for them):
1. Go to https://supabase.com/dashboard and log in.
2. Click on this project (the budget app's project) to open it.
3. In the left sidebar, find the icon/label "Authentication" and click it.
4. Inside Authentication, look for a sub-tab/section called "Sign In / Up"
   or "Providers" (wording varies by Supabase UI version — look for
   something with "Email" in it).
5. Find the "Email" provider entry and open/expand it.
6. Look for a toggle switch labeled "Confirm email" (or "Enable email
   confirmations") and turn it OFF.
7. Click "Save" if there's a save button.
Confirm each of these steps landed correctly with the user one at a time
rather than dumping all 7 steps at once — that's likely why it didn't land
last time. Afterward, ask Naomi to retry the same WhatsApp invite link —
should work immediately, no email step. Confirm by checking `auth.users`
for her email via the service-role admin API (same script pattern used to
diagnose this).

## SQL migrations written but not yet confirmed run
- `supabase_category_budgets.sql` — `category_budgets` table (monthly
  budget-per-category feature).
- `supabase_advisor_conversations.sql` — `advisor_conversations` table
  (saved AI-advisor chat history). Degrades gracefully if missing.

## 💡 Ideas for next session — not started, discuss priority first
1. **Push notifications** — now that it's an installable PWA, real push
   (budget overrun alerts, bill due dates, month-end summary) is possible
   via Web Push API + service worker. Bigger effort: needs VAPID keys, a
   subscription table, a backend trigger. Natural next step after the PWA
   work, ties into the existing budget-vs-actual and reminders features.
2. **Weekly/monthly AI digest** — proactive AI summary (not on-demand),
   delivered via email or in-app, reusing `buildAdviceSummary()`.
4. **Household activity feed** — "מי הוסיף מה" recent-activity list, useful
   now that there are multiple real members (קובי + נעמי) sharing a
   household.
5. **Data export/backup** — confirm whether a full CSV/Excel export of all
   tables already exists; if not, worth adding as a safety net independent
   of Supabase.
6. **AI-import text truncation mismatch** — frontend allows up to 30,000
   chars for spreadsheets/text before sending; backend (`callGemini`/
   `callGrok`) truncates to 12,000 with no user-facing warning. A long
   statement could silently lose its tail end. Fix: raise backend limit to
   match, or surface a warning.
7. **Old `budget-ai` Render service** — delete once the merged `budget-web`
   service has been stable a while (housekeeping only, free tier).
8. **Dead legacy code** — root `server.js` (old Mongo-based server,
   `package.json`'s `"start"` still points to it though `render.yaml`
   bypasses it), the `server/` folder (unwired local-JSON routes), and now
   also the unwired "Gmail connect" `/api/google/*` routes (see above) —
   worth deleting outright once confirmed unused.
9. **No duplicate-detection on AI quick-add** (text/photo single-entry flow)
   — the bulk AI-import flow already flags likely duplicates; quick-add
   doesn't. Low risk, worth adding for consistency.

## 🟡 Repeated forced logouts (long-standing, mitigated not solved)
Root cause: Supabase refresh-token rotation — same account signed in on
multiple tabs/devices simultaneously invalidates whichever client refreshes
second. Mitigation shipped: `onAuthStateChange` re-checks
`sb.auth.getSession()` before treating a null session as a real logout.
User's own workaround: stay signed in on only one tab/device at a time.

## Architecture notes for continuity
- Single Render service (`budget-web`, running `budget-ai-server.js`, serves
  both frontend and AI/backend routes — old separate `budget-ai` service was
  merged in to halve cold-start latency on the free tier).
- Frontend: `public/index.html` (single file, ~3000+ lines, vanilla JS +
  Supabase). Backend: `budget-ai-server.js` (Gemini primary / Grok fallback
  — Grok currently unusable, see above).
- `server/`, root `server.js`, and the unwired `/api/google/*` Gmail-connect
  routes — legacy/dead code, not part of the live user-facing app.
- PWA: `public/manifest.json`, `public/sw.js` (network-first, no dynamic
  data caching — a stale balance would be misleading), real PNG icons as of
  2026-08-10, install button + manual-instructions modal, update banner.
- Full visual redesign (sidebar nav, transaction cards, category color
  system, custom modal kit replacing native dialogs, mobile responsive
  pass, Rubik typeface) completed across the 2026-08-04/09 sessions.
