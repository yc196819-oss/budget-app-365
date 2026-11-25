# Working on this repo

## Communication
- Always respond to the user in Hebrew unless they write in English or ask for English. Keep code, identifiers, commit messages, and SQL in English.
- Use simple Hebrew. Comments and PRs also stay in English.
- End each update with the open questions, numbered.

## Before changing things
- Before any step that changes code, the database or data: explain exactly what will be done and wait for approval.
- Before a design change: show a preview (a screenshot or a prototype) first.
- Every stage in its own PR, with tests, and a before/after measurement.
- Database changes only as a migration, after a trial in a transaction that is rolled back. Migrations live in `supabase/migrations` (see its README); `supabase/legacy` is history only and is never run again.
- Ask before merging. Never change a user's data without consent.

## Privacy (public repo)
- No personal or financial data in code, tests, docs or screenshots: made-up names and amounts only.
- Secrets live only in the hosting environment, never in the repo.

## Running the tests
- Unit tests: `npm test`
- End-to-end: `CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64/chrome | head -1) node --test --test-concurrency=1 tests/e2e/<file>.e2e.mjs`
- Add a line to the top of `server/changes.js` (plain Hebrew) for every change people could ask about.
