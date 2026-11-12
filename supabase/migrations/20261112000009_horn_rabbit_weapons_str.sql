-- Samuel, 2026-11-12: Horn Rabbit Weapons are weapons made from the Horned Rabbit's horn,
-- Special grade, got only once, and they give +20 STR (not extra damage on rabbits).
-- Wolf's Scars now also slows attacks, so its description says so.
update public.skill_definitions
set description = 'Special grade. Weapons made from the Horned Rabbit''s horn: you can only get them once. +20 STR.',
    effect = '{"stat_bonus":{"STR":20}}'::jsonb
where id = 'horn_rabbit_weapons';
update public.skill_definitions
set description = 'An aura of old scars: monsters inside it move and attack 30% slower.'
where id = 'wolfs_scars';
