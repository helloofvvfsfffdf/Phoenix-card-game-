-- ============================================================================
-- PHOENIX — announcements
-- ----------------------------------------------------------------------------
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Idempotent: safe to re-run. ADDITIVE ONLY - it creates one table, one index
-- and one trigger, and drops no table, account, session, badge or game row.
--
-- WHAT THIS CREATES
--   announcements     posts written by the owner, shown on the main menu
--   announcements_recent   index for the "last 30 days" query
--
-- DATABASE-ENFORCED protection
--   * ONLY the account whose role is 'owner' may insert an announcement
--       -> trigger `announcement_author_only`
--     This holds even if the application code has a bug: a non-owner row is
--     refused by Postgres itself.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It deletes nothing. Old announcements are kept in the table forever; the
--     30-day window is a READ rule applied by the server, so nothing anyone
--     posted is ever removed behind their back.
--   * It grants no access to anon or authenticated. As in Phases 1 and 2 the
--     browser only ever reaches these rows through the Node server, which uses
--     the service-role key that never leaves the server.
-- ============================================================================

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint announcements_body_length check (char_length(body) between 1 and 400)
);

create index if not exists announcements_recent
  on public.announcements (created_at desc);

-- 1) LOCKDOWN ----------------------------------------------------------------
-- Nothing is ever readable or writable from the browser. Reads go through the
-- server so the 30-day window is decided in one place.
alter table public.announcements enable row level security;

revoke all on public.announcements from anon, authenticated;
revoke truncate on public.announcements from public, anon, authenticated;

-- 2) ONLY THE OWNER MAY WRITE ONE -------------------------------------------
-- Ownership is read from accounts.role - never from a username - exactly as it
-- is everywhere else in PHOENIX.
create or replace function public.enforce_announcement_author() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role from public.accounts where id = new.account_id;
  if v_role is distinct from 'owner' then
    raise exception 'announcements may only be written by the owner';
  end if;
  return new;
end;
$$;

drop trigger if exists announcement_author_only on public.announcements;
create trigger announcement_author_only
  before insert on public.announcements
  for each row execute function public.enforce_announcement_author();

-- Verification: no rows yet, and nobody but the owner can write one.
--
--   select count(*) from public.announcements;                   -- expect 0
--   insert into public.announcements (account_id, body)
--   select id, 'test' from public.accounts where role <> 'owner' limit 1;
--                                                             -- expect failure
