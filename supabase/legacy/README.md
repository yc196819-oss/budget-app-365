# Old SQL files (history only)

These are the SQL files the database was built with before
`supabase/migrations` existed (until 2026-11-25). They were run by hand, in no
recorded order, and some no longer match the database: for example
`supabase_upgrade_budget.sql` grants functions that the database has since
closed. **Do not run any of them again.**

The current schema is `supabase/migrations/20261125000000_baseline.sql`, and
every new change goes into `supabase/migrations`.
