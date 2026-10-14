-- ============================================================================
-- PHOENIX — Phase 2: badge system  (FINAL)
-- ----------------------------------------------------------------------------
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Idempotent: safe to re-run. ADDITIVE ONLY - no existing table, account,
-- session or game row is dropped, truncated or rewritten.
--
-- WHAT THIS CREATES
--   badges                     the badge catalogue (7 rarity tiers)
--   account_badges             which badges an account holds
--   account_featured_badges    the three featured slots (1..3)
--
-- DATABASE-ENFORCED protections (they hold even if the app code has a bug)
--   * exactly ONE account can ever hold THE PHOENIX
--       -> partial unique index `one_phoenix_holder`
--   * THE PHOENIX can only be granted to an account whose role is 'owner'
--   * THE PHOENIX can never be deleted or un-featured
--   * THE PHOENIX can only be FEATURED by the owner account
--   * a featured badge must actually be granted to that account
--   * a player can never hold more than three featured badges (slot 1..3)
--   * NO anon / authenticated access at all (RLS + REVOKE, as in Phase 1)
--
-- NOTHING here trusts a username. Ownership is read from accounts.role, which
-- the Phase 1 `one_owner` index already makes atomic and unique.
-- ============================================================================

-- 0) RARITY TIERS ------------------------------------------------------------
-- Divines sit at the very top, above Impossible.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'badges_rarity_tier' and conrelid = 'public.badges'::regclass
  ) then
    alter table public.badges
      add constraint badges_rarity_tier check (
        rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'impossible', 'divine')
      );
  end if;
exception
  when undefined_table then null;  -- table not created yet; the create below adds it
end $$;

-- 1) CATALOGUE ----------------------------------------------------------------
create table if not exists public.badges (
  key         text primary key,
  name        text not null,
  rarity      text not null,
  description text not null,
  sort_order  int  not null default 0,

  constraint badges_key_format   check (key ~ '^[a-z0-9_-]{2,40}$'),
  constraint badges_name_length  check (char_length(name) between 1 and 60),
  constraint badges_rarity_tier  check (
    rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'impossible', 'divine')
  ),
  constraint badges_desc_length  check (char_length(description) between 1 and 200)
);

-- THE PHOENIX. Seeded, never inserted by the app, and the only Divine today.
insert into public.badges (key, name, rarity, description, sort_order)
values ('phoenix', 'THE PHOENIX', 'divine', 'There can only be one Phoenix.', 1)
on conflict (key) do update
  set name        = excluded.name,
      rarity      = excluded.rarity,
      description = excluded.description,
      sort_order  = excluded.sort_order;

-- 2) GRANTS ------------------------------------------------------------------
create table if not exists public.account_badges (
  account_id uuid not null references public.accounts(id) on delete cascade,
  badge_key  text not null references public.badges(key),
  granted_at timestamptz not null default now(),

  primary key (account_id, badge_key)
);

-- 3) FEATURED SLOTS ----------------------------------------------------------
create table if not exists public.account_featured_badges (
  account_id uuid not null references public.accounts(id) on delete cascade,
  slot       int  not null,
  badge_key  text not null references public.badges(key),

  primary key (account_id, slot),

  constraint featured_slot_range check (slot between 1 and 3)
);

-- 4) AT MOST ONE PHOENIX HOLDER (the atomic arbiter, exactly like `one_owner`)
create unique index if not exists one_phoenix_holder
  on public.account_badges (badge_key) where badge_key = 'phoenix';

-- 5) ROW LEVEL SECURITY + lockdown -------------------------------------------
alter table public.badges                 enable row level security;
alter table public.account_badges         enable row level security;
alter table public.account_featured_badges enable row level security;

revoke all on public.badges                 from anon, authenticated;
revoke all on public.account_badges         from anon, authenticated;
revoke all on public.account_featured_badges from anon, authenticated;

revoke truncate on public.badges                 from public, anon, authenticated;
revoke truncate on public.account_badges         from public, anon, authenticated;
revoke truncate on public.account_featured_badges from public, anon, authenticated;

-- 6) IMMOVABILITY TRIGGERS ---------------------------------------------------
-- (a) THE PHOENIX may only be granted to the account that IS the owner.
create or replace function public.enforce_phoenix_grant() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  if new.badge_key = 'phoenix' then
    -- Ownership is read from accounts.role. Usernames are never consulted.
    select role into v_role from public.accounts where id = new.account_id;
    if v_role is distinct from 'owner' then
      raise exception 'THE PHOENIX badge can only be held by the owner account.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists account_badges_enforce_phoenix on public.account_badges;
create trigger account_badges_enforce_phoenix
  before insert or update of badge_key on public.account_badges
  for each row execute function public.enforce_phoenix_grant();

-- (b) THE PHOENIX grant is permanent.
create or replace function public.block_phoenix_revoke() returns trigger
language plpgsql as $$
begin
  if old.badge_key = 'phoenix' then
    raise exception 'THE PHOENIX badge is permanent and cannot be removed.';
  end if;
  return old;
