-- BeadRoom: only signed-in users can read or change data.
--
-- Before running this:
--   1. Supabase dashboard → Authentication → Users → "Add user" → "Create new user"
--      (your email + a password, tick "Auto Confirm User").
--   2. Authentication → Sign In / Providers → turn OFF "Allow new users to sign up",
--      so nobody else can make an account.
--   3. Deploy the new app version (with the login screen).
--
-- What this does, for each BeadRoom table:
--   * turns on row level security,
--   * removes every old policy (including any "anyone can read/write" ones),
--   * adds one policy: signed-in users can do everything,
--   * takes away the public (anon) key's access completely.
-- Safe to run more than once.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['project', 'project_color', 'project_pattern', 'color', 'category', 'inventory'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table not found', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;

    execute format(
      'create policy "Signed-in users only" on public.%I for all to authenticated using (true) with check (true)', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Check: every table should show rowsecurity = true and only the "Signed-in users only" policy.
select c.relname as table_name, c.relrowsecurity as rowsecurity,
       string_agg(p.policyname || ' → ' || array_to_string(p.roles, ','), '; ') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relname in ('project', 'project_color', 'project_pattern', 'color', 'category', 'inventory')
group by c.relname, c.relrowsecurity
order by c.relname;
