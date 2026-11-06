-- Small thumbnails for project cards, so the project list doesn't download every full picture
-- (that made the list time out with "canceling statement due to statement timeout").
-- Run once in Supabase: SQL Editor → New query → paste → Run. Safe to run again.
-- The app fills this in by itself for existing pictures the next time the project list opens.
alter table public.project add column if not exists image_thumb text;
