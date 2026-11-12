import type { Stats, StatusType } from "../types";

export interface EnemyAttack {
  name: string;
  weight: number;
  multiplier: number;
  element: "physical" | "magic";
  area?: boolean; // cannot be dodged
  piercing?: number; // flat damage that ignores defense
  status?: { type: StatusType; chance: number; turns: number };
}

export interface MonsterDef {
  id: string;
  name: string;
  type: "beast" | "slime" | "poison" | "golem" | "undead";
  isBoss?: boolean;
  stats: Omit<Stats, "MP"> & { MP?: number };
  exp: number;
  gold: number;
  attacks: EnemyAttack[];
  drops: { itemId: string; chance: number }[];
}

const basic = (multiplier = 1): EnemyAttack => ({ name: "Attack", weight: 3, multiplier, element: "physical" });

export const MONSTERS: Record<string, MonsterDef> = {
  green_slime: {
    id: "green_slime",
    name: "Green Slime",
    type: "slime",
    stats: { HP: 40, STR: 9, VIT: 3, AGI: 2, DEX: 5, INT: 2 },
    exp: 8,
    gold: 3,
    attacks: [basic()],
    drops: [{ itemId: "slime_jelly", chance: 0.6 }],
  },
  horned_rabbit: {
    id: "horned_rabbit",
    name: "Horned Rabbit",
    type: "beast",
    stats: { HP: 32, STR: 13, VIT: 2, AGI: 16, DEX: 10, INT: 0 },
    exp: 10,
    gold: 4,
    attacks: [basic(), { name: "Horn Charge", weight: 1, multiplier: 1.4, element: "physical" }],
    drops: [{ itemId: "rabbit_meat", chance: 0.5 }],
  },
  bog_toad: {
    id: "bog_toad",
    name: "Bog Toad",
    type: "poison",
    stats: { HP: 55, STR: 11, VIT: 6, AGI: 5, DEX: 8, INT: 4 },
    exp: 14,
    gold: 5,
    attacks: [
      basic(),
      { name: "Venom Spit", weight: 2, multiplier: 0.6, element: "physical", status: { type: "poison", chance: 0.6, turns: 3 } },
    ],
    drops: [{ itemId: "toad_skin", chance: 0.55 }],
  },
  thorn_wolf: {
    id: "thorn_wolf",
    name: "Thorn Wolf",
    type: "beast",
    stats: { HP: 75, STR: 19, VIT: 7, AGI: 12, DEX: 13, INT: 0 },
    exp: 22,
    gold: 8,
    attacks: [basic(), { name: "Savage Bite", weight: 1, multiplier: 1.5, element: "physical" }],
    drops: [{ itemId: "wolf_meat", chance: 0.5 }, { itemId: "thorn_fur", chance: 0.3 }],
  },
  // Dungeon
  mire_bat: {
    id: "mire_bat",
    name: "Mire Bat",
    type: "poison",
    stats: { HP: 60, STR: 16, VIT: 5, AGI: 22, DEX: 15, INT: 5 },
    exp: 24,
    gold: 8,
    attacks: [basic(), { name: "Screech", weight: 1, multiplier: 0.4, element: "magic", area: true, status: { type: "silence", chance: 0.5, turns: 2 } }],
    drops: [{ itemId: "bat_wing", chance: 0.5 }],
  },
  moss_golem: {
    id: "moss_golem",
    name: "Moss Golem",
    type: "golem",
    stats: { HP: 120, STR: 20, VIT: 12, AGI: 1, DEX: 8, INT: 3 },
    exp: 40,
    gold: 15,
    attacks: [basic(), { name: "Crushing Fist", weight: 1, multiplier: 1.6, element: "physical", status: { type: "slow", chance: 0.5, turns: 3 } }],
    drops: [{ itemId: "golem_moss", chance: 0.6 }],
  },
  mirefang: {
    id: "mirefang",
    name: "Mirefang, Queen of the Hollow",
    type: "poison",
    isBoss: true,
    stats: { HP: 420, STR: 28, VIT: 16, AGI: 9, DEX: 16, INT: 14 },
    exp: 200,
    gold: 80,
    attacks: [
      basic(1.1),
      { name: "Toxic Breath", weight: 2, multiplier: 0.5, element: "magic", area: true, piercing: 6, status: { type: "poison", chance: 0.8, turns: 4 } },
      { name: "Paralyzing Lash", weight: 1, multiplier: 1.2, element: "physical", status: { type: "paralysis", chance: 0.5, turns: 2 } },
    ],
    drops: [{ itemId: "queens_venom_sac", chance: 1 }],
  },
};

