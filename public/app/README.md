# The new app

Served at `/app/`. The current app (`public/index.html`) keeps working at `/`
until the new one replaces it.

No build step: native ES modules, Preact + htm for components. The server
serves the libraries from `node_modules` (`/app/vendor/*`), so the page
needs no CDN and runs under a strict Content-Security-Policy. pdf.js is
loaded only when a PDF statement is picked.

```
public/app/
  index.html     shell and import map (the only inline code, allowed by its hash in the CSP)
  styles/        tokens (colors, light/dark), base, layout (mobile + desktop)
  src/
    main.js      entry point
    config.js    public client config (Supabase URL + anon key)
    app/         App root, Shell (layout), hooks: useRoute, useSession
    components/  shared UI: Icon, BottomNav, Sidebar, AdvisorRail, Sheet, SoonCard
    screens/     one folder per screen: auth, home, money, import, add, plans, assets, profile
    domain/      pure logic (formatting, routes, money, statement import; later budget and forecast), unit-tested
    data/        household data store (Supabase reads and writes, undo), statement importer
    lib/         html (Preact + htm), Supabase client, api (server calls), storage, toast,
                 xlsx (a small .xlsx reader, no library), pdf (pdf.js text), files
```

Statement upload: Excel and CSV are read on the device. Only merchants the
household has never categorized are sent to the AI, to suggest a category;
past choices for the same merchant always win. PDFs and photos have no table
to read, so their text or image goes to the AI. Duplicates of existing lines
start unchecked. Nothing is saved before the review, and saving can be undone.
Old binary .xls files are not read: the user is asked for .xlsx or PDF.

Home: what is left of the monthly budget, a forecast for the end of the
month (spent so far + last month's fixed lines that did not show up yet +
the pace of variable spending, leaning on the last 3 months early in the
month), free cash (the bank balance typed in by hand minus card purchases
not charged yet, an estimate), the next two weeks, and at most three things
that need attention, each with one action.

Plans: "the coming months" forecasts half a year month by month (3-month
averages, last month's fixed lines, yearly payments coming round, installments,
dated goals, and holidays not planned yet at what they cost last time), with
a verdict, up to one action, bars and a "what if" check that saves nothing.
Holiday plans and the quarterly check-in are saved as goals with a date and
plan items, the same shape the current app uses, so no schema change.
The check-in's "answered this quarter" mark is kept on the device.

Assets: net worth from bank balances, investments (live price × units through
the server's /api/market/quotes when there is a symbol, else the value typed
in), pension and study funds (long term), loans both ways, installments left
and card charges not taken yet. Accounts, investments and loans are added and
edited here, in the same tables the current app uses.

Advisor: the same conversations as the current app (advisor_conversations +
advisor_messages, shared with the household unless private; older
conversations keep their messages in a JSON column and are read from there).
The new app never deletes or edits a message. Questions go to the server's
/api/ai/advice-chat-stream with a summary of the numbers (no merchant names)
and the screen the person is on; voice in and read-aloud use the browser's
speech services. The AI switch in the profile turns off everything that would
send data to the AI from this device.

Learning corner: 116 lessons in 13 topics (src/content/learning), one a day
with a 2-question quiz and a streak. Progress is per person in
user_settings.learning (own row by RLS), with a copy on the device.

Rules:
- One home per entity, max depth 2 (tab, then one sheet), no sheet on top of a sheet.
- Same tabs in the same order on mobile and desktop.
- Anything that computes numbers goes in `src/domain/` as a pure function, with tests in `tests/`.

Stages: 0 skeleton, 1 money (done), 1b card statement upload (done), 2 home (done), 3 plans (done), 4 assets (done), 5 advisor and learning (done), 6 onboarding.

Tests:
- `npm test`: pure logic and the server (no browser).
- `npm run test:e2e`: the app in Chromium against a fake in-memory Supabase (`tests/e2e/helpers.mjs`). Locally, if Playwright's browser is not installed, point `CHROMIUM_PATH` at a Chromium binary.

Both run in GitHub Actions on every pull request and every push to main.
