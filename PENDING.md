# Pending items (updated 2026-08-10)

## 🟠 Two issues diagnosed 2026-08-10 (one fixed, one needs a user decision)

**1. AI import error — root cause found, partially fixed.**
Tested both providers directly against the live keys in `.env`:
- Gemini (`gemini-2.5-flash`) works fine.
- Grok (`grok-2-latest`) returns `403 permission-denied: "Your newly created
  team doesn't have any credits or licenses yet"` — the x.ai account behind
  `GROK_API_KEY` has never been funded, so the fallback is completely dead.
  Since `generateWithFallback()` tries Gemini then falls to Grok on any
  error, a single transient Gemini hiccup was turning into a hard failure
  for the user with no working fallback.
- Fix shipped: `generateWithFallback()` now retries Gemini once (after a
  1.2s delay) before giving up, so momentary Gemini errors self-heal instead
  of hitting the broken Grok path. This does NOT fix Grok itself.
- **Needs a decision from the user**: either add billing at
  console.x.ai (their team currently has zero credits), or just accept
  Gemini-only (it has a generous free tier and worked fine in testing) and
  leave `GROK_API_KEY` unset/ignore it. Ask next session if not already
  decided.

**2. Wife (נעמי) couldn't register via the WhatsApp invite link — root cause
found, needs a Supabase Dashboard change (can't be done from code/CLI).**
Checked `auth.users` directly via the service-role admin API — no account
record exists for her signup attempt at all, meaning Supabase's own signup
call itself failed (not just "email didn't arrive after signup succeeded").
This is a **known recurring issue** — the app already has dedicated error
handling for it (`authErrMsg()` in `public/index.html` specifically catches
`"Error sending confirmation email"`). Root cause: Supabase Auth's own
confirmation/reset emails are sent via Supabase's default built-in mailer
(separate system from this app's own Resend/SMTP setup used for the
reminders feature) — Supabase's default mailer is free-tier rate-limited
and unreliable. Two possible fixes, needs the user to pick one (both require
the Supabase Dashboard, which I don't have programmatic access to):
- **(a) Turn off "Confirm email"** — Supabase Dashboard → Authentication →
  Sign In / Providers → Email → toggle off "Confirm email". Fastest, removes
  the friction entirely, appropriate for a small trusted-family app. Slight
  security tradeoff (anyone with the invite link + an email address can sign
  in immediately without proving they own that inbox).
- **(b) Point Supabase's own auth email at the Resend SMTP the app already
  has** — Supabase Dashboard → Project Settings → Authentication → SMTP
  Settings → enable custom SMTP, reuse the same `SMTP_HOST`/`SMTP_USER`/
  `SMTP_PASS` values already sitting in `.env` (Resend). Keeps email
  verification, fixes reliability, but is a few more clicks.
Ask the user which they'd rather do next session, then walk them through it
step by step (same pattern as the Render env var walkthrough).

## Previously updated 2026-08-09

## 💡 Ideas for next session (brainstormed 2026-08-09, not started)
Start here next time — nothing below is implemented yet, just a prioritized punch list.

**Carried over / still真 open:**
1. 🔴 The dashboard-₪0 bug is still unconfirmed — still waiting on a DevTools
   Console screenshot from the user. Ask again at the start of next session;
   this stays the top blocker.
2. Ask the user to confirm the mobile text-size fix from today actually looks
   right on their phone (close + reopen the installed icon, or delete and
   reinstall it if it still looks stale).
3. Google OAuth redirect URI still stale (see full scan below) — confirm
   whether Google sign-in is even used before touching it.
4. Email reminders still unverified (Resend not configured, SMTP untested).

**New ideas from today's PWA/mobile work:**
5. **Real PNG icons instead of SVG-only.** `apple-touch-icon` doesn't render
   reliably from SVG on iOS (Apple's own spec wants PNG) — the home screen
   icon on iPhone may be falling back to a screenshot-of-the-page icon
   instead of our actual logo. Needs a PNG conversion (no local tool found
   yet — try an online converter or ask if ImageMagick can be installed) in a
   few sizes (180x180 for apple-touch-icon, 192/512 maskable for Android).
6. **Push notifications.** Now that it's an installable PWA, real push
   notifications become possible (budget overrun alerts, bill due dates,
   month-end summary) via the Web Push API + service worker — bigger effort
   (needs VAPID keys, a subscription table, a backend trigger), but it's the
   natural next step after today's PWA work and ties directly into the
   existing budget-vs-actual and reminders features.
7. **Splash screen / update banner.** Add proper `apple-touch-startup-image`
   or at least verify the manifest's `background_color`/`theme_color` produce
   a decent splash on Android; also consider a small "גרסה חדשה זמינה, לחצו
   לרענון" banner using the SW's `updatefound` event so users on stale
   cached shells get prompted instead of silently seeing an old version.
8. **PIN/biometric app-lock.** Since this now lives as an icon on the phone's
   home screen next to other apps, consider an optional PIN or WebAuthn
   unlock screen before showing financial data — low effort (a localStorage
   flag + a lock screen component), meaningful privacy win for a shared
   family phone.

**Product ideas (bigger, discuss before starting):**
9. Weekly/monthly AI digest — a short proactive AI summary (not on-demand)
   delivered via email or in-app, using the same `buildAdviceSummary()` data
   already built for the advisor.
10. Household activity feed — "מי הוסיף מה" recent-activity list, useful now
    that there are multiple real members (קובי + נעמי) sharing one household.
11. Data export/backup — confirm whether a full CSV/Excel export of all
    tables already exists anywhere in the app; if not, worth adding as a
    safety net independent of Supabase.

## Latest additions (2026-08-09 session, part 2) — no new SQL needed
- Fixed a real bug found via code review after the user reported the
  installed Android PWA "looks like a shrunk desktop site, letters are
  really small": several mobile `@media` breakpoints were setting font
  sizes SMALLER than the desktop values (nav labels, dashboard card
  numbers, table cells, the tx-summary hero number) — backwards for a
  touch screen. Brought those back to/above desktop size, bumped form
  input font-size to 16px on mobile (stops iOS auto-zoom-on-focus),
  hardened the viewport meta tag, and bumped the service worker's shell
  cache name (v1→v2) so any already-installed PWA repaints with a fresh
  shell. Not yet re-confirmed visually by the user on their phone — ask
  if it looks right now.

## Latest additions (2026-08-09 session, part 1) — no new SQL needed
- Onboarding wizard relocated out of Settings into its own permanent nav tab
  ("🧙 הקמה"), which also hosts install-app instructions. It now auto-triggers
  for brand-new households (0 bank accounts AND 0 transactions) on first login
  instead of the generic welcome guide; returning users still get the welcome
  guide as before.
- Real PWA install button (`installAppBtn`, the 📱 icon in the sidebar footer):
  wired to the actual `beforeinstallprompt` event so a real "Add to Home
  Screen" prompt fires on supported browsers (mostly Android Chrome). Falls
  back to a manual instructions modal (`showInstallInstructions()`, also
  reachable from the הקמה tab) with separate steps for iOS Safari, Android
  Chrome, and desktop — iOS never fires `beforeinstallprompt`, so it always
  needs the manual path.
- Advisor chat input upgraded from a single-line `<input>` to a resizable
  `<textarea>` (Enter to send, Shift+Enter for a newline), so users can send
  the advisor a long free-form message instead of one short line.
- Primary typeface switched from Heebo to Rubik (CSS + all Chart.js font
  configs) for a more modern/premium look; Suez One kept for the hero numbers
  only.

## Previous additions (2026-08-04 session) — no new SQL needed
- PWA support: `public/manifest.json`, `public/icon.svg`, `public/sw.js` — users can
  "Add to Home Screen" on mobile.
- AI onboarding wizard: Settings → "🧙 אשף הקמה מהירה עם AI" — chat-style interview
  (salary, accounts, cards, debts, goals) → editable review → writes to existing
  tables only (bank_accounts/credit_cards/transactions/loans/goals). No migration.
- Quick-add (תנועות tab) now handles a whole paragraph describing several
  transactions at once, routing to the existing bulk-import review panel when more
  than one transaction is detected.
- New "🔮 תכנון החודש הבא" panel in the Planning tab — projects next month from real
  data and offers AI advice (new backend endpoint `/api/ai/next-month-advice`).

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

## Full system scan (2026-08-04) — improvement points, ranked

1. **[Blocking] The critical dashboard-zero bug above** — nothing else matters much
   until this is root-caused.
2. **Google OAuth redirect URI is stale.** `GOOGLE_OAUTH_REDIRECT_URI` (both in Render's
   env and in Google Cloud Console's authorized redirect URIs) still points at the old
   `budget-ai-816e.onrender.com` domain from before the service merge. If "Sign in with
   Google" is actually used, it is currently broken. Needs: update the env var on
   `budget-web` AND the redirect URI list in Google Cloud Console to the new domain.
   Never confirmed with the user whether this login method is even in use.
3. **Email reminders are unverified.** The Settings → תזכורות "send test" button shows
   "שירות תזכורות צד שרת עדיין לא זמין" — the `/api/reminders/test` route exists
   server-side, so this is either a genuine send failure or a stale UI message; not yet
   root-caused. `resendConfigured:false` per `/api/health` (Resend key not set) but
   `smtpConfigured:true` — worth checking whether the SMTP fallback path actually works.
4. **AI-import text gets truncated inconsistently.** Frontend allows up to 30,000 chars
   for spreadsheets/text before sending; the backend (`callGemini`/`callGrok`) truncates
   to 12,000 chars with no user-facing warning. A long statement could silently lose
   the tail end of its transactions. Fix: either raise the backend limit to match, or
   surface a warning when truncation happens.
5. **Old `budget-ai` Render service** — should be manually deleted once the merged
   `budget-web` service has been confirmed stable for a while (housekeeping, not
   costing anything on the free tier, just clutter/confusion risk like the earlier
   duplicate-service mixup this session already ran into once).
6. **Dead legacy code still in the repo**: root `server.js` (old Mongo-based server,
   still what `package.json`'s `"start"` script points to, though Render's `render.yaml`
   bypasses it) and the `server/` folder (local-JSON-file-backed routes for
   transactions/categories/budgets/debts/savings — none of it wired into the live
   Supabase-backed app). Not causing bugs today, but a real trap for a future session
   that doesn't know to ignore it. Worth deleting outright if confirmed unused.
7. **No duplicate-detection on AI quick-add** (text or photo). The bulk AI-import flow
   flags likely duplicates against existing transactions; the newer quick-add/receipt-
   photo flow (which fills the manual form directly) does not run that same check.
   Low risk since it's single-transaction entry, but worth adding for consistency.
8. **Mobile CSS is best-effort, not visually verified.** All the phone-width fixes this
   session were reasoned through the CSS, not confirmed against a real device
   screenshot. Keep an eye out for anything that still looks broken on a phone.
9. **No retry within a single AI provider on transient failure** — a single failed
   Gemini call falls through straight to Grok (a paid API) instead of retrying Gemini
   once first. Minor cost-efficiency issue, not urgent.

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