export interface ZoneDef {
  id: string;
  name: string;
  kind: "town" | "field" | "dungeon";
  description: string;
  encounters?: { monsterId: string; weight: number }[];
  hazard?: { id: string; name: string; chance: number; damage: number; status?: { type: StatusType; chance: number; turns: number } };
  rooms?: string[]; // dungeon: monsters in order, last is the boss
  uniqueItemId?: string;
}

export const ZONES: Record<string, ZoneDef> = {
  thornvale: {
    id: "thornvale",
    name: "Thornvale",
    kind: "town",
    description: "A quiet town at the edge of the Mirewood. Rest, buy weapons and listen to rumors.",
  },
  mirewood_fields: {
    id: "mirewood_fields",
    name: "Mirewood Fields",
    kind: "field",
    description: "Grassland and forest that sink into poison swamp toward the east.",
    encounters: [
      { monsterId: "green_slime", weight: 4 },
      { monsterId: "horned_rabbit", weight: 3 },
      { monsterId: "bog_toad", weight: 3 },
      { monsterId: "thorn_wolf", weight: 2 },
    ],
    // Some fights happen in the swamp, which hurts every round regardless of stats.
    hazard: { id: "poison_swamp", name: "Poison swamp", chance: 0.35, damage: 4, status: { type: "poison", chance: 0.15, turns: 2 } },
  },
  hollow_of_the_mire: {
    id: "hollow_of_the_mire",
    name: "Hollow of the Mire",
    kind: "dungeon",
    description: "A drowned cave under the swamp. Its queen guards the gate to the next floor.",
    rooms: ["mire_bat", "moss_golem", "mire_bat", "mirefang"],
    uniqueItemId: "thornheart_mantle",
  },
};

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  edible: boolean;
  heal?: number;
  sell: number;
  onEat?: { damage?: number; status?: { type: StatusType; chance: number; turns: number } };
}

export const ITEMS: Record<string, ItemDef> = {
  slime_jelly: { id: "slime_jelly", name: "Slime Jelly", description: "Wobbly. Inedible. Probably.", edible: false, sell: 2, onEat: { damage: 3 } },
  toad_skin: {
    id: "toad_skin",
    name: "Toad Skin",
    description: "Slimy and faintly toxic. Definitely inedible.",
    edible: false,
    sell: 3,
    onEat: { damage: 2, status: { type: "poison", chance: 0.9, turns: 3 } },
  },
  thorn_fur: { id: "thorn_fur", name: "Thorn Fur", description: "Prickly. Inedible.", edible: false, sell: 5, onEat: { damage: 6 } },
  bat_wing: { id: "bat_wing", name: "Bat Wing", description: "Leathery. Inedible.", edible: false, sell: 5, onEat: { damage: 4 } },
  golem_moss: { id: "golem_moss", name: "Golem Moss", description: "Smells like stone. Inedible.", edible: false, sell: 8, onEat: { damage: 5 } },
  queens_venom_sac: {
    id: "queens_venom_sac",
    name: "Queen's Venom Sac",
    description: "Pulsing with poison. Absolutely inedible.",
    edible: false,
    sell: 40,
    onEat: { damage: 20, status: { type: "poison", chance: 1, turns: 5 } },
  },
  rabbit_meat: { id: "rabbit_meat", name: "Rabbit Meat", description: "Restores 30 HP.", edible: true, heal: 30, sell: 3 },
  wolf_meat: { id: "wolf_meat", name: "Wolf Meat", description: "Restores 60 HP.", edible: true, heal: 60, sell: 6 },
};

export const UNIQUE_ITEMS = {
  thornheart_mantle: {
    id: "thornheart_mantle",
    name: "Thornheart Mantle",
    description:
      "Woven from the queen's own thorns. Only the first to clear the Hollow alone, on their first attempt, can claim it. Grows stronger with its owner.",
    statBonus: { VIT: 10, INT: 5 },
    attachedSkills: ["thorn_retort"],
  },
} as const;
