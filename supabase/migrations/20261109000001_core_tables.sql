-- Uncharted Builds, Phase 1 core tables.
-- All game logic runs in Next.js API routes with the service role key, so every
-- table has RLS on and no public policies: browsers can never read hidden skill
-- conditions or write counters directly.

create extension if not exists pgcrypto;

-- ---------- Players ----------
create table public.players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                       -- Supabase auth user, used from Phase 3 (accounts)
  name text not null check (char_length(name) between 2 and 20),
  appearance text not null default 'wanderer',
  level int not null default 1 check (level >= 1),
  exp int not null default 0 check (exp >= 0),
  free_points int not null default 0 check (free_points >= 0),
  gold int not null default 0 check (gold >= 0),
  weapon text not null,
  owned_weapons text[] not null default '{}',
  current_hp int not null default 0,
  current_mp int not null default 0,
  dungeon_attempts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index players_user_id_idx on public.players (user_id);

create table public.player_stats (
  player_id uuid primary key references public.players (id) on delete cascade,
  hp int not null default 0 check (hp >= 0),
  mp int not null default 0 check (mp >= 0),
  str int not null default 0 check (str >= 0),
  vit int not null default 0 check (vit >= 0),
  agi int not null default 0 check (agi >= 0),
  dex int not null default 0 check (dex >= 0),
  int int not null default 0 check (int >= 0),
  locked_stats text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- One row per player per counter key, with a running total.
create table public.player_counters (
  player_id uuid not null references public.players (id) on delete cascade,
  key text not null,
  value bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, key)
);

-- ---------- Skills live as data ----------
create table public.skill_definitions (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  name text not null,
  description text not null default '',
  kind text not null check (kind in ('active', 'passive')),
  hidden boolean not null default true,
  conditions jsonb not null,
  effect jsonb not null default '{}'::jsonb,
  locks text[] not null default '{}',
  owner_limit int check (owner_limit is null or owner_limit >= 1), -- 1 = server-first
  evolves_from text references public.skill_definitions (id),
  excludes text[] not null default '{}',
  uses_per_battle int,
  rumor text,
  enabled boolean not null default true,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table public.player_skills (
  player_id uuid not null references public.players (id) on delete cascade,
  skill_id text not null references public.skill_definitions (id),
  status text not null default 'owned' check (status in ('owned', 'offered', 'declined')),
  equipped boolean not null default false,
  stage int not null default 1,
  evolved_into text references public.skill_definitions (id),
  unlocked_at timestamptz not null default now(),
  primary key (player_id, skill_id)
);
create index player_skills_skill_idx on public.player_skills (skill_id) where status = 'owned';

-- Every unlock is logged for the admin dashboard.
create table public.skill_unlock_log (
  id bigserial primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  skill_id text not null references public.skill_definitions (id),
  status text not null,
  created_at timestamptz not null default now()
);
create index skill_unlock_log_created_idx on public.skill_unlock_log (created_at desc);

-- ---------- Items ----------
-- Common items and drops (definitions live in code for Phase 1).
create table public.items (
  player_id uuid not null references public.players (id) on delete cascade,
  item_id text not null,
  qty int not null default 0 check (qty >= 0),
  primary key (player_id, item_id)
);

-- One of a kind on the whole server.
create table public.unique_items (
  id text primary key,
  name text not null,
  description text not null default '',
  owner_id uuid references public.players (id) on delete set null,
  level int not null default 1,
  exp int not null default 0,
  stat_bonus jsonb not null default '{}'::jsonb,
  attached_skills text[] not null default '{}',
  equipped boolean not null default true,
  claimed_at timestamptz
);

-- ---------- Battles (server-authoritative state) ----------
create table public.battles (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  state jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index battles_one_active_per_player on public.battles (player_id) where active;

-- ---------- RLS: locked down, server only ----------
alter table public.players enable row level security;
alter table public.player_stats enable row level security;
alter table public.player_counters enable row level security;
alter table public.skill_definitions enable row level security;
alter table public.player_skills enable row level security;
alter table public.skill_unlock_log enable row level security;
alter table public.items enable row level security;
alter table public.unique_items enable row level security;
alter table public.battles enable row level security;

-- ---------- Atomic helpers ----------

-- Apply a batch of counter changes: {"key": {"op": "inc"|"set"|"max", "value": n}}.
-- Returns the player's full counter map afterwards.
create or replace function public.apply_counters(p_player uuid, p_deltas jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  k text;
  d jsonb;
  result jsonb;
begin
  for k, d in select * from jsonb_each(p_deltas) loop
    insert into player_counters as pc (player_id, key, value)
    values (p_player, k, (d->>'value')::bigint)
    on conflict (player_id, key) do update set
      value = case d->>'op'
        when 'inc' then pc.value + (d->>'value')::bigint
        when 'set' then (d->>'value')::bigint
        when 'max' then greatest(pc.value, (d->>'value')::bigint)
        else pc.value
      end,
      updated_at = now();
  end loop;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into result
  from player_counters where player_id = p_player;
  return result;
end;
$$;

-- Grant (or offer) a skill. Skills with an owner_limit are claimed under a lock,
-- so a server-first skill can only ever go to one player.
create or replace function public.grant_skill(
  p_player uuid,
  p_skill text,
  p_status text,
  p_equipped boolean,
  p_stage int,
  p_evolves_from text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  lim int;
  taken int;
begin
  select owner_limit into lim from skill_definitions where id = p_skill for update;
  if not found then
    return false;
  end if;
  if lim is not null then
    select count(*) into taken from player_skills
    where skill_id = p_skill and status in ('owned', 'offered') and player_id <> p_player;
    if taken >= lim then
      return false;
    end if;
  end if;

  insert into player_skills (player_id, skill_id, status, equipped, stage)
  values (p_player, p_skill, p_status, p_equipped, p_stage)
  on conflict (player_id, skill_id) do update
    set status = excluded.status, equipped = excluded.equipped, stage = excluded.stage, unlocked_at = now();

  if p_evolves_from is not null and p_status = 'owned' then
    update player_skills set evolved_into = p_skill, equipped = false
    where player_id = p_player and skill_id = p_evolves_from;
  end if;

  insert into skill_unlock_log (player_id, skill_id, status) values (p_player, p_skill, p_status);
  return true;
end;
$$;

-- Server-first claim of a unique item. Only the first caller wins.
create or replace function public.claim_unique_item(p_item text, p_player uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  claimed int;
begin
  update unique_items set owner_id = p_player, claimed_at = now()
  where id = p_item and owner_id is null and claimed_at is null;
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;

-- Admin stats: owners per skill.
create or replace view public.skill_ownership_stats
with (security_invoker = true) as
select d.id as skill_id, d.name,
  count(ps.player_id) filter (where ps.status = 'owned') as owners,
  count(ps.player_id) filter (where ps.status = 'offered') as pending_offers,
  max(ps.unlocked_at) as last_unlocked_at
from skill_definitions d
left join player_skills ps on ps.skill_id = d.id
group by d.id, d.name;

revoke all on function public.apply_counters(uuid, jsonb) from public;
revoke all on function public.grant_skill(uuid, text, text, boolean, int, text) from public;
revoke all on function public.claim_unique_item(text, uuid) from public;
grant execute on function public.apply_counters(uuid, jsonb) to service_role;
grant execute on function public.grant_skill(uuid, text, text, boolean, int, text) to service_role;
grant execute on function public.claim_unique_item(text, uuid) to service_role;
