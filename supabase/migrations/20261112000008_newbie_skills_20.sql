-- Newbie skills (Samuel, 2026-11-12): falling 20 times (not 50) to the monster unlocks each one.
-- Horn Rabbit Weapons still also needs 50 Horned Rabbits defeated.
update public.skill_definitions set conditions = '{"counter":"killed_by_green_slime","op":">=","value":20}'::jsonb where id = 'green_slimes_mercy';
update public.skill_definitions set conditions = '{"all":[{"counter":"killed_by_horned_rabbit","op":">=","value":20},{"counter":"defeated_horned_rabbit","op":">=","value":50}]}'::jsonb where id = 'horn_rabbit_weapons';
update public.skill_definitions set conditions = '{"counter":"poison_deaths_bog_toad","op":">=","value":20}'::jsonb where id = 'poison_toad_armour';
update public.skill_definitions set conditions = '{"counter":"killed_by_thorn_wolf","op":">=","value":20}'::jsonb where id = 'wolfs_scars';
