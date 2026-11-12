// Pets: wild monsters you tame (or a Tamer's first pet). A pet fights beside you,
// levels up from the fights it's out for, and you place its stat points like your own.
// Pets live on the player record (players.pets).

import { CLASSES } from "./data/classes";
import { MONSTERS, ZONES } from "./data/world";
import { POINTS_PER_LEVEL, expToNext } from "./constants";
import { GameError } from "./character";
import type { Attacker } from "./live";
import type { Pet, Player } from "./types";

/** Stats a pet can put points into (monsters have no MP). */
export const PET_STATS = ["HP", "STR", "VIT", "AGI", "DEX", "INT"] as const;
export type PetStat = (typeof PET_STATS)[number];

export const PET_LEVEL_CAP = 100;
/** A wild monster can be tamed once it's below this share of its HP. */
export const TAME_HP_SHARE = 0.3;
/** A pet attacks this often (milliseconds). */
export const PET_ATTACK_MS = 1000;
/** Pet points: from kills made while the pet is out. They will switch on pet skills. */
export const PET_POINTS = { kill: 1, boss: 10 } as const;
/** Each stat can grow to this many times the species' own number (bosses differ: see below). */
export const PET_CAP_MULT = 5;
/** A boss pet grows up to this share of the real boss's stats... */
export const BOSS_PET_CAP = 0.5;
/** ...starting from this share as a level 1 baby. */
export const BOSS_PET_START = 0.1;

/** Boss eggs: beat the boss alone within this time to get its egg (once per boss). */
export const BOSS_EGG_MS = 5 * 60_000;
/** Mirefang's Egg hatches after this much time carried through the poison swamp... */
export const EGG_SWAMP_MS = 10 * 60_000;
/** ...for someone with at least this Taming mastery level. */
export const EGG_TAMING_LEVEL = 2;
/** The bosses that leave an egg, and its name. */
export const BOSS_EGGS: Record<string, { name: string; hatchText: string }> = {
  mirefang: { name: "Mirefang's Egg", hatchText: "Carry it through the poison swamp for 10 minutes in total" },
};
export const eggKey = (boss: string) => `egg_${boss}`; // 1 while you carry it
export const eggGotKey = (boss: string) => `egg_got_${boss}`; // 1 once you've ever had it
export const eggSwampKey = (boss: string) => `egg_swamp_${boss}`; // ms carried through the swamp

/** Monsters that can be tamed: every one that isn't a boss. */
export const TAMEABLE = Object.values(MONSTERS)
  .filter((m) => !m.isBoss)
  .map((m) => m.id);

/** A new Tamer picks one of these as a level 1 first pet: the Mirewood Fields monsters. */
export const FIRST_PET_CHOICES = (ZONES.mirewood_fields.encounters ?? []).map((e) => e.monsterId);

/** Each species' hidden taming condition, met during the fight (checked by the game in the browser). */
export const TAME_CONDITIONS: Record<string, { text: string; goal: number }> = {
  green_slime: { text: "Eat something from your bag while it's next to you", goal: 1 },
  horned_rabbit: { text: "Dodge its Horn Charge 3 times in a row", goal: 3 },
  bog_toad: { text: "Get poisoned by its Venom Spit while standing in the swamp", goal: 1 },
  thorn_wolf: { text: "Fight it one-on-one with only the tamer wand and no food", goal: 1 },
  mire_bat: { text: "Tame it while its Screech has you silenced", goal: 1 },
  moss_golem: { text: "Block 10 of its Crushing Fists in one fight", goal: 10 },
};

/** A bred mixed monster's species is its parent species joined with "+": these are the parts. */
export const speciesParts = (species: string) => species.split("+");
export const isBreed = (species: string) => species.includes("+");

export function speciesName(species: string) {
  return speciesParts(species)
    .map((s) => MONSTERS[s]?.name ?? s)
    .join(" × ");
}

/** The breed two pets make: every species in both, once each, in a fixed order. */
export function breedSpecies(a: string, b: string): string {
  return [...new Set([...speciesParts(a), ...speciesParts(b)])].sort().join("+");
}

export function newPet(species: string, id: string, now = new Date()): Pet {
  if (!speciesParts(species).every((s) => MONSTERS[s])) throw new GameError("Unknown monster");
  return {
    id,
    species,
    level: 1,
    exp: 0,
    freePoints: 0,
    stats: { HP: 0, STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0 },
    petPoints: 0,
    kills: 0,
    active: false,
    tamedAt: now.toISOString(),
  };
}

/** A level 1 pet's own numbers: the species' stats (a boss baby starts at a share of the boss's). */
export function petBase(species: string): Record<PetStat, number> {
  const m = MONSTERS[species];
  const out = {} as Record<PetStat, number>;
  for (const k of PET_STATS) {
    const v = m?.stats[k] ?? 0;
    out[k] = m?.isBoss ? Math.max(k === "HP" ? 1 : 0, Math.round(v * BOSS_PET_START)) : v;
  }
  if (!m) out.HP = 1;
  return out;
}

/** The most a stat can reach for this species. */
export function petCap(species: string, stat: PetStat): number {
  const m = MONSTERS[species];
  const v = m?.stats[stat] ?? 0;
  if (m?.isBoss) return Math.floor(v * BOSS_PET_CAP);
  return Math.max(10, v * PET_CAP_MULT);
}

