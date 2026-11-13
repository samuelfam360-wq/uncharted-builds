-- Samuel, 2026-11-13: the Horn Rabbit weapon is a real weapon you equip, not a skill.
-- You get one, once: the horn version of the weapon in your hand when you earn it.
alter table public.players add column if not exists horn_weapon text;
alter table public.players add column if not exists horn_equipped boolean not null default false;

-- The old skill row stays only as the record that it was earned: no effect, never in a skill slot.
update public.skill_definitions
set description = 'Special grade. A weapon made from the Horned Rabbit''s horn: you can only ever get one. +20 STR while it is equipped.',
    effect = '{}'::jsonb
where id = 'horn_rabbit_weapons';
update public.player_skills set equipped = false where skill_id = 'horn_rabbit_weapons';
