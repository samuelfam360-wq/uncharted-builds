// 3D maps for World 1. Same places, people, monsters, doors and portals as the
// side-view maps (sidemaps.ts), laid out on open ground you can walk around.
//
// Units are tiles (64 world units each). x runs east, z runs south. The ground is
// flat (y = 0); trees, rocks and buildings block you, the poison swamp hurts.
// Zone ids and names come from world.ts and are unchanged.

import type { NpcDef } from "./sidemaps";

export const TILE3 = 64;

export type Map3DId = "thornvale" | "mirewood_fields" | "hollow_of_the_mire";

export interface Building3D {
  kind: "inn" | "shop" | "house";
  x: number; // west edge
  z: number; // north edge
  w: number;
  d: number;
  h: number; // wall height, tiles
  doorX: number; // the door sits on the south wall at this x
}

export interface Npc3D {
  id: string;
  x: number;
  z: number;
  /** body: the animated 3D body (see BODY_OPTIONS). */
  look: NpcDef["look"] & { body?: string };
  talk: "rumors";
}

export interface Portal3D {
  x: number;
  z: number;
  to: Map3DId | null; // null = the dungeon exit that appears after the boss
  toX: number;
  toZ: number;
  label: string;
  kind: "walk" | "cave" | "dungeon_exit";
}

export interface Sign3D {
  x: number;
  z: number;
  zoneId: string;
}

export interface Spawn3D {
  monsterId: string;
  x: number;
  z: number;
  /** How far from its spot it wanders and chases (tiles). */
  roam?: number;
}

/** Dungeon rooms run west to east: the monster appears when you step in, the gate opens when it falls. */
export interface Room3D {
  x0: number;
  x1: number;
  spawnX: number;
  spawnZ: number;
  gateX: number | null; // the gate across the corridor on the room's east side
}

export type DecorKind = "tree" | "pine" | "bush" | "rock" | "flower" | "mushroom" | "fence" | "torch" | "reed" | "lamp" | "crystal" | "well";

export interface Decor3D {
  kind: DecorKind;
  x: number;
  z: number;
  s?: number; // size
  rot?: number; // radians
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface Map3D {
  id: Map3DId;
  zoneId: string;
  terrain: "grass" | "stone";
  w: number; // x size, tiles
  d: number; // z size, tiles
  buildings: Building3D[];
  npcs: Npc3D[];
  portals: Portal3D[];
  signs: Sign3D[];
  spawns: Spawn3D[];
  rooms: Room3D[];
  swamp: Circle[];
  decor: Decor3D[];
  /** Paths drawn on the ground (just for looks): lists of points. */
  paths: { x: number; z: number }[][];
}

/** What blocks walking: each decor kind's radius in tiles (0 = walk through). */
export const DECOR_SOLID: Record<DecorKind, number> = {
  tree: 0.55,
  pine: 0.45,
  bush: 0,
  rock: 0.6,
  flower: 0,
  mushroom: 0,
  fence: 0,
  torch: 0.15,
  reed: 0,
  lamp: 0.15,
  crystal: 0.45,
  well: 0.8,
};

// a little seeded random, so decor is the same every load
function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Scatter decor in a box, keeping clear of the given spots. */
function scatter(seed: number, kind: DecorKind, n: number, box: [number, number, number, number], keepClear: Circle[], size: [number, number] = [0.8, 1.3]): Decor3D[] {
  const r = rand(seed);
  const out: Decor3D[] = [];
  let tries = 0;
  while (out.length < n && tries++ < n * 40) {
    const x = box[0] + r() * (box[2] - box[0]);
    const z = box[1] + r() * (box[3] - box[1]);
    if (keepClear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 1.6)) continue;
    out.push({ kind, x, z, s: size[0] + r() * (size[1] - size[0]), rot: r() * Math.PI * 2 });
  }
  return out;
}

