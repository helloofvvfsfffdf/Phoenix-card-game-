-- ===========================================================================
-- PHOENIX — secure password recovery (separate from email verification)
-- ---------------------------------------------------------------------------
-- Additive and idempotent: safe to run multiple times. Keeps recovery
-- bookkeeping entirely separate from the verification ledger so a
-- verification code never works as a reset code, and vice-versa.
-- ===========================================================================

create table if not exists public.password_resets (
  account_id     uuid primary key references public.accounts(id) on delete cascade,
  email          text not null,
  code_hash      text not null,          -- sha256 of the 6-digit code; never plaintext
  requested_at   timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '10 minutes',
  resend_after   timestamptz not null default now() + interval '60 seconds',
  attempts       integer not null default 0,
  sent_count     integer not null default 1,
  window_started timestamptz not null default now(),
  requested_ip   inet,
  used_at        timestamptz             -- populated once, marks code consumed
);

-- Rate-limit bookkeeping (same shape as email_verifications, independent)
create index if not exists password_resets_expires on public.password_resets (expires_at);
create index if not exists password_resets_used on public.password_resets (used_at) where used_at is not null;

-- Lock down: only the service role may touch this.
alter table public.password_resets enable row level security;
revoke all on public.password_resets from anon, public;
grant select, insert, update, delete on public.password_resets to service_role;

-- Shape: email must look like an address.
alter table public.password_resets
  add constraint if not exists password_resets_email_shape
  check (char_length(email) between 5 and 254 and position('@' in email) > 1);
