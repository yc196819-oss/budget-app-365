# Database migrations

Every change to the database is one file here, run in name order.

- `20261125000000_baseline.sql` is the whole schema of the production database
  on 2026-11-25, taken from the live database itself. It is already applied in
  production: never run it there. It builds a new, empty database to match.
- After it, each change is a new file named `YYYYMMDDHHMMSS_short_name.sql`
  (UTC time, lower case, underscores), for example
  `20261201093000_add_goal_color.sql`. Never edit a file that was already
  applied; write a new one instead.

## Adding a change

1. Write the file here. Make it safe to run twice where possible
   (`if not exists`, `create or replace`, guarded `alter`).
2. Try it on the real database inside `begin; … rollback;` and note what it
   returned in the PR.
3. Apply it only after approval, then say in the PR that it was applied.
4. CI loads the baseline and every migration into an empty Postgres 17
   (`schema` job in `.github/workflows/test.yml`), so a file that does not run
   fails the PR.

The old `supabase_*.sql` files are in `../legacy`, as history only.