end;
$$;

drop trigger if exists account_badges_block_phoenix_delete on public.account_badges;
create trigger account_badges_block_phoenix_delete
  before delete on public.account_badges
  for each row execute function public.block_phoenix_revoke();

-- (c) THE PHOENIX may only be FEATURED by the owner, and never un-featured.
create or replace function public.enforce_phoenix_featured() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role from public.accounts where id = new.account_id;
  if new.badge_key = 'phoenix' and v_role is distinct from 'owner' then
    raise exception 'THE PHOENIX badge can only be featured by the owner account.';
  end if;
  return new;
end;
$$;

drop trigger if exists featured_enforce_phoenix on public.account_featured_badges;
create trigger featured_enforce_phoenix
  before insert or update of badge_key on public.account_featured_badges
  for each row execute function public.enforce_phoenix_featured();

create or replace function public.block_phoenix_unfeature() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role from public.accounts where id = old.account_id;
  if old.badge_key = 'phoenix' and v_role = 'owner' then
    raise exception 'THE PHOENIX badge cannot be removed from the owner''s featured slots.';
  end if;
  return old;
end;
$$;

drop trigger if exists featured_block_phoenix_delete on public.account_featured_badges;
create trigger featured_block_phoenix_delete
  before delete on public.account_featured_badges
  for each row execute function public.block_phoenix_unfeature();

-- (d) A featured badge must actually be held by that account.
create or replace function public.enforce_featured_owned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.account_badges
     where account_id = new.account_id and badge_key = new.badge_key
  ) then
    raise exception 'That badge is not in this account''s collection.';
  end if;
  return new;
end;
$$;

drop trigger if exists featured_enforce_owned on public.account_featured_badges;
create trigger featured_enforce_owned
  before insert or update of badge_key on public.account_featured_badges
  for each row execute function public.enforce_featured_owned();

-- 7) SELF-HEALING GRANT FOR THE OWNER ---------------------------------------
-- Ownership already exists (Phase 1). This gives the owner their badge without
-- needing to re-claim, and re-asserts it on every call, so the badge can never
-- quietly go missing. It refuses outright for any non-owner account.
create or replace function public.ensure_owner_badge(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.accounts where id = p_account;
  if not found or v_role <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'not-owner');
  end if;

  insert into public.account_badges (account_id, badge_key)
  values (p_account, 'phoenix')
  on conflict (account_id, badge_key) do nothing;

  -- Slot 1 belongs to THE PHOENIX for the owner, permanently. Slots 2 and 3
  -- stay free for their own choices, so the UI can show slot 1 as locked.
  insert into public.account_featured_badges (account_id, slot, badge_key)
  values (p_account, 1, 'phoenix')
  on conflict (account_id, slot) do update
     set badge_key = excluded.badge_key
   where public.account_featured_badges.badge_key is distinct from excluded.badge_key;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    -- Another account already holds THE PHOENIX. The one_owner index makes
    -- this unreachable, but it must never fail a player's sign-in.
    return jsonb_build_object('ok', false, 'reason', 'already-held');
end;
$$;

-- 8) FUNCTION EXECUTION LOCKDOWN --------------------------------------------
revoke all on function public.enforce_phoenix_grant()        from public, anon, authenticated;
revoke all on function public.block_phoenix_revoke()         from public, anon, authenticated;
revoke all on function public.enforce_phoenix_featured()     from public, anon, authenticated;
revoke all on function public.block_phoenix_unfeature()      from public, anon, authenticated;
revoke all on function public.enforce_featured_owned()       from public, anon, authenticated;
revoke all on function public.ensure_owner_badge(uuid)       from public, anon, authenticated;

grant execute on function public.enforce_phoenix_grant()        to service_role;
grant execute on function public.block_phoenix_revoke()         to service_role;
grant execute on function public.enforce_phoenix_featured()     to service_role;
grant execute on function public.block_phoenix_unfeature()      to service_role;
grant execute on function public.enforce_featured_owned()       to service_role;
grant execute on function public.ensure_owner_badge(uuid)       to service_role;

-- ============================================================================
-- VERIFICATION (safe to run; reads only)
-- ============================================================================
-- Tables:
--   select table_name from information_schema.tables
--    where table_schema='public'
--      and table_name in ('badges','account_badges','account_featured_badges');
--
-- THE PHOENIX is seeded as Divine:
--   select key, name, rarity, description from public.badges order by sort_order;
--
-- Only ever one holder (0 rows before you claim the badge for the owner):
--   select a.username, a.role from public.account_badges b
--   join public.accounts a on a.id = b.account_id
--    where b.badge_key = 'phoenix';
--
-- Triggers:
--   select event_object_table, trigger_name from information_schema.triggers
--    where trigger_schema='public' and event_object_table like '%badge%';
