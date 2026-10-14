-- ============================================================================
-- PHOENIX — PLAYED WITH OWNER badge
-- ----------------------------------------------------------------------------
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Idempotent: safe to re-run. ADDITIVE ONLY - it inserts one catalogue row and
-- touches no table, account, session, grant or game row that already exists.
--
-- WHAT THIS DOES
--   Adds PLAYED WITH OWNER to the badge catalogue so the owner can award it
--   to a player by typing their username (POST /api/badges/award).
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It grants the badge to nobody. Grants are written by the server, after
--     it has verified accounts.role = 'owner' on the caller's session.
--   * It does not make the badge Divine. Divine belongs to THE PHOENIX alone.
--   * It does not change any rule. The Phase 2 triggers still refuse THE
--     PHOENIX to anyone but the owner, and a player may still only feature
--     badges they actually hold.
-- ============================================================================

insert into public.badges (key, name, rarity, description, sort_order)
values (
  'played-with-owner',
  'PLAYED WITH OWNER',
  'legendary',
  'Played a match with the owner of PHOENIX.',
  2
)
on conflict (key) do update
  set name        = excluded.name,
      rarity      = excluded.rarity,
      description = excluded.description,
      sort_order  = excluded.sort_order;

-- Verification: exactly one row for the new badge, and THE PHOENIX is still
-- the only Divine.
--
--   select key, name, rarity, sort_order from public.badges order by sort_order;
--   select count(*) from public.badges where rarity = 'divine';   -- expect 1
--   select count(*) from public.account_badges
--     where badge_key = 'played-with-owner';                      -- expect 0
