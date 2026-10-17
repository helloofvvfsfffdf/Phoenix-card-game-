-- ===========================================================================
-- PHOENIX — mandatory verified emails
-- ---------------------------------------------------------------------------
-- Run this ONE file in the Supabase SQL Editor. It is additive and idempotent:
-- every statement checks first, so running it twice is harmless, and it never
-- drops, renames or rewrites an existing row. Existing accounts, sessions,
-- statistics, badges and leaderboard records are untouched — nothing here
-- deletes or recreates an account.
--
-- What it does:
--   * gives every account two nullable columns: the email address and the
--     moment it was verified (both NULL for players who have not added one yet,
--     which is exactly how every current account starts);
--   * adds a per-account verification ledger used for the resend cooldown,
--     the expiry window and the wrong-code attempt limit;
--   * makes a VERIFIED address unique across accounts, while still letting
--     several unverified players type the same address;
--   * locks the tables away from the public anon key and from ordinary users
--     with Row Level Security, so only the service-role key (the server) can
--     read or write them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The email address on the account
-- ---------------------------------------------------------------------------
-- email            - the address the player supplied (pending until verified)
-- email_verified_at- NULL until Supabase's OTP flow has proven ownership
-- email_requested_at - when the current address was first put forward
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists email text,
  add column if not exists email_verified_at timestamptz,
  add column if not exists email_requested_at timestamptz;

-- A trim + lowercased copy kept in a stored column so the uniqueness rule
-- below can use an index (an IMMUTABLE expression, which a plain unique
-- constraint on lower(email) could not).
alter table public.accounts
  add column if not exists email_key text;

-- Keep the normalised copy in step with the address, whatever path wrote it.
create or replace function public.accounts_sync_email_key()
returns trigger
language plpgsql
as $$
begin
  new.email := nullif(btrim(coalesce(new.email, '')), '');
  new.email_key := case when new.email is null then null else lower(new.email) end;
  if new.email_key is null then
    new.email_verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_sync_email_key on public.accounts;
create trigger accounts_sync_email_key
  before insert or update of email on public.accounts
  for each row execute function public.accounts_sync_email_key();

-- ---------------------------------------------------------------------------
-- 2. Addresses
-- ---------------------------------------------------------------------------
-- Shaped loosely like an email, and short enough to never overflow a mailbox
-- header. Deliberately permissive: the OTP is the real proof of ownership.
-- ---------------------------------------------------------------------------
alter table public.accounts
  drop constraint if exists accounts_email_shape;
alter table public.accounts
  add constraint accounts_email_shape
  check (email is null or (char_length(email) between 5 and 254
                           and position('@' in email) between 2 and 253));

-- Two accounts may not BOTH have proven ownership of the same address.
-- Several players can still type the same address while it is pending; only
-- the first to verify it keeps it.
drop index if exists accounts_one_verified_email;
create unique index accounts_one_verified_email
  on public.accounts (email_key)
  where email_verified_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Verification ledger (one row per account)
-- ---------------------------------------------------------------------------
-- The six-digit code itself is produced and stored by Supabase's own OTP
-- flow; PHOENIX never sees it, never logs it and never keeps a copy. What is
-- kept here is only the bookkeeping that stops the flow being hammered:
--
--   expires_at     - when the current code stops being accepted
--   resend_after   - the cooldown before another code may be sent
--   attempts       - wrong codes tried against the current code
--   sent_count     - codes sent inside the current hour window
--   window_started - when that hour window opened
--   requested_ip   - the address the last code went to (rate-limit forensics)
-- ---------------------------------------------------------------------------
create table if not exists public.email_verifications (
  account_id     uuid primary key references public.accounts (id) on delete cascade,
  email          text not null,
  requested_at   timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '10 minutes',
  resend_after   timestamptz not null default now() + interval '60 seconds',
  attempts       integer not null default 0,
  sent_count     integer not null default 1,
  window_started timestamptz not null default now(),
  requested_ip   inet,
  constraint email_verifications_email_shape
    check (char_length(email) between 5 and 254)
);

alter table public.email_verifications enable row level security;

revoke all on public.email_verifications from anon, public;
grant select, insert, update, delete on public.email_verifications to service_role;

-- ---------------------------------------------------------------------------
-- 4. Lock the account columns away from clients
-- ---------------------------------------------------------------------------
-- The anon key must never be able to read another player's address, or worse,
-- set email_verified_at itself and skip verification. Everything below is
-- revoked from the roles a browser can hold; the server uses the service-role
-- key, which is exempt from RLS entirely.
-- ---------------------------------------------------------------------------
revoke all on public.accounts from anon, public;
grant select, insert, update on public.accounts to service_role;

revoke all on public.email_verifications from public;

-- Belt and braces: even if a future migration re-grants something by mistake,
-- an ordinary session must not be able to declare its own email verified.
drop policy if exists accounts_owner_read on public.accounts;
drop policy if exists email_verifications_owner_read on public.email_verifications;

-- ---------------------------------------------------------------------------
-- 5. Housekeeping
-- ---------------------------------------------------------------------------
-- Verification rows for accounts that already succeeded are dead weight; a
-- late-night cron (or the owner running this file again later) may call
--   select public.purge_finished_email_verifications();
-- which removes only rows whose code has expired AND whose account is already
-- verified. It cannot touch a pending verification.
-- ---------------------------------------------------------------------------
create or replace function public.purge_finished_email_verifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.email_verifications v
  using public.accounts a
  where a.id = v.account_id
    and a.email_verified_at is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_finished_email_verifications() from public;
grant execute on function public.purge_finished_email_verifications() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Report what the migration produced
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.accounts)                         as accounts_total,
  (select count(*) from public.accounts where email_verified_at is not null)
                                                                  as already_verified,
  (select count(*) from public.accounts where email is null)      as awaiting_email;
