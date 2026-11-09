# Uncharted Builds

A browser RPG where the game watches how you play and rewards your habits with hidden skills. No classes, no skill trees.

This is the **Phase 1 prototype** from the design doc: single player, stats and combat, 20 hidden skills, one field, one dungeon with a boss, one unique item, and an admin page for editing skill conditions.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase settings the game uses an in-memory store, so it works with zero setup (data resets when the server restarts). The admin page is at `/admin`; the local dev password is `admin`.

## Connect Supabase

1. Create a Supabase project for the game.
2. Apply the migrations in `supabase/migrations/` (Supabase CLI: `supabase link` then `supabase db push`, or paste them into the SQL editor in order).
3. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only, never exposed to the browser)
   - `ADMIN_PASSWORD` (required in production for `/admin`)

All tables have row level security on with no public policies. The browser never talks to Supabase directly: every action goes through Next.js API routes, which resolve combat on the server, so players can't fake counters or damage.

## How it fits together

| Piece | Where |
| --- | --- |
| Tables, atomic counter updates, server-first claims | `supabase/migrations/` |
| Skill rule engine (`all` / `any` / `not` conditions) | `src/lib/game/rules.ts` |
| Starter skills (seed data) | `src/lib/game/data/skills.ts` → `npm run seed:sql` |
| Monsters, zones, items | `src/lib/game/data/world.ts` |
| Damage formula, hit/evasion, statuses, hazards | `src/lib/game/combat.ts` |
| Character creation, derived stats, locks, slots | `src/lib/game/character.ts` |
| Action → combat → counters → unlocks pipeline | `src/lib/game/service.ts` |
| Counter keys | `src/lib/game/counters.ts` |
| Admin validation schema | `src/lib/game/schema.ts` |

Skills live as data in `skill_definitions`. Editing them on `/admin` changes future unlocks immediately; players who already own a skill keep it.

### Condition leaves

```json
{ "counter": "damage_blocked", "op": ">=", "value": 5000 }
{ "stat": "STR", "op": "==", "value": 0 }
{ "player": "level", "op": "<=", "value": 5 }
{ "battle": "attacks_made", "op": "==", "value": 0 }
{ "skill": "poison_resistance" }
{ "zone": "mirewood_fields" }
```

`stat` checks the points the player spent, so "STR equals 0" means they never invested in STR.

## Tuning numbers (open questions from the doc)

All in `src/lib/game/constants.ts`: 30 starting points, 5 points per level, +10 HP and +5 MP per point. Ghost Step's condition is lowered from 1,000 to 100 dodges in a row for the prototype; raise it on `/admin` once fights are faster.

## Checks

```bash
npm test          # rule engine, combat formula, full play-throughs
npm run typecheck
npm run lint
```
