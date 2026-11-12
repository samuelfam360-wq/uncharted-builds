-- Breeds: every new mixed monster made by breeding two pets, kept track of for the whole server.
create table if not exists public.breeds (
  id text primary key,                 -- the parent species, sorted and joined with "+"
  parts text[] not null,
  first_bred_by uuid references public.players(id) on delete set null,
  first_bred_at timestamptz not null default now(),
  times_bred int not null default 1
);
alter table public.breeds enable row level security;

-- Record one breeding. Returns whether this breed is new to the world, and how many times it's been bred.
create or replace function public.record_breed(p_id text, p_parts text[], p_player uuid)
returns table (is_new boolean, times int)
language plpgsql
set search_path = public
as $$
begin
  insert into breeds (id, parts, first_bred_by) values (p_id, p_parts, p_player)
  on conflict (id) do update set times_bred = breeds.times_bred + 1;
  return query select b.times_bred = 1, b.times_bred from breeds b where b.id = p_id;
end;
$$;

revoke all on function public.record_breed(text, text[], uuid) from public, anon, authenticated;
grant execute on function public.record_breed(text, text[], uuid) to service_role;
