-- Primal Bond is switched on: an ultimate charged by your pet's bites on the boss (needs a tamer wand in hand and a pet out).
update public.skill_definitions
set description = 'Ultimate. Your pet''s hits on a boss charge the gauge (50 / 100 / 200), and your pet turns giant to strike. Needs a tamer wand in hand and your pet out.',
    effect = '{"weapons":["tamer_wand"],"active":{"ultimate":{"gauge":"boss_pet_hits","tiers":[50,100,200]}}}'::jsonb,
    enabled = true
where id = 'primal_bond';
