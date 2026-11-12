-- Pack Leader is switched on: one more pet can be out at once (needs a tamer wand in hand).
update public.skill_definitions
set effect = '{"weapons":["tamer_wand"],"passive":{"pack_leader":{"extra":1}}}'::jsonb,
    enabled = true
where id = 'pack_leader';