/** A ring of trees around the edge of a map, leaving gaps where roads leave. */
function border(seed: number, w: number, d: number, gaps: Circle[], kind: DecorKind = "tree"): Decor3D[] {
  const r = rand(seed);
  const out: Decor3D[] = [];
  const push = (x: number, z: number) => {
    if (gaps.some((g) => Math.hypot(g.x - x, g.z - z) < g.r)) return;
    out.push({ kind: r() < 0.35 ? "pine" : kind, x: x + (r() - 0.5) * 0.8, z: z + (r() - 0.5) * 0.8, s: 1 + r() * 0.5, rot: r() * 6.28 });
  };
  for (let x = 0.8; x < w; x += 2.1) {
    push(x, 0.8);
    push(x, d - 0.8);
  }
  for (let z = 2.9; z < d - 2; z += 2.1) {
    push(0.8, z);
    push(w - 0.8, z);
  }
  return out;
}

// ---------- Thornvale ----------

const thornvale: Map3D = (() => {
  const w = 44;
  const d = 32;
  const buildings: Building3D[] = [
    { kind: "inn", x: 5, z: 4, w: 8, d: 6, h: 4, doorX: 9 },
    { kind: "house", x: 15, z: 4, w: 5, d: 5, h: 3, doorX: 17.5 },
    { kind: "shop", x: 24, z: 4, w: 8, d: 6, h: 4, doorX: 28 },
    { kind: "house", x: 34, z: 5, w: 5, d: 5, h: 3, doorX: 36.5 },
  ];
  const clear: Circle[] = [
    ...buildings.map((b) => ({ x: b.x + b.w / 2, z: b.z + b.d / 2, r: Math.max(b.w, b.d) / 2 + 2.5 })),
    { x: 22, z: 17, r: 7 }, // the square
    { x: 43, z: 17, r: 4 }, // the road out
    { x: 22, z: 13, r: 3 },
  ];
  return {
    id: "thornvale",
    zoneId: "thornvale",
    terrain: "grass",
    w,
    d,
    buildings,
    npcs: [
      { id: "villager_a", x: 18.5, z: 15, look: { skin: "#eec39a", hair: "#6b4226", shirt: "#5b8bd9", hairStyle: "Short", female: false, body: "Rogue" }, talk: "rumors" },
      { id: "villager_b", x: 31, z: 20, look: { skin: "#c68642", hair: "#ececec", shirt: "#9b6bd1", hairStyle: "Long", female: true, body: "Mage" }, talk: "rumors" },
    ],
    portals: [{ x: 43, z: 17, to: "mirewood_fields", toX: 3.5, toZ: 30, label: "Mirewood Fields", kind: "walk" }],
    signs: [{ x: 40, z: 15, zoneId: "thornvale" }],
    spawns: [],
    rooms: [],
    swamp: [],
    paths: [
      [
        { x: 9, z: 11 },
        { x: 14, z: 15 },
        { x: 22, z: 17 },
        { x: 30, z: 17 },
        { x: 44, z: 17 },
      ],
      [
        { x: 28, z: 11 },
        { x: 26, z: 15 },
      ],
      [
        { x: 17.5, z: 10 },
        { x: 19, z: 15 },
      ],
      [
        { x: 36.5, z: 11 },
        { x: 35, z: 17 },
      ],
    ],
    decor: [
      { kind: "well", x: 22, z: 18 },
      { kind: "fence", x: 13.6, z: 11, rot: 0 },
      { kind: "fence", x: 14.8, z: 11, rot: 0 },
      { kind: "bush", x: 4, z: 11, s: 1.1 },
      { kind: "bush", x: 21, z: 9, s: 0.9 },
      { kind: "mushroom", x: 19.6, z: 10.2, s: 0.7 },
      { kind: "rock", x: 33, z: 22, s: 0.8 },
      { kind: "lamp", x: 16, z: 18 },
      { kind: "lamp", x: 28, z: 18 },
      { kind: "lamp", x: 38, z: 15.5 },
      ...scatter(3, "flower", 26, [3, 12, 41, 29], clear, [0.6, 1]),
      ...scatter(4, "bush", 8, [3, 20, 41, 29], clear),
      ...scatter(5, "tree", 9, [3, 21, 41, 29], [...clear, { x: 31, z: 20, r: 3 }], [1, 1.4]),
      ...border(6, w, d, [{ x: 44, z: 17, r: 3.2 }]),
    ],
  };
})();

