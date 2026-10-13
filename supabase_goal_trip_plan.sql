-- A planned trip keeps its whole plan with its goal (where, when, days,
-- travelers, the advisor's estimate, what the family told the trip chat and
-- the conversation), so it opens again in the planner. Applied. Safe to run again.
alter table goals add column if not exists trip_plan jsonb;
