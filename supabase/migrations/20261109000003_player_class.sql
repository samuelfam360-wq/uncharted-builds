-- Starting classes (12 incl. Free Class) and self-customised appearance.
-- appearance now holds JSON text such as {"gender":"Female","hairColor":"Red",...};
-- older rows keep their plain label and the game falls back to default looks.
alter table public.players
  add column if not exists class_id text not null default 'free'
  check (class_id in ('swordsman','mage','assassin','tanker','ranger','gunslinger','tamer','lancer','saint','blacksmith','monk','free'));
