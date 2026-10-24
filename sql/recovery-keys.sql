-- PHOENIX — recovery-key table (new, separate from password_resets / email_verifications)
CREATE TABLE IF NOT EXISTS public.recovery_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_recovery_keys_account ON public.recovery_keys(account_id);

-- Note: only the hash is stored. The plain 24-letter key is never persisted.
-- Migration: existing accounts create their first key after signing in.
