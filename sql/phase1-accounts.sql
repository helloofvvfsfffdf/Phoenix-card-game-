-- ============================================================================
-- PHOENIX — Phase 1: username + password account system  (FINAL)
-- ----------------------------------------------------------------------------
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- Idempotent: safe to re-run.
--
-- DATABASE-ENFORCED protections (always on, even if app code has a bug):
--   * unique usernames (case-insensitive)
--   * password_hash must be a bcrypt hash; role is only 'player' or 'owner'
--   * AT MOST ONE owner        -> partial unique index `one_owner`
--   * owner claim is immutable -> UPDATE can't reset claimed_by; DELETE blocked
--   * owner claim can't be recreated -> single-row table + TRUNCATE revoked
--   * NO anon/authenticated access to tables (RLS + REVOKE)
--   * NO anon/authenticated EXECUTE on functions (REVOKE, grant service_role)
--
-- SERVER-ENFORCED protections (next phase, app code):
--   * registration always inserts role='player' (never trusts a client role)
--   * bcrypt hashing; session tokens stored only as SHA-256 hashes
--   * setup key stored ONLY as a SHA-256 hash; raw key lives in a Render env var
--   * login/claim throttling, httpOnly cookies, server-side auth checks
-- ============================================================================

-- 0) PGCRYPTO (provides extensions.digest -> sha256) -------------------------
create extension if not exists pgcrypto with schema extensions;

-- 1) ACCOUNTS ---------------------------------------------------------------
create table if not exists public.accounts (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  password_hash text not null,
  role          text not null default 'player',
  created_at    timestamptz not null default now(),

  constraint accounts_username_format check (
    username ~ '^[A-Za-z0-9_]{3,22}$'
  ),
  constraint accounts_password_hash_format check (
    password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$'
  ),
  constraint accounts_role check (role in ('player', 'owner'))
);

create unique index if not exists accounts_username_lower
  on public.accounts (lower(username));

-- 2) SESSIONS (server-side, revocable) --------------------------------------
create table if not exists public.sessions (
  token_hash text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists sessions_account_id on public.sessions (account_id);
create index if not exists sessions_expires_at on public.sessions (expires_at);

-- 3) OWNER CLAIM (one-time, single row) -------------------------------------
create table if not exists public.owner_claim (
  id          int primary key default 1,
  token_hash  text,                       -- sha256 of PHOENIX_OWNER_SETUP_KEY
  claimed_by  uuid references public.accounts(id),
  claimed_at  timestamptz,
  constraint owner_claim_single_row check (id = 1)
);

-- 4) AT-MOST-ONE-OWNER (unique index = the atomic arbiter) ------------------
create unique index if not exists one_owner
  on public.accounts (role) where role = 'owner';

-- 5) ROW LEVEL SECURITY + table access lockdown -----------------------------
alter table public.accounts    enable row level security;
alter table public.sessions    enable row level security;
alter table public.owner_claim enable row level security;

revoke all on public.accounts    from anon, authenticated;
revoke all on public.sessions    from anon, authenticated;
revoke all on public.owner_claim from anon, authenticated;

-- Block TRUNCATE (bypasses row triggers) for non-service roles.
revoke truncate on public.accounts    from public, anon, authenticated;
revoke truncate on public.sessions    from public, anon, authenticated;
revoke truncate on public.owner_claim from public, anon, authenticated;

-- 6) IMMUTABILITY TRIGGERS --------------------------------------------------
-- (a) Never allow a SECOND owner.
create or replace function public.enforce_one_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner' and exists (
    select 1 from public.accounts where role = 'owner' and id <> new.id
  ) then
    raise exception 'An owner account already exists.';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_enforce_one_owner on public.accounts;
create trigger accounts_enforce_one_owner
  before insert or update of role on public.accounts
  for each row execute function public.enforce_one_owner();

-- (b) Never allow the owner claim to be RESET once used.
create or replace function public.enforce_claim_used() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.claimed_by is not null
     and (new.claimed_by is null or new.claimed_by <> old.claimed_by) then
    raise exception 'The owner claim has already been used and cannot be reset.';
  end if;
  return new;
end;
$$;

drop trigger if exists owner_claim_enforce_used on public.owner_claim;
create trigger owner_claim_enforce_used
  before update on public.owner_claim
  for each row execute function public.enforce_claim_used();

-- (c) Never allow the owner claim to be DELETED (keeps it permanent).
create or replace function public.enforce_claim_no_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'The owner claim record cannot be deleted.';
end;
$$;

drop trigger if exists owner_claim_no_delete on public.owner_claim;
create trigger owner_claim_no_delete
  before delete on public.owner_claim
  for each row execute function public.enforce_claim_no_delete();

-- 7) ATOMIC OWNER-CLAIM TRANSACTION -----------------------------------------
-- One call = one transaction. Validates the key, verifies the account,
-- assigns the owner role and records the claim. All-or-nothing.
create or replace function public.claim_owner(p_account uuid, p_setup_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_claim public.owner_claim;
  v_acct  public.accounts;
  v_key_hash text;
begin
  v_key_hash := encode(extensions.digest(p_setup_key, 'sha256'), 'hex');

  -- Lock the single claim row so concurrent claims serialise on it.
  select * into v_claim from public.owner_claim where id = 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'claim-not-initialised');
  end if;
  if v_claim.claimed_by is not null then
    return jsonb_build_object('ok', false, 'reason', 'already-claimed');
  end if;
  if v_claim.token_hash is null or v_claim.token_hash <> v_key_hash then
    return jsonb_build_object('ok', false, 'reason', 'invalid-key');
  end if;

  -- Verify the account exists and is not already the owner.
  select * into v_acct from public.accounts where id = p_account;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account-not-found');
  end if;
  if v_acct.role = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'already-owner');
  end if;

  -- Assign the owner role (the one_owner index is the final guard).
  update public.accounts set role = 'owner' where id = p_account;

  -- Record the successful claim (one-time).
  update public.owner_claim
     set claimed_by = p_account, claimed_at = now()
   where id = 1;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already-claimed');
end;
$$;

-- 8) FUNCTION EXECUTION LOCKDOWN --------------------------------------------
-- Default is EXECUTE for PUBLIC; lock these down to the service role only.
revoke all on function public.enforce_one_owner()             from public, anon, authenticated;
revoke all on function public.enforce_claim_used()            from public, anon, authenticated;
revoke all on function public.enforce_claim_no_delete()       from public, anon, authenticated;
revoke all on function public.claim_owner(uuid, text)         from public, anon, authenticated;

grant execute on function public.enforce_one_owner()             to service_role;
grant execute on function public.enforce_claim_used()            to service_role;
grant execute on function public.enforce_claim_no_delete()       to service_role;
grant execute on function public.claim_owner(uuid, text)         to service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Tables:
--   select table_name from information_schema.tables
--   where table_schema='public' and table_name in ('accounts','sessions','owner_claim');
--
-- RLS (3 rows, relrowsecurity = t):
--   select c.relname, c.relrowsecurity from pg_class c
--   join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname='public' and c.relname in ('accounts','sessions','owner_claim');
--
-- Triggers:
--   select event_object_table, trigger_name from information_schema.triggers
--   where trigger_schema='public';
--
-- Function execute revoked from anon (no rows):
--   select * from information_schema.role_routine_grants
--   where grantee in ('anon','authenticated') and routine_schema='public';
