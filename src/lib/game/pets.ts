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
/** Each stat can grow to this many times the species' own number (bosses differ, later). */
export const PET_CAP_MULT = 5;

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

export function speciesName(species: string) {
  return MONSTERS[species]?.name ?? species;
}

export function newPet(species: string, id: string, now = new Date()): Pet {
  if (!MONSTERS[species]) throw new GameError("Unknown monster");
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

/** The most a stat can reach for this species. */
export function petCap(species: string, stat: PetStat): number {
  const base = MONSTERS[species]?.stats[stat] ?? 0;
  return Math.max(10, base * PET_CAP_MULT);
}

/** A pet's stats: its species' own numbers plus the points you placed. */
export function petStats(p: Pet): Record<PetStat, number> {
  const base = MONSTERS[p.species]?.stats ?? { HP: 1, STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0 };
  const out = {} as Record<PetStat, number>;
  for (const k of PET_STATS) out[k] = Math.min(petCap(p.species, k), (base[k] ?? 0) + (p.stats[k] ?? 0));
  return out;
}

/** How a pet fights: bare-handed, with STR, like the monster it is. */
export function petAttacker(p: Pet): Attacker {
  return attackerFromPetStats(petStats(p));
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
    const base = MONSTERS[p.species]?.stats[stat] ?? 0;
    if (base + next[stat] + n > petCap(p.species, stat)) throw new GameError(`${stat} can't go past ${petCap(p.species, stat)} for a ${speciesName(p.species)}`);
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

export function publicPet(p: Pet) {
  const s = petStats(p);
  return {
    id: p.id,
    species: p.species,
    name: speciesName(p.species),
    level: p.level,
    exp: p.exp,
    expToNext: p.level >= PET_LEVEL_CAP ? 0 : expToNext(p.level),
    freePoints: p.freePoints,
    stats: s,
    caps: Object.fromEntries(PET_STATS.map((k) => [k, petCap(p.species, k)])) as Record<PetStat, number>,
    petPoints: p.petPoints,
    kills: p.kills,
    active: p.active,
  };
}

