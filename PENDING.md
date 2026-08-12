# Pending items (updated 2026-08-10, end of session)

Read this first in any new session — it captures open threads so context isn't lost across machines/sessions.

## 🟢 Resolved 2026-08-11 — category labels were skipping the middle level for 3-level chains
Follow-up to the batch below. User clarified their supermarket-subcategory
concern more precisely: "רמי לוי" IS correctly nested (confirmed directly:
`parent_id` chain is רמי לוי → סופר → אוכל, a real 3-level hierarchy), but
every place that renders "category · subcategory" only ever showed the root
+ leaf ("אוכל · רמי לוי"), silently dropping "סופר" — not a data bug, a
display bug, in two spots: the transaction picker's trigger label
(`txCategoryCell()`) and the grouped daily list's category tag. Both now
look up the subcategory's real parent and insert it whenever it differs
from the transaction's top-level `category_id` (i.e. whenever the picked
node is actually a grandchild). Verified with a simulated 3-level chain —
label now reads the full "אוכל · סופר · רמי לוי".

**🟢 Resolved 2026-08-12** — same root cause, the annual category-summary
panel (`renderCatSummary()`) also only rendered `subCats(c.id)` (direct
children), so a transaction tagged at a grandchild level (e.g. "רמי לוי"
under "סופר") rolled into the root "אוכל" total with no visible breakdown
row. Now walks one level deeper and renders nested "↳ leaf" rows under
their actual parent subcategory, each with its own computed total. Verified
via headless Chrome: injected a real 3-level chain + tagged transaction,
called `renderCatSummary()`, confirmed both the middle ("סופר (בדיקה)")
and leaf ("רמי לוי (בדיקה)") rows render with the correct amount.

## 🟢 Resolved 2026-08-11 — batch of category-picker bugs (3rd level, stay-open, contrast, installments)
User reported 4 real issues after actually using the category picker. All
fixed and verified end-to-end in `public/index.html`:
1. **No way to select a 3rd-level sub-subcategory on a transaction** —
   category management already supported creating one, but
   `txCategoryCell()` only ever rendered 2 levels. Now a subcategory's own
   children render nested underneath it when present.
2. **Picker auto-closed** after picking a category/subcategory that had
   children. Two compounding causes: missing `event.stopPropagation()` on
   the category option (letting the click bubble to the document-level
   close-all-pickers handler), and the post-selection full `render()`
   rebuilding the panel fresh/hidden with nothing to reopen it. Fixed both;
   added `reopenCatPicker()` called after render() when relevant.
3. **Looked "transparent"** — confirmed via computed styles + `elementFromPoint`
   this wasn't literal transparency or a z-index bug (solid bg, correctly
   on top). Real cause: too little contrast against the page, especially in
   **light theme** where panel/card/page are all near-white. Fixed with
   `var(--surface3)`, a heavier border, and an explicit stronger shadow.
4. **Installment cards had no category editing at all** — was a static
   badge; other transaction types already had an editable picker. Added
   `instCategoryCell()` (one-level, installments have no subcategory
   column) wired to a new `updateInstCategory()`.

Also investigated the user's data-quality concern (supermarket purchases
allegedly missing subcategories) directly against real data: **doesn't
hold up** — every recognized chain (רמי לוי, שופרסל, קואופ, יוחננוף,
ויקטורי, אושר עד, etc.) is already correctly subcategorized. The ~23
food-category transactions without one are small specialty shops (candy
stores, bakeries, delis) that don't cleanly fit an existing subcategory —
not a bug, just an edge case. Worth asking the user if they want new
subcategories added for those (e.g. "ממתקים/דוכן", "מאפייה"), or leave as
general אוכל.

## 🟢 Resolved 2026-08-11 — English UI toggle (nav, headers, auth) — Hebrew stays the data language
User asked for advice on consolidating scattered AI touchpoints (see the
advisor/planning merge below) AND separately for an English toggle. Shipped
both, verified with real screenshots.