// ---------- Mirewood Fields ----------

const mirewood: Map3D = (() => {
  const w = 80;
  const d = 60;
  const swamp: Circle[] = [
    { x: 56, z: 30, r: 6 },
    { x: 61, z: 36, r: 6 },
    { x: 63, z: 25, r: 5 },
    { x: 54, z: 38, r: 4 },
  ];
  const spawns: Spawn3D[] = [
    // the west meadow: slimes and rabbits
    { monsterId: "green_slime", x: 9, z: 26 },
    { monsterId: "green_slime", x: 13, z: 36 },
    { monsterId: "horned_rabbit", x: 17, z: 22 },
    { monsterId: "green_slime", x: 19, z: 40 },
    { monsterId: "horned_rabbit", x: 21, z: 31 },
    { monsterId: "horned_rabbit", x: 25, z: 18 },
    // the hill in the middle: toads and wolves
    { monsterId: "bog_toad", x: 29, z: 35 },
    { monsterId: "thorn_wolf", x: 35, z: 24 },
    { monsterId: "thorn_wolf", x: 39, z: 33 },
    { monsterId: "bog_toad", x: 41, z: 42 },
    { monsterId: "horned_rabbit", x: 44, z: 20 },
    { monsterId: "thorn_wolf", x: 47, z: 30 },
    // the swamp
    { monsterId: "bog_toad", x: 53, z: 27 },
    { monsterId: "green_slime", x: 58, z: 42 },
    { monsterId: "bog_toad", x: 61, z: 33 },
    { monsterId: "bog_toad", x: 65, z: 27 },
  ];
  const clear: Circle[] = [
    ...spawns.map((s) => ({ x: s.x, z: s.z, r: 2.5 })),
    ...swamp.map((c) => ({ ...c, r: c.r + 1 })),
    { x: 3, z: 30, r: 5 },
    { x: 74, z: 30, r: 6 },
    { x: 6, z: 27, r: 2 },
    { x: 69, z: 33, r: 2 },
  ];
  // the road from Thornvale to the cave
  const road = [
    { x: 0, z: 30 },
    { x: 12, z: 30 },
    { x: 24, z: 27 },
    { x: 36, z: 29 },
    { x: 48, z: 31 },
    { x: 50, z: 33 },
  ];
  return {
    id: "mirewood_fields",
    zoneId: "mirewood_fields",
    terrain: "grass",
    w,
    d,
    buildings: [],
    npcs: [],
    portals: [
      { x: 1.5, z: 30, to: "thornvale", toX: 41, toZ: 17, label: "Thornvale", kind: "walk" },
      { x: 75, z: 30, to: "hollow_of_the_mire", toX: 4, toZ: 6, label: "Hollow of the Mire", kind: "cave" },
    ],
    signs: [
      { x: 6, z: 27, zoneId: "mirewood_fields" },
      { x: 69, z: 33, zoneId: "hollow_of_the_mire" },
    ],
    spawns,
    rooms: [],
    swamp,
    paths: [road, [{ x: 68, z: 31 }, { x: 74, z: 30 }]],
    decor: [
      // rocks around the cave mouth
      { kind: "rock", x: 74, z: 26.5, s: 1.8 },
      { kind: "rock", x: 76.5, z: 27.5, s: 1.5 },
      { kind: "rock", x: 74, z: 33.5, s: 1.8 },
      { kind: "rock", x: 76.5, z: 32.5, s: 1.5 },
      { kind: "mushroom", x: 71, z: 28, s: 0.8 },
      ...swamp.flatMap((c, i) => scatter(20 + i, "reed", 7, [c.x - c.r - 1, c.z - c.r - 1, c.x + c.r + 1, c.z + c.r + 1], swamp.map((s) => ({ ...s, r: s.r - 0.5 })), [0.7, 1.1]).filter((r) => swamp.some((s) => Math.hypot(s.x - r.x, s.z - r.z) < s.r + 1.2))),
      ...scatter(7, "flower", 60, [3, 5, 30, 55], clear, [0.6, 1]),
      ...scatter(8, "bush", 18, [3, 5, 50, 55], clear),
      ...scatter(9, "tree", 26, [3, 4, 50, 56], [...clear, { x: 24, z: 28, r: 2.5 }, { x: 36, z: 29, r: 2.5 }], [1, 1.5]),
      ...scatter(10, "rock", 8, [26, 5, 50, 55], clear, [0.6, 1]),
      ...scatter(11, "mushroom", 12, [28, 5, 72, 55], clear, [0.6, 1]),
      ...scatter(12, "pine", 14, [50, 4, 77, 56], clear, [1, 1.5]),
      ...border(13, w, d, [
        { x: 0, z: 30, r: 3 },
        { x: 80, z: 30, r: 5 },
      ]),
    ],
  };
})();

