-- Bead pattern grid for a project, plus bead-mode progress.
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again: it only adds what's missing.

create table if not exists public.project_pattern (
  project_id  bigint primary key references public.project (id) on delete cascade,
  cols        integer not null check (cols between 1 and 300),
  rows        integer not null check (rows between 1 and 300),
  -- one colour code per cell, row by row, e.g. ["D4","D4","C7",...]
  cells       jsonb   not null,
  -- one character per cell: "1" = placed, "0" = not yet
  done        text    not null default '',
  -- row last worked on in bead mode (0-based)
  current_row integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- Thicker guide lines: every N cells (5 or 10, 0 = none), and how many cells come
-- before the first block. Empty offset = automatic (spare cells split between the edges,
-- e.g. a 52 board is 1 + 5×10 + 1).
alter table public.project_pattern add column if not exists guide_size integer not null default 5;
alter table public.project_pattern add column if not exists guide_col_offset integer;
alter table public.project_pattern add column if not exists guide_row_offset integer;

-- Same access as the rest of BeadRoom (the app uses the public anon key, no login).
-- If your other tables use stricter policies, copy those instead.
alter table public.project_pattern enable row level security;

drop policy if exists "BeadRoom full access" on public.project_pattern;
create policy "BeadRoom full access" on public.project_pattern
  for all to anon, authenticated
  using (true) with check (true);
