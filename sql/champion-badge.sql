-- ============================================================================
-- PHOENIX - MATCH WINNER badge, badge pictures, and every badge for the owner
-- ----------------------------------------------------------------------------
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Idempotent: safe to re-run. ADDITIVE ONLY - it adds one nullable column, one
-- catalogue row, one trigger and one backfill, and drops no table, account,
-- session, badge, grant or game row that already exists.
--
-- WHAT THIS DOES
--   1. badges.icon          a picture for a badge, or none. NULL everywhere
--                           except the new MATCH WINNER badge.
--   2. MATCH WINNER         a COMMON badge, handed to a player the moment they
--                           win an online match. Its picture is Phoenix from
--                           the main menu.
--   3. badges_to_owners     a trigger: the moment ANY badge is added to the
--                           catalogue, every owner account is given it.
--   4. ensure_owner_badge   now grants the WHOLE catalogue, not just THE
--                           PHOENIX - so the owner holds every badge there is.
--   5. a backfill           gives today's owner every badge that exists now.
--
-- WHAT THE OWNER'S ACCESS MEANS
--   THE PHOENIX stays unique, Divine, permanent and locked into slot 1 - none
--   of that changes. What changes is that nothing else is ever out of the
--   owner's reach: PLAYED WITH OWNER, MATCH WINNER, and every badge anyone
--   adds later all land in the collection automatically, so the owner can
--   feature any of them in slots 2 and 3.
--
-- ABOUT badges.icon
--   This column is turned into an <img src> in the browser, so it is held to
--   a pattern that only ever matches a plain file inside assets/ - no
--   slashes, no spaces, no quotes, no scheme, no "..". A picture cannot be
--   turned into markup or pointed at another website, whatever ends up in the
--   table. The server re-checks the same pattern before handing it out.
-- ============================================================================

-- 1) A PICTURE FOR A BADGE ---------------------------------------------------
-- Nullable, so every existing badge is unaffected and keeps rendering as it
-- always has. The check is what makes the column safe to put on a page.
alter table public.badges
  add column if not exists icon text
  constraint badges_icon_path check (
    icon is null or icon ~ '^assets/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$'
  );

-- 2) MATCH WINNER -------------------------------------------------------------
-- COMMON on purpose: this is the badge every player starts their collection
-- with, the first rung of the ladder rather than the top of it.
-- The picture is a close crop of the same photo the main menu shows
-- (assets/phoenix.jpg), cut down to just Phoenix herself - no hide, no dish,
-- no enclosure behind her - because at badge size anything else was the point
-- of the picture rather than the gecko being the point of it.
insert into public.badges (key, name, rarity, description, sort_order, icon)
values (
  'champion',
  'MATCH WINNER',
  'common',
  'Won a match of PHOENIX.',
  3,
  'assets/phoenix-badge.jpg'
)
on conflict (key) do update
  set name        = excluded.name,
      rarity      = excluded.rarity,
      description = excluded.description,
      sort_order  = excluded.sort_order,
      icon        = excluded.icon;

-- 3) EVERY NEW BADGE GOES TO THE OWNER ----------------------------------------
-- "Every badge made" has to hold without anyone remembering to run anything
-- again, so it is the database that hands new badges over, the instant they
-- exist. THE PHOENIX passes through here like any other key and lands on the
-- only account the Phase 2 trigger will allow it to land on.
create or replace function public.grant_badge_to_owners() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.account_badges (account_id, badge_key)
  select id, NEW.key from public.accounts where role = 'owner'
  on conflict (account_id, badge_key) do nothing;
  return NEW;
end;
$$;

drop trigger if exists badges_grant_to_owners on public.badges;
create trigger badges_grant_to_owners
  after insert or update on public.badges
  for each row execute function public.grant_badge_to_owners();

-- 4) THE WHOLE CATALOGUE FOR THE OWNER ----------------------------------------
-- Same name and signature as Phase 2, so the server needs no change: the RPC
-- it already calls now hands over everything rather than one badge. Slot 1 is
-- still re-asserted as THE PHOENIX before anything else, so it can never be
-- left un-seated no matter what the caller sends.
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

  -- THE PHOENIX first, and into slot 1, permanently.
  insert into public.account_badges (account_id, badge_key)
  values (p_account, 'phoenix')
  on conflict (account_id, badge_key) do nothing;

  insert into public.account_featured_badges (account_id, slot, badge_key)
  values (p_account, 1, 'phoenix')
  on conflict (account_id, slot) do update
     set badge_key = excluded.badge_key
   where public.account_featured_badges.badge_key is distinct from excluded.badge_key;

  -- Then everything else that exists: badges other players earned, badges the
  -- owner handed out by hand, and every badge added since. The owner is not
  -- ranked on the leaderboard and is not bound by the award allowlist, so
  -- nothing they might want to show should ever be out of reach.
  insert into public.account_badges (account_id, badge_key)
  select p_account, b.key from public.badges b
  on conflict (account_id, badge_key) do nothing;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already-held');
end;
$$;

-- 5) TODAY'S OWNER GETS EVERYTHING THAT EXISTS NOW ----------------------------
-- The trigger above covers badges added after this runs; this covers the ones
-- that were already in the catalogue before it.
insert into public.account_badges (account_id, badge_key)
select a.id, b.key
  from public.accounts a
  cross join public.badges b
 where a.role = 'owner'
on conflict (account_id, badge_key) do nothing;

-- 6) LOCKDOWN -----------------------------------------------------------------
-- Identical treatment to every other function in the badge system: callable by
-- the server's service role, by nobody else.
revoke all on function public.grant_badge_to_owners() from public, anon, authenticated;
grant  execute on function public.grant_badge_to_owners() to service_role;

-- Verification:
--
--   select key, name, rarity, icon from public.badges order by sort_order;
--                                                  -- champion, common, the photo
--   select count(*) from public.badges where rarity = 'divine';   -- still only 1
--   select b.key from public.badges b
--     join public.account_badges ab on ab.badge_key = b.key
--     join public.accounts a on a.id = ab.account_id
--    where a.role = 'owner' order by b.sort_order;
--                                        -- every badge, THE PHOENIX among them
