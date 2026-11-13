-- New projects were saved without a created_at date, so they sorted to the END of the
-- project list (which is newest first). Run once in Supabase: SQL Editor → paste → Run.

-- 1. From now on, the database fills in the date automatically.
alter table public.project alter column created_at set default now();

-- 2. Give the projects that have no date one, keeping them newest and in the order they
--    were added (higher id = added later). Projects that already have a date aren't touched.
update public.project p
set created_at = coalesce((select max(created_at) from public.project), now())
               + (p.id * interval '1 second')
where p.created_at is null;
