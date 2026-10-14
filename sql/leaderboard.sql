-- ============================================================================
-- PHOENIX - wins and the leaderboard
-- ----------------------------------------------------------------------------
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Idempotent: safe to re-run. ADDITIVE ONLY - it creates one table and one
-- index, and drops no table, account, session, badge, announcement or game row.
--
-- WHAT THIS CREATES
--   match_wins        one row per MATCH WON by one player
--   match_wins_account    index for reading a player's total
--
-- HOW A WIN IS COUNTED
--   The server writes a row when a match finishes, naming the match by an id
--   minted when that match started. The primary key is (match_id, account_id),
--   so a match that gets reported twice - a retry, a second broadcast, a
--   reconnect - still counts exactly once. The win totals are counted from
--   these rows when the leaderboard is read, so there is no separate running
--   total that can drift out of step with the matches that actually happened.
--
-- WHO IS RANKED
--   PLAYERS ONLY. The owner is never on the leaderboard, and wins are never
--   written for an owner account: js/wins.js refuses them here, and the
--   leaderboard itself filters on accounts.role = 'player' in both the query
--   and in its pure ranking rule, so the owner cannot appear whichever way the
--   data arrives.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It grants no access to anon or authenticated. As in Phases 1 and 2 the
--     browser only ever reaches these rows through the Node server, which uses
--     the service-role key that never leaves the server.
--   * It never deletes. A loss is not stored, so nothing can be subtracted,
--     and no win is ever removed behind a player's back.
-- ============================================================================

create table if not exists public.match_wins (
  match_id   text not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),

  -- One win, per match, per player. This is what makes counting a match twice
  -- impossible rather than merely unlikely.
  primary key (match_id, account_id)
);

create index if not exists match_wins_account
  on public.match_wins (account_id);

-- 1) LOCKDOWN ----------------------------------------------------------------
-- Nothing is ever readable or writable from the browser. Totals are computed
-- by the server and returned as plain ranks and numbers.
alter table public.match_wins enable row level security;

revoke all on public.match_wins from anon, authenticated;
revoke truncate on public.match_wins from public, anon, authenticated;

-- Verification: no rows yet.
--
--   select count(*) from public.match_wins;                      -- expect 0