**Scope, on purpose — read this before assuming something's untranslated
by mistake:** the toggle translates static app CHROME only, via
`[data-i18n]` attributes + the `I18N_EN` dictionary + `applyLanguage()`/
`toggleLanguage()` in `public/index.html`. Covered: sidebar nav (desktop +
mobile bottom bar + more-sheet), every panel `<h2>` header across all 14
tabs, the auth screen (login/register/labels), and the 6 manual "הוסף" add
buttons. **NOT covered, deliberately**: form field labels/placeholders
inside panels, action buttons other than the 6 "add" ones, dynamically
JS-rendered content (transaction/category/loan lists, chat messages), and
— most importantly — anything that's actual DATA rather than UI text
(transaction descriptions, category names, AI replies, user-entered text)
stays in Hebrew always, on purpose, regardless of language mode. Layout
stays RTL in both languages.
- 🌐 button in the sidebar footer + on the auth screen (so it's reachable
  before login too). Preference persists in `localStorage`.
- Real bug found and fixed before shipping: the sidebar's rail-word span
  originally had `data-i18n` on a parent that also contained a live nested
  child (`#syncDot`) — `textContent` replacement on translate would have
  silently destroyed that indicator permanently. Fixed by moving the tag to
  wrap only the static text; verified no other tagged element has this
  shape, and confirmed the sync-dot survives a full He→En→He round trip.
- Also fixed: the sidebar title ("Budget Manager") clipped in the
  fixed-width rail — added a separate shorter `app.title.short` ("Budget")
  key for that spot, kept the full name for the auth screen's `<h1>`.
- **Next step if the user wants deeper coverage**: extend `data-i18n`
  tagging to form labels/placeholders and remaining static buttons across
  panels — same pattern, just more of it. A full translation of dynamic
  content or AI replies would be a separate, bigger, different feature
  (machine-translating live data vs. static UI text).

## 🟢 Resolved 2026-08-11 — dashboard onboarding banner + natural chat animation
- Dismissible banner at the top of the main Dashboard tab (shown only when
  the household looks incomplete — no bank accounts/transactions) linking
  straight to the onboarding wizard, per user request that it be more
  central/visible than only living in its own nav tab.
- Advisor chat replies now fade+rise in instead of snapping into view
  (CSS animation on the newest message bubble only, not replayed on older
  messages each re-render).

## 🔵 New research/feature requests from the user (2026-08-11), not started
1. **Accessibility (נגישות) compliance check** — user explicitly flagged
   this as a real legal risk: Israel has a well-known pattern of lawsuits
   against websites lacking accessibility compliance (Equal Rights for
   Persons with Disabilities Law / תקנות נגישות השירות). This needs an
   actual audit against Israeli accessibility requirements (likely aligned
   with WCAG 2.0 AA, per Israeli Standard 5568), not just a vague "polish"
   pass — check things like: keyboard navigation, screen-reader labels/aria
   attributes, color contrast, focus indicators, alt text, form labels.
   Treat this as a real compliance task next session, not a nice-to-have.
2. **English language toggle** — user wants the option to switch the whole
   app to English while keeping Hebrew as the base/default. This is a real
   i18n undertaking (extracting every hardcoded Hebrew string into a
   translatable layer) — scope and discuss approach before starting, this
   is not a small task given the app is one big single-file HTML with all
   text inline.

## 🟢 Resolved 2026-08-11 — ma'aser (tithe) tracking feature, fully verified + a real bug it uncovered
Built per explicit user request: Settings → "🙏 מעשרות" (enable, rate
10%/20%/custom, exclude specific income categories from the calculation).
Adding any income transaction (manual form or AI quick-add — both funnel
through `addTransaction()`) now prompts to log a ma'aser obligation at the
configured rate; confirmed obligations become `loans` rows with a new
`is_maaser` flag, shown in their own "🙏 חובות מעשרות" section at the top
of the Loans tab (separate running total), above regular loans. Migration
`supabase_maaser.sql` run and confirmed (`user_settings.maaser` jsonb,
`loans.is_maaser` boolean). Verified fully end-to-end with real headless-
browser interaction: settings persist across reload, the prompt fires with
the correct computed amount, the loan lands in the right grouped section.

**Found and fixed a real, significant pre-existing bug while testing this**:
adding ANY transaction without selecting a credit card — via the manual
"הוסף" button, the client-side AI-import fallback, or the server-side bulk-
import endpoint — set `payment_method:'other'`, a value the DB check
constraint has never actually allowed (confirmed by trial-inserting
candidates: only `cash`, `standing_order`, `check`, `credit` pass). Every
card-less manual entry was silently failing with a bare native `alert()`.
The real household's card-less transactions only worked because they came
through the onboarding wizard or admin scripts, which already used
`standing_order`. Fixed all three call sites to use `'cash'` as the
card-less default (`public/index.html` ×2, `budget-ai-server.js` ×1).