// ---------- Hollow of the Mire ----------

const hollow: Map3D = (() => {
  const w = 66;
  const d = 12;
  return {
    id: "hollow_of_the_mire",
    zoneId: "hollow_of_the_mire",
    terrain: "stone",
    w,
    d,
    buildings: [],
    npcs: [],
    portals: [
      { x: 1.5, z: 6, to: "mirewood_fields", toX: 71, toZ: 30, label: "Leave the Hollow", kind: "walk" },
      { x: 63.5, z: 6, to: null, toX: 70, toZ: 30, label: "Back to Mirewood Fields", kind: "dungeon_exit" },
    ],
    signs: [],
    spawns: [],
    rooms: [
      { x0: 5, x1: 18, spawnX: 14, spawnZ: 6, gateX: 19 },
      { x0: 20, x1: 31, spawnX: 27, spawnZ: 6, gateX: 32 },
      { x0: 33, x1: 43, spawnX: 40, spawnZ: 6, gateX: 44 },
      { x0: 45, x1: 64, spawnX: 56, spawnZ: 6, gateX: null },
    ],
    swamp: [],
    paths: [],
    decor: [
      ...[4, 18, 31, 43, 46, 63].flatMap((x) => [
        { kind: "torch" as const, x, z: 1.2 },
        { kind: "torch" as const, x, z: 10.8 },
      ]),
      { kind: "rock", x: 10, z: 2, s: 0.8 },
      { kind: "rock", x: 25, z: 10, s: 0.9 },
      { kind: "mushroom", x: 36, z: 10.4, s: 0.7 },
      { kind: "crystal", x: 50, z: 1.6, s: 1.2 },
      { kind: "crystal", x: 60, z: 10.3, s: 1 },
      { kind: "crystal", x: 22, z: 1.5, s: 0.8 },
    ],
  };
})();

export const MAPS3D: Record<Map3DId, Map3D> = {
  thornvale,
  mirewood_fields: mirewood,
  hollow_of_the_mire: hollow,
};

export const START3D = { map: "thornvale" as Map3DId, x: 22, z: 21 };
/** Where you wake up after falling in a fight: in front of the inn. */
export const INN3D = { map: "thornvale" as Map3DId, x: 9, z: 12 };

// ---------- helpers shared by the game and the tests ----------

/** Solid circles (trees, rocks...) in world units. */
export function solidCircles(m: Map3D): Circle[] {
  return m.decor.filter((o) => DECOR_SOLID[o.kind] > 0).map((o) => ({ x: o.x * TILE3, z: o.z * TILE3, r: DECOR_SOLID[o.kind] * (o.s ?? 1) * TILE3 }));
}

/** Is this spot (world units) in the poison swamp? */
export function inSwamp(m: Map3D, x: number, z: number): boolean {
  return m.swamp.some((c) => Math.hypot(c.x * TILE3 - x, c.z * TILE3 - z) < c.r * TILE3);
}

export function mapSize3(m: Map3D) {
  return { w: m.w * TILE3, d: m.d * TILE3 };
}
