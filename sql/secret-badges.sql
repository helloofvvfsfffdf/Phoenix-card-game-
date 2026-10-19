-- ============================================================================
-- PHOENIX — Secret badges: 8 new achievement badges
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY. No existing table, account, session or game row is dropped,
-- truncated or rewritten.
--
-- WHAT THIS CREATES
--   8 new rows in `badges` (secret achievement badges)
--   account_achievement_progress  (multi-match progress tracking)
--
-- SECRECY: secret badges are NOT returned by the public catalogue endpoint
-- until the player has earned them. The `secret` column controls visibility.
-- ============================================================================

-- 1) Add `secret` column to badges (idempotent)
alter table public.badges
  add column if not exists secret boolean not null default false;

-- 2) Seed the 8 secret achievement badges
insert into public.badges (key, name, rarity, description, sort_order, secret)
values
  ('lucky-six', 'Lucky Six', 'rare', 'Win a Dice Challenge by rolling a 6.', 100, true),
  ('mind-reader', 'Mind Reader', 'epic', 'Win three Rock Paper Scissors challenges.', 101, true),
  ('backstabber', 'Backstabber', 'epic', 'Successfully steal 20,000 points in Betrayal.', 102, true),
  ('lightning-reflexes', 'Lightning Reflexes', 'rare', 'Win a Speed Challenge with a reaction time below 400ms.', 103, true),
  ('jackpot', 'Jackpot!', 'legendary', 'Land on the +10,000 outcome in Wheel of Fortune.', 104, true),
  ('partners-in-crime', 'Partners in Crime', 'rare', 'Receive at least 10,000 bonus points through Linked Fate.', 105, true),
  ('master-of-disguise', 'Master of Disguise', 'legendary', 'Win as the Impostor without being caught.', 106, true),
  ('identity-crisis', 'Identity Crisis', 'epic', 'Swap allies three times across matches.', 107, true)
on conflict (key) do update
  set name        = excluded.name,
      rarity      = excluded.rarity,
      description = excluded.description,
      sort_order  = excluded.sort_order,
      secret      = excluded.secret;

-- 3) Achievement progress tracking (multi-match)
create table if not exists public.account_achievement_progress (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  achievement_key text not null,
  progress    int  not null default 0,
  target      int  not null default 1,
  completed   boolean not null default false,
  updated_at  timestamptz not null default now(),

  primary key (account_id, achievement_key)
);

alter table public.account_achievement_progress enable row level security;
revoke all on public.account_achievement_progress from anon, authenticated;

-- 4) Auto-unlock all badges for owner account
-- (handled by ensure_owner_badge RPC extension below)

-- 5) Extend ensure_owner_badge to grant ALL badges to owner
create or replace function public.ensure_owner_badge(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_key  text;
begin
  select role into v_role from public.accounts where id = p_account;
  if not found or v_role <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'not-owner');
  end if;

  -- Grant every badge in the catalogue to the owner (including future ones)
  for v_key in select key from public.badges loop
    insert into public.account_badges (account_id, badge_key)
    values (p_account, v_key)
    on conflict (account_id, badge_key) do nothing;
  end loop;

  -- Slot 1 belongs to THE PHOENIX for the owner, permanently.
  insert into public.account_featured_badges (account_id, slot, badge_key)
  values (p_account, 1, 'phoenix')
  on conflict (account_id, slot) do update
     set badge_key = excluded.badge_key
   where public.account_featured_badges.badge_key is distinct from excluded.badge_key;

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already-held');
end;
$$;

grant execute on function public.ensure_owner_badge(uuid) to service_role;
