-- Kindred Spirit is switched on: every pet gets one more trait slot (needs a tamer wand in hand).
update public.skill_definitions
set description = 'Every pet gets +1 trait slot. Needs a tamer wand in hand.',
    effect = '{"weapons":["tamer_wand"],"passive":{"kindred_spirit":{"extra_slots":1}}}'::jsonb,
    enabled = true
where id = 'kindred_spirit';
