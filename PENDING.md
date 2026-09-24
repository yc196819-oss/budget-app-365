# Pending items (updated 2026-09-24, end of session)

Read this first in any new session — it captures open threads so context isn't lost across machines/sessions.

## 🟢 Resolved 2026-09-24 (round 6) — vendor/store comparison ("which supermarket do I spend the most at")
User asked why there was no way to compare which supermarkets he
buys from most. Added this in two places:

- `openCategoryPeekModal()` (the category peek modal from round 3)
  now shows a "השוואה לשנת {year} — איפה הכי הרבה" section — a
  stacked bar + ranked legend of that category's spend grouped by
  `subcategory_id`, i.e. per specific store/vendor. Deliberately
  scoped to the **whole viewed year**, not just the current month
  like the rest of the modal — "which store do I buy from most" is a
  habit question, and a single month usually has too few transactions
  per store to be a meaningful comparison. Only shown when there are
  at least 2 distinct subcategory groups with spend (otherwise there's
  nothing to compare).
- The existing (pre-existing, easy to miss) per-category subcategory
  breakdown on the "קטגוריות" tab (`renderCatSummary()`) technically
  already showed this data but in whatever order `subCats()` returned
  it — not ranked. Sorted both the subcategory and sub-subcategory
  levels descending by yearly spend, so it now actually reads as a
  comparison instead of an arbitrary list.

Both depend on transactions actually being tagged to a specific
subcategory (store/vendor), not just left at the category root or the
generic mid-level (e.g. "סופר" alone, no specific chain) — which is
exactly what round 5's categorization fixes improve going forward,
and what the manual 3-level category-edit modal lets him fix by hand
for existing rows.

Verified via headless Chrome: seeded two test transactions tagged to
different food subcategories, confirmed the peek modal's comparison
section renders sorted with correct amounts/percentages via a fresh
page load (avoided a false negative from same-session client-state
staleness after direct DB inserts), confirmed the Categories tab's
subcategory rows are now sorted highest-spend-first, zero console
errors. Test data cleaned up from the demo household afterward.

## 🟢 Resolved 2026-09-24 (round 5) — real data-integrity bug found and fixed: category_id could point to a non-root category
User: an "אושר עד" (supermarket chain) transaction showed only "אושר עד"
as its category tag, not the expected "אוכל · סופר · אושר עד" hierarchy,
and he wanted smarter auto-categorization (recognize the specific store
chain, not just stop at "סופר") plus a save-gated category editor instead
of live-on-click.

**Root cause found**: `category_id` on a transaction is supposed to
always be a ROOT category (`rootCats()` filters `!parent_id`); the
display/breakdown/grouping logic throughout the app assumes this.
`normalizeImportedTransactions()` (the function that turns AI output
into a transaction row after quick-add/photo/statement import) only
validated that the AI's `category_id` existed *somewhere* in
`DB.categories` — not that it was specifically a root. When the AI (or
the keyword-hint fallback) returned a **sub- or sub-sub-category's id**
in the `category_id` field, it got stored as-is: a flat, non-root
category_id with `subcategory_id` left null, which is exactly why the
tag showed just "אושר עד" with no breadcrumb.

**Scanned the real household's data and found 107 transactions with
this exact bug** (not just אושר עד — also דלק/רכב, חשבונות/בית ודיור,
מסעדות/אוכל בחוץ, ביטוח בריאות, etc.) — wrote a one-off migration that
walks each bad row's category up its `parent_id` chain to the true
root (`rootOf()`, now a shared helper) and shifts the original
(specific) id into `subcategory_id`. All 107 fixed, re-verified
afterward: zero remaining rows where category_id isn't a root.

**Fixed the code so this can't recur and got smarter about depth**:
- `rootOf(id)` and `allDescendants(rootId)` helpers added.
- `normalizeImportedTransactions()` now resolves any non-root
  `category_id` the AI returns to its true root instead of trusting it
  flat, and validates `subcategory_id` against the *whole* subtree
  (any depth), not just direct children — previously a valid grandchild
  id (like a specific supermarket chain) would fail validation and get
  silently dropped.
