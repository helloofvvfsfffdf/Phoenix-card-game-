-- ===========================================================================
-- PHOENIX - the server's own switches, kept across a restart
-- ---------------------------------------------------------------------------
-- Run this ONE file in the Supabase SQL Editor. It is additive and idempotent:
-- every statement checks first, so running it twice is harmless, and it never
-- touches a player's account, a badge, a score or a message.
--
-- What it does:
--   * creates a single-row table holding the two switches the owner controls
--     on the dashboard: is multiplayer open, and is lobby creation locked;
--   * locks the table away from the public anon key and from ordinary users
--     with Row Level Security, so only the service-role key (the server) can
--     read or write it.
--
-- Why it exists. The switches used to live in a file on the server's own
-- disk. A Render free instance throws that disk away on every deploy and
-- every spin-down, so a server that had been quiet for a while came back up
-- with its switches reset and the first player to arrive was told
-- "multiplayer is closed". With this table the owner's last choice survives
-- the restart, and a server with no row at all starts OPEN.
--
-- There is exactly one row, with the key 'singleton'. The two booleans are
-- all this table ever holds.
-- ===========================================================================

create table if not exists public.phoenix_server_state (
  key             text primary key,
  multiplayer_open boolean not null default true,
  creation_locked  boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- The starting row. A fresh server reads this and comes up OPEN.
insert into public.phoenix_server_state (key, multiplayer_open, creation_locked)
values ('singleton', true, false)
on conflict (key) do nothing;

-- Keep the moment of the last change honest, whatever wrote the row.
create or replace function public.phoenix_server_state_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists phoenix_server_state_touch on public.phoenix_server_state;
create trigger phoenix_server_state_touch
  before update on public.phoenix_server_state
  for each row execute function public.phoenix_server_state_touch();

-- Lock the table away from the browser. The anon key must never be able to
-- open the server or lock it: only the server's service-role key can.
alter table public.phoenix_server_state enable row level security;

revoke all on public.phoenix_server_state from anon, public;
grant select, insert, update, delete on public.phoenix_server_state to service_role;

drop policy if exists phoenix_server_state_owner_read on public.phoenix_server_state;

-- Report what the migration produced.
select
  (select multiplayer_open from public.phoenix_server_state where key = 'singleton')
                                                                as multiplayer_open,
  (select creation_locked from public.phoenix_server_state where key = 'singleton')
                                                                as creation_locked;
