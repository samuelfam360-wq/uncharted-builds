-- Pets: the monsters a player has tamed (or a Tamer's first pet), kept on the player record.
alter table public.players add column if not exists pets jsonb not null default '[]'::jsonb;