- `findSubcategoryByHint()` now searches the full subtree first,
  preferring the deepest (most specific) name match, before falling
  back to the old direct-children-only keyword rules — so a merchant
  name that matches an existing specific leaf category (e.g. "רמי לוי")
  gets that leaf directly instead of stopping at "סופר".
- The category list sent to the AI (`buildCategoryTreeText()`, now one
  shared function instead of two near-duplicate inline builders) is a
  full indented tree including sub-sub-categories, with explicit
  instructions to match the most specific existing node and to keep
  merchant names/locations in the description intact rather than
  shortening them.
- **Not fully verified live** — Gemini is still hitting the "high
  demand" 502 from earlier in the session, so the AI's actual
  merchant-recognition behavior couldn't be tested end-to-end. The
  deterministic parts (root-resolution, deep hint-matching) were
  verified directly: a synthetic case reproducing the exact historical
  bug pattern resolves correctly, and the real 107-row fix + the
  "אושר עד" spot-check both confirm the underlying logic is sound.

**Also**: `openTxCategoryModal()` (from round 4) no longer writes on
every click. Selections are staged locally; nothing hits the DB until
the new "💾 שמירה" button is pressed, and "ביטול" discards the staged
choice. Extended it to a proper 3rd level too — picking a subcategory
that itself has children (e.g. "סופר") now shows those children
("אושר עד", "רמי לוי", ...) as a further optional refinement, so the
same manual depth the AI can reach is also reachable by hand.

Verified via headless Chrome: fresh boot zero errors on mobile+desktop
across every tab, manual-add/filter-modal/peek-modal/search/category-
grouping all still work, the category modal's save/cancel staging
behaves correctly (DB unchanged until save, cancel discards), the
normalization unit test passes, and the real-household migration was
independently re-verified read-only after running.

## 🟢 Resolved 2026-09-24 (round 4) — actual category-editing UI was undiscoverable, rebuilt it
User: "אין אפשרות לערוך על רשומה את הקטגוריה" — a transaction ("שכירות")
was mistagged as "בריאות" (health) with, in his experience, no way to
fix it. The editor existed in code (`txCategoryCell()` — a small
dashed-border "▾" button below the description, opening an inline
expanding tree of options inside the card) but was easy to miss,
especially since a SEPARATE static colored tag (`.tx-cattag`) sat
right next to it showing the same category name without being
clickable — exactly the kind of thing that reads as "there's no way
to edit this" even though a control is technically present a few
pixels away.

Replaced the whole mechanism: the category tag itself (`.tx-cattag`)
is now the single clickable control (pencil icon, hover state) and
opens `openTxCategoryModal(txId, isInst)` — a proper modal reusing
the same pill-grid pattern as the filter/peek modals from earlier
rounds, root categories first, subcategories appearing once a root
with children is picked, auto-closing when there's nothing more to
choose. Deleted the old inline picker's code path entirely for the
transactions tab (`txCategoryCell`, `selectTxCat`, `selectTxSub` —
confirmed unused elsewhere before removing) since it's now dead.

This also fixed a real gap: installment shadow-rows shown inside the
transactions list previously had **no category editor at all**
(`catEditor` was hard-coded empty for `t._isInst` rows) — they now
get the same modal, one level only (installments have no subcategory
column), matching what the Installments tab's own native list
already offered via the separate, untouched `instCategoryCell()`.

Also had to extend the mobile compact-card CSS (`#exBody .tx-card`
grid layout from an earlier session) to cover `#catPeekBody` too and
drop a stale `display:none` rule on `.tx-cattag` that was written
back when the tag and the picker button were two separate elements —
harmless before, but would have hidden the *only* category control
now that they're merged into one.