/** This pet's level 1 numbers: its own if it was bred, else its species'. */
export const baseOf = (p: Pet): Record<PetStat, number> => p.base ?? petBase(p.species);
/** The most this pet's stat can reach: its own cap if it was bred, else its species'. */
export const capOf = (p: Pet, k: PetStat) => p.caps?.[k] ?? petCap(p.species, k);

/** Your stats that Shared Glory lends to the pet that's out. */
export interface Glory {
  stats: Record<string, number>;
  share: number;
}

/** A pet's stats: its own numbers plus the points you placed (plus Shared Glory's share of yours, past the cap). */
export function petStats(p: Pet, glory?: Glory | null): Record<PetStat, number> {
  const base = baseOf(p);
  const out = {} as Record<PetStat, number>;
  for (const k of PET_STATS) {
    out[k] = Math.min(capOf(p, k), (base[k] ?? 0) + (p.stats[k] ?? 0));
    if (glory && p.active) out[k] += Math.floor((glory.stats[k] ?? 0) * glory.share);
  }
  return out;
}

/** How a pet fights: bare-handed, with STR, like the monster it is. */
export function petAttacker(p: Pet, glory?: Glory | null): Attacker {
  return attackerFromPetStats(petStats(p, glory));
}

/** The same, from the stats the browser gets. */
export function attackerFromPetStats(s: Record<PetStat, number>): Attacker {
  return { stats: { HP: s.HP, MP: 0, STR: s.STR, VIT: s.VIT, AGI: s.AGI, DEX: s.DEX, INT: s.INT }, passive: { damage_multiplier: 1 } };
}

export const activePet = (player: Player): Pet | null => player.pets.find((p) => p.active) ?? null;

/** EXP for the pet that's out. Returns the levels it gained. */
export function grantPetExp(p: Pet, exp: number): number {
  let gained = 0;
  p.exp += exp;
  while (p.level < PET_LEVEL_CAP && p.exp >= expToNext(p.level)) {
    p.exp -= expToNext(p.level);
    p.level++;
    p.freePoints += POINTS_PER_LEVEL;
    gained++;
  }
  if (p.level >= PET_LEVEL_CAP) p.exp = 0;
  return gained;
}

/** Spend a pet's free points. Points past a stat's cap are refused. */
export function addPetPoints(p: Pet, alloc: Partial<Record<string, number>>) {
  let total = 0;
  const next = { ...p.stats };
  for (const [k, v] of Object.entries(alloc)) {
    if (!(PET_STATS as readonly string[]).includes(k)) throw new GameError("Unknown stat");
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) throw new GameError("Points must be whole numbers");
    const stat = k as PetStat;
    const base = baseOf(p)[stat];
    if (base + next[stat] + n > capOf(p, stat)) throw new GameError(`${stat} can't go past ${capOf(p, stat)} for this ${speciesName(p.species)}`);
    next[stat] += n;
    total += n;
  }
  if (total > p.freePoints) throw new GameError(`Your pet only has ${p.freePoints} points to spend`);
  p.stats = next;
  p.freePoints -= total;
}

/** A Tamer with no pets yet may pick a first one. */
export function canChooseFirstPet(player: Player) {
  return CLASSES[player.classId]?.weapon === "tamer_wand" && player.pets.length === 0;
}

export function publicPet(p: Pet, glory?: Glory | null) {
  const s = petStats(p, glory);
  return {
    id: p.id,
    species: p.species,
    name: speciesName(p.species),
    level: p.level,
    exp: p.exp,
    expToNext: p.level >= PET_LEVEL_CAP ? 0 : expToNext(p.level),
    freePoints: p.freePoints,
    stats: s,
    caps: Object.fromEntries(PET_STATS.map((k) => [k, capOf(p, k)])) as Record<PetStat, number>,
    parents: p.parents ? p.parents.map(speciesName) : null,
    bred: isBreed(p.species),
    petPoints: p.petPoints,
    kills: p.kills,
    active: p.active,
  };
}


// ---------- breeding ----------

/** Both parents must be at least this level. */
export const BREED_LEVEL = 50;
/** Breeding (like hatching) needs this Taming mastery level. */
export const BREED_TAMING_LEVEL = 2;
/** A bred baby starts with this many points to place. */
export const BREED_BONUS_POINTS = 10;

/**
 * Breed two pets. The parents stay. The baby is a new mixed monster made of both
 * parents (it looks like both), level 1, starting from the average of both
 * parents' stats and able to grow to the higher parent's cap in each stat.
 */
export function breed(a: Pet, b: Pet, id: string, now = new Date()): Pet {
  if (a.id === b.id) throw new GameError("Pick two different pets");
  if (a.level < BREED_LEVEL || b.level < BREED_LEVEL) throw new GameError(`Both pets must be level ${BREED_LEVEL} to breed`);
  const species = breedSpecies(a.species, b.species);
  const sa = petStats(a);
  const sb = petStats(b);
  const caps = {} as Record<PetStat, number>;
  const base = {} as Record<PetStat, number>;
  for (const k of PET_STATS) {
    caps[k] = Math.max(capOf(a, k), capOf(b, k));
    base[k] = Math.min(caps[k], Math.floor((sa[k] + sb[k]) / 2));
  }
  base.HP = Math.max(1, base.HP);
  const baby = newPet(species, id, now);
  baby.base = base;
  baby.caps = caps;
  baby.parents = [a.species, b.species];
  baby.freePoints = BREED_BONUS_POINTS;
  return baby;
}