## 🟢 Resolved 2026-08-11 — Charts tab: replaced a redundant chart with Income vs Expenses
User asked for more logical/sensible charts. Found the 2nd chart in the
Charts tab was pure redundancy: "סך הוצאות כללי לפי חודש" just re-plotted
the same total already visible as the stacked chart's column heights, same
average badge value, no new info. Replaced with a green/red income-vs-
expenses grouped-bar comparison per month — genuinely new information (the
dashboard only has a current-month snapshot, no trend view existed before).
Average badge now shows average monthly net balance, colored by sign.
Verified visually on desktop + mobile with real screenshots.

## 🟢 Resolved 2026-08-11 — duplicate detection tightened to merchant+exact-date
Follow-up to the fix below: the old matching logic never checked the
merchant/description at all — it only compared amount + a fuzzy 3-day date
window, so two unrelated purchases from different businesses on nearby
days could get wrongly flagged as duplicates. Per explicit user request,
`flagPossibleDuplicates()` now requires ALL of: same type, same amount,
same description (exact match), same calendar date (exact, no window).
Verified with 4 scenarios (true dupe, same-amount-different-merchant,
same-merchant-different-date) before shipping.

## 🟢 Resolved 2026-08-11 — real household data audit + root-caused duplicate-import bug
User uploaded two real MAX credit card PDF statements (Kobi's card ...1928,
Naomi's card ...2928) and asked to cross-check for duplicates and "put
things in order." Real household is `4198b313-7ebf-413e-a0ac-a0ae65853d7c`
(owner קובי = yc196819@gmail.com, member נעמי = neomivolftson@gmail.com —
note: `kobi.grinboim@mail.huji.ac.il` and `ng6904432@gmail.com` are
DIFFERENT accounts in DIFFERENT, unrelated households — don't confuse them
with the real active household again).
- Kobi's June statement: all 6 line items already existed in the DB,
  verified exact date+amount+description match (2 of them — Netflix,
  Vuicom mobile — are legit recurring monthly charges appearing once/month
  since January, not duplicates). Zero action needed.
- Naomi's July statement: **the entire month of July was missing** from her
  card in the system. Added all 14 missing transactions (₪1,912.35, exactly
  matching the statement total minus the installment portion already
  tracked separately), categorized consistently with how the household
  already tags the same merchants (e.g. ארומה/קיווי → אוכל/מסעדות ואוכל
  בחוץ, רמי לוי → אוכל/רמי לוי subcategory).
- **Found and deleted 11 genuine duplicate transactions** already sitting
  in the DB (unrelated to the two PDFs) — 10 groups where the exact same
  date+description+amount+type appeared 2-3 times. Confirmed these were
  real data-entry duplicates (not coincidental repeat purchases) because
  every row within each group shared the identical `created_at` timestamp
  down to the millisecond — proof of a single bad bulk-insert, not separate
  real purchases. Verified zero duplicate groups remain after cleanup.
- **Root-caused and fixed the actual bug**: `flagPossibleDuplicates()` in
  `public/index.html` only ever compared new AI-parsed items against
  already-saved DB transactions — it never checked whether the same line
  appeared twice WITHIN the same import batch. If Gemini's parse of a
  PDF/image emitted a line twice (which is apparently what happened,
  explaining the identical-timestamp duplicate groups), nothing caught it.
  Fixed to also check against earlier non-duplicate items in the same
  batch; verified with a synthetic two-identical-items test before
  shipping. This should prevent the same class of bug going forward.
- User also asked to make the AI-import screen "look more normal" —
  partially already addressed earlier today (mobile dead-space fix, styled
  error/success banners instead of raw colored text). No further visual
  work done on this screen in this pass; ask if it still feels off.

## 🟢 Resolved 2026-08-10 — systematic mobile design survey (all 14 tabs)
Per the user's "modernize the whole system" direction, screenshotted every
tab at a real phone viewport (390×844, demo account, playwright-core + the
system's local Chrome) and reviewed each for real issues:
- **Investment names truncating to 1-2 characters** ("קרן מחקה S&P 500" →
  "ק") — fixed, `.tx-mid` min-width + narrower value input on mobile. Note:
  the first attempt at this fix silently did nothing because it landed in
  an early `@media` block that appears BEFORE the base `.tx-mid` rule in
  source order — CSS cascade picks the LATER rule on a specificity tie
  regardless of which media query "sounds" more specific. Lesson for next
  time: mobile overrides must be placed after the base rule they override,
  not just inside a `max-width` block anywhere in the file.
- Dashboard, charts, advisor, categories, accounts, loans, installments,
  planning, sharing, settings, onboarding tabs: reviewed, all look
  reasonably good already — no other real issues found. (The dashboard pie
  chart looked broken in one screenshot; turned out to be a `fullPage`
  Playwright screenshot artifact with the fixed-position bottom nav bar and
  a canvas resize timing quirk, not a real bug — confirmed fine with a
  normal, non-full-page screenshot. Same fixed-bar-appears-mid-page thing
  showed up in several other full-page survey shots — always a capture
  artifact, not a real overlap; only trust normal-viewport screenshots for
  that.)
- Categories tab is very long/dense on mobile (budget-per-category +
  category editor) — legitimately a lot of content, not misrendering, just
  a lot of scrolling. Not fixed — flag if the user specifically complains
  about it, don't preemptively chop up a working data-management screen.

## 🟢 Resolved 2026-08-10 — transactions tab form pushed the actual list too far down
After the desktop-site-mode fix let the user actually see the real mobile
redesign, next feedback: the long manual add-transaction form (9+ stacked
full-width fields) sat between the AI quick-add box and the transaction
list, pushing what people actually look at (their transactions) far below
the fold on every visit. Fixed: wrapped the form body in `#manualAddBody`,
made the "הוספת תנועה" header a tap-to-expand toggle on mobile only
(`toggleManualAdd()`, gated on `window.innerWidth`), collapsed by default
under 820px. Desktop completely unaffected (verified with real screenshots
at both viewport sizes before shipping, both collapsed and expanded mobile
states). User also asked generally to "modernize the whole system's design,
without breaking daily workflow" — treat that as ongoing direction for
future polish passes, not a single task; keep using the verified
screenshot-before-shipping approach from today rather than guessing.

## 🟢 Resolved 2026-08-10 — "phone still shows old desktop layout" mystery
After the real mobile redesign shipped (bottom tab bar etc.) and was
verified live via curl, the user kept reporting the phone still showed the
old full desktop sidebar with zero changes, even after force-close/reopen
and an SW cache bump. Turned out to be **nothing on our end**: Chrome on
their phone had **"אתר מחשב" (Request Desktop Site)** enabled for this
origin, which forces the desktop viewport regardless of the page's own
responsive CSS/media queries — explains why literally nothing looked
different no matter what was shipped or how many times they reloaded.
Fix: Chrome (regular tab) → ⋮ menu → uncheck "אתר מחשב" for the site. This
is a good thing to check FIRST next time "nothing updates" on a specific
user's device despite server-side fixes being verified live — before
assuming it's a caching or deploy issue.

## 📍 Production URL
`https://budget-web-u0iy.onrender.com` — confirmed via `/api/health`. Use
this instead of guessing at `budget-web.onrender.com` (404s — wrong domain).
**Note when using WebFetch on this URL**: WebFetch caches responses for 15
minutes. If you re-check `/api/health` after telling the user to change
something on Render, append a cache-busting query string (e.g.
`?cachebust=<timestamp>`) or you'll see your own stale first reading and
wrongly conclude their fix didn't take — this ate a lot of back-and-forth
in the 2026-08-10 session before it was caught.

## 🟢 Resolved 2026-08-10 — the mobile complaint + new AI error (with real evidence)
User pushed back hard that mobile "still feels like a shrunk desktop site"
despite the 2026-08-09 font fix, demanded a real fix "even if it's a lot of
work," and reported a new Gemini error. Got two real screenshots this time
and diagnosed from actual evidence instead of guessing:

- **Real structural bug found and fixed**: at the mobile breakpoint, `.app`
  stayed `display:flex` (row) while only `.rail` got `width:100%` — with no
  `flex-direction:column` override, `<main>` (all tab content) was being
  squeezed to ~0 width and clipped by `overflow-x:hidden`. This — not font
  size — was the real cause of the "empty shrunk desktop" look.
- **Real mobile redesign shipped**: native-style fixed bottom tab bar
  (dashboard/transactions/charts/advisor + "עוד") replacing the cramped
  horizontal-scrolling icon row, plus a slide-up "more" sheet (icon grid)
  for the other tabs. `goToTab()` is now the shared tab-switch function used
  by both the desktop sidebar and the new mobile bar.
- **Verified with an actual headless-browser screenshot** at a real phone
  viewport (390×844) before shipping — logged into the demo account via
  Playwright + local Chrome, confirmed the fix visually, THEN pushed. Don't
  claim a visual/mobile fix works without doing this again if tooling allows
  (`playwright-core` + the system's installed Chrome/Edge at
  `C:/Program Files/Google/Chrome/Application/chrome.exe` — works without
  installing Playwright's own browser binaries).
- **AI-import error styling fixed**: error/success messages now use the
  `.auth-err` banner treatment (padded, tinted, rounded) instead of bare
  colored text, which looked broken/unfinished on mobile.
- **Gemini error root-caused**: Google intermittently rejects
  `models/gemini-2.5-flash` with "no longer available to new users" (verified
  directly — same key/model succeeded moments later, so it's an in-progress
  inconsistent deprecation, not a hard outage). Fixed by switching to
  `gemini-flash-latest`, an alias Google itself keeps pointed at their
  current recommended model — avoids this whole class of bug recurring.
  Applied both server-side (`budget-ai-server.js`) and in the client-side
  personal-Gemini-key fallback path.
- **The real deploy gotcha**: `render.yaml` had `GEMINI_MODEL` hardcoded to
  the old value. Because the service is Blueprint-managed, Render kept
  re-applying that value from the file on every deploy, silently reverting
  the user's manual dashboard changes — wasted a lot of back-and-forth
  before this was found. Fixed in `render.yaml` itself (commit a3d3787).
  **Lesson**: for a Blueprint-managed Render service, always check
  `render.yaml` first when a dashboard env var change "doesn't stick."
- Confirmed live in production (after the WebFetch cache gotcha above):
  `geminiModel: "gemini-flash-latest"`.

## ✅ Push notifications — fully deployed 2026-08-10
SQL migration run, VAPID env vars added (now also documented in
`render.yaml` with `sync: false`), `/api/health` confirms
`pushConfigured:true`. **Not yet confirmed a real test push actually
arrived on the user's phone** — ask.

## 🔴 Still waiting on the user
1. **Dashboard-₪0 bug** — still unconfirmed, the longest-standing open item.
   Waiting on a DevTools Console screenshot (F12 → Console tab) taken while
   it's happening. Leading theory: a stale/invalid Supabase session JWT that
   still "looks" signed in client-side, but RLS silently returns 0 rows
   since `auth.uid()` doesn't resolve to a real membership — no error
   thrown, so the UI just renders zeros. Keep asking for the screenshot.
2. **Grok fallback decision** — x.ai account behind `GROK_API_KEY` has zero
   credits (`403 permission-denied`), so the AI fallback path is dead. User
   was hesitant to rely on Gemini alone; a retry-once mitigation shipped
   2026-08-10 (`generateWithFallback()` retries Gemini before giving up).
   Given the Gemini model fix above (was likely the real cause of the
   "Gemini also fails sometimes" complaint), it's worth asking again whether
   they still want to fund Grok or are comfortable with Gemini-only now.
3. **Naomi's registration** — "Confirm email" was toggled off in Supabase
   (done live, step-by-step, 2026-08-10) and saved. **Not yet confirmed she
   successfully registered/logged in** — ask, then verify via `auth.users`
   through the service-role admin API if needed.
4. Fingerprint/Face ID app-lock and the mobile redesign — ask if they
   actually tested these on their own phone yet (not just the demo-account
   headless-browser verification I did).

## 🟡 Real email sending — wanted, not started
User confirmed 2026-08-10 they still want Supabase's auth emails (and the
app's own reminder emails) to actually deliver to other people, not just
rely on the confirm-email-off workaround. Root cause for both: the Resend
account behind `SMTP_PASS`/`RESEND_API_KEY` has **zero verified domains**
(checked directly via `api.resend.com/domains`), so the sandbox sender
`onboarding@resend.dev` can only deliver to the Resend account owner's own
email. Real fix needs a verified domain in Resend (DNS records, needs the
user to own a domain — ~$10-15/yr if they don't). Separately: **there is no
scheduler/cron in this app at all** — "reminders" has only ever been a
manual "send test" button, never actually cron-triggered. Fixing
deliverability alone won't make reminders (or automated push alerts) real —
a scheduler is also needed (Render Cron Job service, or an external trigger
like a GitHub Action hitting an endpoint on a schedule).

## 🟢 Other things diagnosed/resolved earlier 2026-08-10
- **Google OAuth redirect URI "stale" item** — non-issue. Two separate
  integrations: Supabase's own "Sign in with Google" (what users actually
  use, confirmed working) vs. a dead custom "Gmail connect" flow
  (`/api/google/*` in `budget-ai-server.js`) with zero frontend hookup —
  its stale redirect URI causes no real-world impact. Revisit only if that
  feature ever gets finished, or delete as dead code.
- **PNG app icons** — added (`icon-180/192/512.png` + maskable variants),
  wired into `manifest.json` + `<head>`.
- **Update-available banner** — added, shows on genuine SW updates only
  (not first install).
- **PIN + fingerprint/Face ID app-lock** — shipped, Settings → "🔒 נעילת
  אפליקציה". Local device-only privacy layer, not a real auth boundary.

## SQL migrations written but not yet confirmed run
- `supabase_category_budgets.sql` — `category_budgets` table.
- `supabase_advisor_conversations.sql` — `advisor_conversations` table.
  Degrades gracefully if missing.

## 💡 Ideas for next session — not started, discuss priority first
1. **Automated push/reminder triggers** — needs a scheduler (see above);
   natural follow-up now that the push notification pipeline itself works.
2. **Weekly/monthly AI digest** — proactive AI summary, reusing
   `buildAdviceSummary()`.
3. **Household activity feed** — "מי הוסיף מה" recent-activity list.
4. **Data export/backup** — confirm whether a full CSV/Excel export of all
   tables already exists (Settings → גיבוי נתונים has JSON/PDF/Excel export
   already — check if it's complete enough or if this idea is already done).
5. **AI-import text truncation mismatch** — frontend allows 30,000 chars,
   backend truncates to 12,000 silently. Raise backend limit or warn.
6. **Old `budget-ai` Render service** — delete once confident, housekeeping.
7. **Dead legacy code** — root `server.js`, `server/` folder, unwired
   `/api/google/*` Gmail-connect routes.
8. **No duplicate-detection on AI quick-add** (text/photo single-entry) —
   bulk import already has this, quick-add doesn't.

## 🟡 Repeated forced logouts (long-standing, mitigated not solved)
Root cause: Supabase refresh-token rotation — same account signed in on
multiple tabs/devices simultaneously invalidates whichever client refreshes
second. Mitigation shipped: `onAuthStateChange` re-checks
`sb.auth.getSession()` before treating a null session as a real logout.
User's own workaround: stay signed in on only one tab/device at a time.

## Architecture notes for continuity
- Single Render service (`budget-web`, running `budget-ai-server.js`, serves
  both frontend and AI/backend routes). **Blueprint-managed via
  `render.yaml`** — remember this file can silently overwrite dashboard env
  var changes; check it first when a Render setting "won't stick."
- Frontend: `public/index.html` (single file, ~3000+ lines, vanilla JS +
  Supabase), now with a shared `goToTab()` used by both desktop sidebar nav
  and the mobile bottom tab bar.
- Backend: `budget-ai-server.js` — Gemini (`gemini-flash-latest`) primary,
  Grok fallback currently unusable (zero x.ai credits), one retry on Gemini
  before failing. `web-push` for push notifications.
- `server/`, root `server.js`, unwired `/api/google/*` routes — legacy/dead
  code, not part of the live app.
- PWA: `public/manifest.json`, `public/sw.js` (network-first, no dynamic
  data caching), real PNG icons, install button, update banner, native-style
  mobile bottom tab bar + more-sheet (all shipped 2026-08-09/10).
- Full visual redesign (sidebar nav, transaction cards, category color
  system, custom modal kit, Rubik typeface, mobile bottom nav) completed
  across the 2026-08-04/09/10 sessions.