**Explicitly deferred, not acted on** (both raised by the user as
"maybe" ideas, not firm requests): a full color-scheme change, and
deleting the Graphs tab to merge it into Transactions — gave my own
recommendation against the merge (different time granularity: Graphs
is year-level trend analysis, Transactions is this-month detail;
merging risks recreating the clutter he's been fighting) and asked
him to confirm direction before touching nav structure.

Verified via headless Chrome: created a transaction pre-tagged to the
wrong category, confirmed the tag showed as a real problem, clicked
it, retagged root+subcategory through the new modal, confirmed the
card and the DB both reflect the change, confirmed an installment
shadow-row's tag also opens a working (1-level) editor, confirmed the
Installments tab's own native list still uses its original untouched
picker, zero console errors on mobile and desktop.

## 🟢 Resolved 2026-09-24 (round 3) — category click now peeks in a modal, dropped the serif font
Two concrete complaints from the user after round 2:
1. Clicking a category in the breakdown bar/legend applied it as a
   page-wide filter with no obvious way back except a small "נקה
   סינון" text button — felt like a trap ("אין איך לחזור לראות את
   השאר"). Changed the interaction: clicking a breakdown segment or
   legend item now opens `openCategoryPeekModal(cid)` — a modal
   showing that category's total, transaction count, and full list
   for the period. Closing it (✕/Escape/backdrop, all pre-existing
   `UI._open()` behavior) leaves the main list's filter completely
   untouched — nothing to reset, nothing to get stuck in. A "🔍 הצג
   רק את זה ברשימה למטה" button inside the modal still lets you apply
   it as a real filter for those who want that. The top-category
   insight chip is now also clickable and opens the same peek modal.
   Discovered along the way that the mobile-friendly transaction-card
   grid layout (from an earlier session's "declutter the 4-line
   mobile card" fix) was scoped to `#exBody .tx-card` only, so cards
   rendered inside this new modal fell back to the old cramped
   pre-fix layout — extended that CSS to also match `#catPeekBody
   .tx-card` so the modal's cards look identical to the main list's.
2. "הפונטים המגעילים האלו" — traced to the `Suez One` serif display
   font used for the big hero number, the AI-advisor health text, and
   the app's logo monogram. Dropped it app-wide in favor of the same
   `Rubik` family (at heavy 800/900 weight for the display spots)
   used everywhere else, and removed it from the Google Fonts import
   entirely. One consistent typeface across the whole app now instead
   of a sans/serif mix.

Also raised by the user, explicitly **not acted on yet**:
- A full color-scheme change — he said himself "זה עדיין לא" (not
  yet), so left untouched.
- Deleting the Graphs tab and merging it into the transactions tab —
  he floated this as "אולי אפשר" (maybe it's possible), not a firm
  instruction. This is a nav-structure change (removing a whole tab),
  so asked him directly whether/when to do it rather than guessing.

Verified via headless Chrome (mobile + desktop): fresh boot zero
errors, legend/breakdown-segment clicks open the peek modal without
touching the main filter, closing the modal restores exactly the
prior state, the in-modal "show only this" button still applies a
real filter correctly, manual-add/search/category-grouping/filter-
picker all still work, hero-number font confirmed as Rubik via
computed style.

## 🟢 Resolved 2026-09-24 (round 2) — full rebuild of the transactions-tab display, not just the filter bar
After shipping the filter-pill fix below, the user clarified further:
the "מזעזע, דורש שינוי מאסיבי" complaint was about the **whole
transactions-display screen** — the summary + the list — not just the
filter bar, and specifically that it gave no insight into spending
habits/changes. Explicit go-ahead to rewrite extensively ("אם צריך
לכתוב הרבה שורות אז אין לי בעיה").

Rebuilt `renderExpenses()` and the surrounding panel in
`public/index.html`:
- **Summary card** now shows, beyond the existing net/in/out numbers:
  a **vs-last-month trend badge** on the expense chip (reuses the
  existing `renderTrend()` component already used on the dashboard
  cards, so it's visually consistent, not a new pattern) — respects
  whatever category filter is active, so the comparison stays
  apples-to-apples; a **stacked category-breakdown bar** (top 6
  categories + "אחר", proportional width, colored per category) with
  a clickable legend underneath that applies the category filter;
  and two **auto-generated insight chips** — top spending category
  this month, and (only when viewing the actual current month) a
  pace projection ("בקצב הנוכחי: כ-₪X עד סוף החודש").
- **New toolbar**: a text search box (filters by description,
  live, keeps focus while typing) and a **קיבוץ לפי יום / לפי קטגוריה**
  toggle — category mode groups the list by category with a
  subtotal+count header per group instead of by day, sorted by
  spend descending, so the user can see exactly where money went
  without doing the math themselves.
- Refactored the month/installment-row assembly and the per-row card
  markup into shared helpers (`monthRows()`, `instRowsForMonth()`,
  `txCardHtml()`) since the same "give me this month's rows for a
  filter" logic is now needed three times (current month, previous
  month for the trend badge, and the list itself) — kept the
  deliberate tx_date-based (not moAmt-based) filtering semantics from
  before, per the existing in-code comment explaining why.

Verified via headless Chrome on both mobile and desktop viewports,
against the local dev server, before pushing: zero console/page
errors on fresh load, summary numbers/trend/breakdown/insights all
populate correctly, search filters the list and doesn't lose input
focus, category grouping renders group headers with correct
totals/counts, clicking a legend segment applies the category filter
correctly, clearing the filter works.

**Not yet addressed**: the still-missing "2 accounts since August"
transaction list the user referenced in an earlier message but never
actually attached (only the explanatory notes about what various
recurring-transfer labels mean arrived) — still needs to be requested
again. The voice-capture/forward-planning budget feature is still an
unbuilt, only-scoped idea awaiting explicit go-ahead.

## 🟢 Resolved 2026-09-24 — category filter pills on the transactions tab rebuilt (the real "מזעזע" complaint)
User clarified after round 2 (below) that hiding manual-entry behind a
modal was never the complaint — that part was fine. The actual pain
point, called out twice, was the category **filter bar** above the
transaction list: two rows of ~10-13 colorful pills in a horizontally
scrolling strip with no scroll affordance, so on load it often showed
content cut off mid-word at the edge and gave no indication there was
more to scroll to ("אין שום דרך להסתכל על זה"). Confirmed visually via
a mobile screenshot on production before touching anything.

Replaced the two `.filter-row` pill strips in `renderExpenses()` with
a single compact `[📋 הכל ▾]` trigger button (shows current filter,
plus a `✕ נקה סינון` chip when a filter is active) that opens a modal
(`openExFilterModal()`, reuses the existing `UI._open()` system) with
every category — expense and income — laid out in a wrapping grid, no
hidden overflow, nothing cut off. Removed the now-dead `.filter-row`
CSS. The unrelated `#catFilters` pill bar on the Graphs tab uses a
different container/pattern and was intentionally left untouched —
verified still working after the change.

Verified via headless Chrome (fresh boot zero errors, filter button
renders, modal opens with all 8 expense + 7 income root categories
visible with no scrolling needed, clicking a pill applies the filter
and closes the modal, clear button resets to "הכל", desktop layout
unaffected, Graphs-tab filters unaffected) before pushing.

## 🟢 Resolved 2026-09-23 — push notifications diagnosed, investments cleaned up, live market data added
User: push notifications on phone don't work. Checked `push_subscriptions`
for the real household — zero rows ever created, so the subscribe flow
was failing client-side, not a server/delivery issue (VAPID keys are
already correctly configured on Render). Likely cause: iOS only exposes
the Push API to an installed (home-screen) PWA — a bare Safari tab was
showing the generic "browser doesn't support push" message. Added
iOS-not-installed detection with a specific install prompt. **Not
confirmed fixed** — depends on whether that was actually his situation;
ask if push still doesn't work after installing to home screen, since
there could be a second issue on top.

Also: removed 2 bank account numbers that had leaked into investment
names during the data-reconciliation work; extended `editInv()` to
cover asset_type + current_value, not just name/cost (edit button
already existed, just didn't cover those fields).

New `GET /api/market/quote` (5-min cached) + a "שערי שוק" panel on the
investments tab — live USD/ILS and SPY price/change%, verified against
the real APIs. **Does not yet auto-update any specific holding** — that
needs a share-count field per holding to turn a live price into a
computed current_value, which doesn't exist yet. The Israeli קרן כספית
(money-market fund) still has no live-tracking path — no standard free
API the way SPY has; flagged to the user as a harder problem, not
started.

## 🟢 Resolved 2026-09-23 (round 2) — manual-add moved to a modal, real regressions found and fixed
The round-1 fix below (collapse by default) wasn't what the user meant
by "rebuild from the ground up" — they clarified: delete the old
approach entirely, AI quick-add should be the one obvious primary
action, no permanent form on the page at all. Moved manual-add into a
modal (`openManualAddModal()`, reuses the existing `UI._open()` system)
opened by a small "+ הוספה ידנית" link.

**This surfaced real bugs**, all from code that assumed the manual-add
fields (`#exType`/`#exCat`/`#exDate`/etc.) were always present on the
page — true before this change, not true once they only exist inside a
modal:
- A top-level page-load line set `#exDate`/`#loanDate`/`#instFirst`/
  `#invDate` in one unguarded statement — once `#exDate` stopped
  existing at load time, it threw immediately and silently killed the
  rest of the line, so the loans/installments/investments tabs stopped
  getting their default "today" date on every single page load. Not
  something the round-1 verification caught because that test never
  did a **fresh** page load.
- `fillCatSel()`/`updateSubSel()`, called from the main `render()` on
  *every* render (not just once), threw for the same reason. Now
  guarded to no-op when the modal isn't open.
- The AI-quick-add "found exactly one transaction" path directly
  poked `$('#exType').value=...` etc., assuming the inline form —
  this is a real, load-bearing feature (recognizing a single
  transaction from free text or a receipt photo) and it was fully
  broken by the modal move until fixed to call
  `openManualAddModal(prefill)` instead.

Also: bumped the service worker's `SHELL_CACHE` version (v3→v4) — the
user reported not seeing UI changes on their phone at all (even the
round-1 fix). Cause not confirmed (device-side, most likely browser/PWA
cache or an already-open stale tab — the server was verified serving
the new HTML correctly with `Cache-Control: max-age=0` both times), but
bumping the SW cache version is a safe, standard way to force a clean
break regardless of the exact mechanism.

**Real mistake made and fixed during cleanup**: after testing, ran a
too-broad `description ilike '%בדיקת%'` delete to remove test
transactions from the *demo* account, without scoping to household —
it also matched and deleted a genuine transaction from the real
household ("בדיקת מזוזות", ₪60, 14/7 — "בדיקת" is just the ordinary
Hebrew word for "checking of", not unique to test data). Caught
immediately, restored with the correct date/amount/account, but
**category_id is null** on the restored row since that wasn't known —
flagged to the user to set it if they want it categorized. Lesson: any
cleanup delete against real data needs to filter by household_id (or
just get the exact id(s) first), never a bare content pattern match.

## 🟢 Resolved 2026-09-23 (round 1, superseded above) — transactions tab manual-add form rebuilt
Follow-up to the item below — asked the user what specifically was bad
("everything — rebuild from the ground up"). Real diagnosis: the
manual-add form's collapse/expand toggle (`toggleManualAdd`) only
applied under 820px; on desktop all 13 fields were permanently fully
open in one flex-wrap row. Fixed: collapses by default on every screen
size now, split into 6 essential fields (grid-based, reflows 1/2/7
columns at breakpoints) + a "עוד אפשרויות" toggle hiding the 7 rarer
fields (nature/spread/account/card/installments). No logic changes —
`addTransaction()` etc. untouched, same field IDs. Verified the
restructuring didn't break submission (real end-to-end test: filled
description+amount, submitted, transaction appeared with the correct
amount) at 1440/900/390px, dark+light.

**Left alone this pass**: the category filter pills (`.filter-row`) —
already has `overflow-x:auto` so it doesn't wrap into a wall, judged
lower-urgency than the form. Worth a search/dropdown treatment later
if 21+ categories makes scrolling through them tedious.

## 🔴 Not started
1. **"I don't want to carry next month's plan in my head, I want a way
   to dump it all onto the system"** — user floated voice/voice-messages
   as a possible capture mechanism, explicitly said "think about a
   solution," did not ask for immediate implementation. This is really
   two separate features bundled: (a) a forward-looking/planned-
   transactions layer (the app currently has no concept of "this hasn't
   happened yet but I know it's coming"), and (b) a lower-friction
   capture modality (voice dictation/speech-to-text feeding the
   existing AI-parse pipeline, similar to how AI-import already turns
   free text into transactions). Worth pitching back a concrete
   recommendation before building anything.

## 🟡 Needs a manual step before it's live — Claude added as AI provider
Added `callClaude()` in `budget-ai-server.js`, wired as the new
**primary** provider ahead of Gemini/Grok (`generateWithFallback()`
tries Claude first, same one-retry-on-blip pattern as the existing
Gemini branch, falls through cleanly if unconfigured). New env vars
`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (default `claude-sonnet-5`),
added to `.env.example` and `render.yaml` as `sync:false`.

**This does nothing yet in production** — `sync:false` means Render
won't auto-populate the key; the user has to add `ANTHROPIC_API_KEY`
in the Render dashboard (Environment tab) themselves. Until then the
app behaves exactly as before (falls straight to Gemini, verified
locally with no key set — no regression).

## 🟡 In progress 2026-09-23 — visual redesign, v1 shipped (bold/vivid direction)
User asked for a full visual refresh ("everything looks outdated"), picked
"bold and lively dashboard" over neutral/minimal/light-airy alternatives
(offered via AskUserQuestion). Shipped a design-token-level pass: new
--accent3 + --grad-hero/--grad-warm/--glow-accent tokens, gradient top-
stripe + hover lift + entrance animation on `.card`, gradient-filled
`.btn`/`.pill.on`/nav-active, and every hardcoded rgba(108,140,255/…)
or rgba(82,214,164/…) glow color across the file swapped to match the
new accent RGB so nothing looks mismatched. Deliberately did NOT touch
`.card .value`'s pos/neg/neu color classes (no background-clip:text
gradient trick) — income/expense red/green coding matters more than
the effect. Verified via headless Chrome, dark+light, desktop+mobile,
no console errors, no regression to the mobile tx-card layout or
category picker from the previous session.

**Not yet touched, still the old flat style** — this was a token-level
pass that cascades broadly but wasn't an exhaustive per-component
rewrite: modals, charts/legend, the advisor chat bubbles, the category
picker panel, and the loans/installments/investments/accounts cards
(same ones flagged un-redesigned back on 2026-08-13) haven't gotten the
gradient/glow treatment specifically. If the user wants the bold look
carried further, that's the next chunk.

## 🟢 Also this session — investment auto-tracking, scoped not started
User wants investments to update themselves (S&P 500 index, USD/ILS
rate) instead of manual value entry, since "it's all transparent
online." Pushed back on that assumption before starting anything:
**SPY + USD/ILS** — yes, real free APIs exist, straightforward to add
as a small server endpoint. **The Israeli קרן כספית (money-market fund)
NAV** — not actually transparent via any standard free API the way a
US-listed ETF is; would need research into what data source (Israel
Securities Authority / the fund company's own site) is actually usable
before promising it. Nothing built yet — next step if the user wants to
proceed is to start with SPY/currency and investigate the fund-NAV
question separately.

## 📋 Not code — real financial data reconciliation for the live household
Same session, unrelated to the two items above: walked the real
household (קובי + נעמי, household id `4198b313-…`) through several
rounds of reconciling actual bank/credit-card statements (MAX ×7,
Isracard/Leumi JSON, income statements, treatment-payment transfer
lists, investment holdings) against what was in Supabase. Net effect:
~160 transactions added/fixed, 2 stale installment records replaced
with correctly-anchored ones (see `first_payment` = purchase date,
`payments_count` months auto-project going forward — don't log
individual per-payment transactions for installment purchases, that
double-counts), investments table replaced with the real current
holdings, several data-entry naming inconsistencies found and fixed
(e.g. recurring income mislabeled differently every month). This is
**data, not a code change** — nothing here needs re-doing, but if a
future session sees the household's July-September numbers looking
different from an old memory/summary, this is why: the numbers now are
the corrected ones.

## 🟢 Resolved 2026-08-13 — mobile transaction list looked cluttered/broken
User: "ברשימת התנועות במובייל אני חושב שזה ממש לא יפה ונראה מסורבל" — the
generic `.tx-card` flex row (badge/desc+meta/amount/actions all side by
side) has no room at phone width, so it wrapped into 4 stacked lines per
transaction with the category shown twice (a static colored pill *and* a
separate dashed-border picker trigger below it).

Rebuilt as a compact CSS grid, scoped to `#exBody .tx-card` inside the
existing `@media(max-width:600px)` block only — loans/installments/
investments/accounts share the `.tx-card` class but have different
internal structure, so they're deliberately untouched by this pass (not
verified to look good on mobile, just confirmed unaffected/unchanged).
New layout is 3 tight rows: `[icon] description — amount` /
`[icon] payment · ▾category` / `[edit][delete]`. Also merged the meta
row and the category-picker trigger onto one line and dropped the now-
redundant static category pill (the picker trigger already shows the
same category name+icon and is the interactive one).

Verified via headless Chrome at 390×844: clean 3-row cards, picker still
opens correctly and stays in-viewport, loans tab (other `.tx-card`
usage) renders unchanged, desktop (1440px) pixel-identical to before.

**If this comes up again**: the same 4-line wrapping problem likely
exists on the loans/installments/investments/accounts cards too (they
share `.tx-card` and weren't in scope this time) — worth the same
grid treatment if a user flags them.

## 🟢 Resolved 2026-08-12 — DB write errors were silently ignored in several places
Follow-up to the security pass below. Several delete/update handlers
(`delTx`, `delCat`, `delSub`, `delLoan`, `delInst`, `updInv`, `delInv`,
`addToGoal`, `delGoal`) fired the Supabase write and updated local state
+ re-rendered unconditionally, so a failed write (RLS denial, network
blip) still looked like it succeeded in the UI — the row stayed in the
DB and reappeared on next reload with no explanation. All 9 now check
`error` and show `UI.alert` instead of mutating local state on failure.

Also fixed two real crash risks (not just silent-fail): `addLoan()`
pushed `data` into `DB.loans` without checking `error` first (a failed
insert would `unshift(undefined)`, breaking `renderLoans()`), and
`ensureHousehold()`'s household-creation path used `hh.id` on a
possibly-undefined `hh` — if that insert ever failed, a brand new user's
onboarding would crash outright with no household created. `seedCategories()`
had the same shape; now skips a category's subs and logs a warning
instead of throwing if the root insert fails.

The PDF/AI-import client-side fallback loop (used when the server-side
`/api/import/commit` call fails) inserted transactions one at a time
without checking each result, then always claimed "N added" regardless
of actual outcome — now tracks per-row failures and reports the real
count.

**Deliberately left alone** (fire-and-forget writes where the gap
doesn't mislead anyone): the onboarding wizard's bulk inserts (bank
accounts/cards/recurring items during first-time setup) — the wizard
ends with `loadAll()` + a full re-render, so the true saved state is
what the user sees next, not a false success claim. Also `genInvite`,
push-subscription cleanup, and the advisor chat autosave — none of
these are financial data and a rare failure there is genuinely low
stakes.

Verified via headless Chrome: stubbed a failing `transactions.delete()`
through `sb.from`, called `delTx()`, confirmed the transaction stays in
`DB.transactions` with an error modal shown instead of silently
disappearing from the UI.

## 🟢 Resolved 2026-08-12 — security hardening pass (external review response)
User pasted a third-party code review flagging several issues. Verified each
claim against the actual code before acting (not all were accurate — see
below) and fixed what was real:

1. **No server-side auth on `budget-ai-server.js`** — every sensitive
   endpoint (`/api/import/commit`, `/api/ai/*`, `/api/push/test`,
   `/api/reminders/test`, `/api/channels/test`) trusted a `userId`/
   `householdId` sent in the request body, then acted via the Supabase
   service-role key. Anyone who found the Render URL could act as any
   user with zero login, including burning the Gemini quota through the
   unauthenticated AI routes. Added `requireAuth` middleware — verifies
   the real Supabase access token (`Authorization: Bearer <token>` via
   `supabaseAdmin.auth.getUser`) and derives the user id server-side.
   `/api/import/commit` also now verifies household membership and that
   any category/account/card id in the import actually belongs to that
   household before inserting.
2. **Stored XSS, confirmed and worse than the review claimed** — the
   review said an `esc()` helper "already exists in some places"; it
   didn't exist anywhere. ~30 `innerHTML` sites interpolated raw user
   data (transaction description, category/account/card names, loan
   counterparty/note, investment/goal names, household member display
   name, advisor conversation titles). One household member could plant
   a payload that fires in another member's browser on a normal screen.
   Added a global `esc()`, applied at every real render site. Also found
   and fixed a real gap in `UI.prompt()`'s own narrow local escaper —
   quote-only escaping isn't sufficient for its `<textarea>` field
   (renders as HTML text content, not an attribute).
3. **CORS wide open** (`cors()`, no origin restriction) — replaced with
   an allowlist; harmless in practice since frontend+API are same-origin
   on Render, but real hardening for local/other-origin cases.
4. **No rate limiting anywhere**, including the Gemini-backed AI routes —
   added `express-rate-limit` (20/min/user on AI+import, 5/min on
   notification-test endpoints).
5. **Deleted 8 endpoints with zero frontend callers** (confirmed via grep
   first): the Google OAuth connect/callback/disconnect flow (never
   wired to any UI), `/api/user/household/:userId`,
   `/api/categories/bootstrap`, `/api/ai/next-month-advice`, and the
   legacy `/api/reset/request`+`confirm` email-code flow — already
   superseded by the `reset_household_full/month` RPCs (see below).
   Removed their now-orphaned helper functions and the unused
   `mongoose`/`uuid` deps.

**Review claims that were checked and found inaccurate — not applied:**
the review said `reset_household_full/month` risk a partial failure
(some tables deleted, then an error leaves the rest). Checked
`supabase_password_reset.sql`: those are single Postgres functions —
atomic by default, no partial-failure window — and they derive the
household from `auth.uid()` server-side rather than trusting a
client-supplied id. That's already the correct pattern. The JS
delete-loop the review was describing was the *old* `/api/reset/confirm`
endpoint, dead code the current frontend doesn't call — removed in this
pass as dead code, not because the RPC path has the bug.

Verified via headless Chrome against the live server: unauthenticated
and invalid-token requests to protected endpoints return 401; an
authenticated request goes through end-to-end (real Gemini advice
response returned); a malicious category name renders as literal escaped
text in both the category summary and category management panels with
no script execution; deleted routes fall through cleanly to the SPA
shell.

**Not done in this pass (lower priority / bigger scope, flag if it comes
up again)**: `index.html` is a single ~5,000-line file and could use a
module split; account balances still live in `localStorage` per-device
rather than Supabase; `nodemailer` has an unpatched high-severity
advisory (`npm audit`) but upgrading is a breaking change not yet
tested against the reminder-email flow.

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
