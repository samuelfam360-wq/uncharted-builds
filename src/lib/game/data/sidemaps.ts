// Side-view maps for World 1 (the MapleStory-style version).
//
// Each map is a grid of 64x64 tiles, built in code so every row lines up:
//   #  solid ground          =  thin platform (jump up through it, Down + Jump drops through)
//   H  ladder                ~  poison swamp water (slows you and hurts every 2 seconds)
//   .  air
// Places (people, doors, portals, monsters) are listed separately in tile units.
// Zone ids and names come from world.ts and are unchanged.

export const TILE = 64;

export type SideMapId = "thornvale" | "mirewood_fields" | "hollow_of_the_mire";
export type Terrain = "grass" | "stone";
export type Backdrop = "hills" | "trees" | "cave";

export interface BuildingDef {
  kind: "inn" | "shop" | "house";
  x: number; // left tile
  w: number;
  h: number;
  doorX: number; // tile column of the door
}

export interface NpcDef {
  id: string;
  x: number;
  row: number; // the row they stand on top of (their feet are at row * TILE)
  look: { skin: string; hair: string; shirt: string; hairStyle: string; female: boolean };
  talk: "rumors";
}

export interface PortalDef {
  x: number;
  row: number;
  to: SideMapId | null; // null = the dungeon exit that appears after the boss
  toX: number;
  toRow: number;
  label: string;
  kind: "walk" | "cave" | "dungeon_exit";
}

export interface SignDef {
  x: number;
  row: number;
  zoneId: string;
}

export interface SpawnDef {
  monsterId: string;
  x: number;
  row: number;
}

/** Dungeon rooms: the monster appears when you step in, the gate opens when it falls. */
export interface RoomDef {
  x0: number; // first tile of the room
  x1: number; // last tile of the room
  spawnX: number;
  spawnRow: number;
  gateX: number | null; // tile column of the gate on the room's right side
}

export interface Decor {
  frame: string; // a frame from the art pack
  x: number;
  row: number; // sits on top of this row
  scale?: number;
  front?: boolean;
}

export interface SideMap {
  id: SideMapId;
  zoneId: string;
  terrain: Terrain;
  backdrop: Backdrop;
  tiles: string[];
  buildings: BuildingDef[];
  npcs: NpcDef[];
  portals: PortalDef[];
  signs: SignDef[];
  spawns: SpawnDef[];
  rooms: RoomDef[];
  decor: Decor[];
  gateTop: number; // dungeon gates fill rows gateTop..(ground-1)
}

// ---------- tiny grid builder ----------

function grid(w: number, h: number) {
  const g = Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
  const api = {
    set(x: number, y: number, c: string) {
      if (y >= 0 && y < h && x >= 0 && x < w) g[y][x] = c;
      return api;
    },
    fill(x0: number, y0: number, x1: number, y1: number, c: string) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.set(x, y, c);
      return api;
    },
    /** A ladder from just under a platform at `top` down to the ground at `ground`. */
    ladder(x: number, top: number, ground: number) {
      for (let y = top; y < ground; y++) api.set(x, y, "H");
      return api;
    },
    rows: () => g.map((r) => r.join("")),
  };
  return api;
}

// ---------- Thornvale ----------

const thornvale: SideMap = (() => {
  const W = 44;
  const G = 9; // ground row
  const t = grid(W, 12).fill(0, G, W - 1, 11, "#");
  t.fill(0, 0, 0, G - 1, "#"); // west wall
  t.fill(28, 5, 32, 5, "=").ladder(29, 6, G); // the lookout
  return {
    id: "thornvale",
    zoneId: "thornvale",
    terrain: "grass",
    backdrop: "hills",
    tiles: t.rows(),
    buildings: [
      { kind: "inn", x: 3, w: 6, h: 4, doorX: 6 },
      { kind: "house", x: 11, w: 4, h: 3, doorX: 13 },
      { kind: "shop", x: 18, w: 6, h: 4, doorX: 21 },
      { kind: "house", x: 34, w: 4, h: 3, doorX: 36 },
    ],
    npcs: [
      { id: "villager_a", x: 16.5, row: G, look: { skin: "#eec39a", hair: "#6b4226", shirt: "#5b8bd9", hairStyle: "Short", female: false }, talk: "rumors" },
      { id: "villager_b", x: 30.5, row: 5, look: { skin: "#c68642", hair: "#ececec", shirt: "#9b6bd1", hairStyle: "Long", female: true }, talk: "rumors" },
    ],
    portals: [{ x: 42.5, row: G, to: "mirewood_fields", toX: 3, toRow: 11, label: "Mirewood Fields", kind: "walk" }],
    signs: [{ x: 40, row: G, zoneId: "thornvale" }],
    spawns: [],
    rooms: [],
    decor: [
      { frame: "bush", x: 1.6, row: G },
      { frame: "fence", x: 9.6, row: G },
      { frame: "fence", x: 10.4, row: G },
      { frame: "mushroom_red", x: 15.6, row: G, scale: 0.7 },
      { frame: "bush", x: 25, row: G },
      { frame: "grass", x: 26.2, row: G },
      { frame: "rock", x: 33, row: G, scale: 0.8 },
      { frame: "grass", x: 38.7, row: G },
      { frame: "grass", x: 39.5, row: G, front: true },
    ],
    gateTop: 0,
  };
})();

// ---------- Mirewood Fields ----------

const mirewood: SideMap = (() => {
  const W = 76;
  const G = 11;
  const t = grid(W, 14).fill(0, G, W - 1, 13, "#");
  t.fill(0, 0, 0, G - 1, "#").fill(W - 1, 0, W - 1, G - 1, "#");
  // west meadow: two platforms with ladders
  t.fill(7, 8, 13, 8, "=").ladder(8, 9, G);
  t.fill(15, 5, 21, 5, "=").ladder(19, 6, 8).fill(17, 8, 21, 8, "=").ladder(20, 9, G);
  // the hill in the middle, with a wolf ledge above it
  t.fill(26, 9, 41, 10, "#").fill(29, 8, 38, 8, "#");
  t.fill(30, 4, 37, 4, "=").ladder(31, 5, 8);
  t.fill(43, 7, 47, 7, "=").ladder(45, 8, G);
  // the swamp: water sits on the ground, a log walk crosses part of it
  t.fill(51, G - 1, 66, G - 1, "~");
  t.fill(54, 7, 60, 7, "=").ladder(55, 8, G);
  // the rocks around the cave
  t.fill(70, 9, 74, 10, "#");
  return {
    id: "mirewood_fields",
    zoneId: "mirewood_fields",
    terrain: "grass",
    backdrop: "trees",
    tiles: t.rows(),
    buildings: [],
    npcs: [],
    portals: [
      { x: 1.5, row: G, to: "thornvale", toX: 41, toRow: 9, label: "Thornvale", kind: "walk" },
      { x: 72.5, row: 9, to: "hollow_of_the_mire", toX: 3, toRow: 9, label: "Hollow of the Mire", kind: "cave" },
    ],
    signs: [
      { x: 4, row: G, zoneId: "mirewood_fields" },
      { x: 68.5, row: G, zoneId: "hollow_of_the_mire" },
    ],
    spawns: [
      { monsterId: "green_slime", x: 5, row: G },
      { monsterId: "green_slime", x: 11, row: G },
      { monsterId: "horned_rabbit", x: 16, row: G },
      { monsterId: "green_slime", x: 10, row: 8 },
      { monsterId: "horned_rabbit", x: 18, row: 5 },
      { monsterId: "horned_rabbit", x: 23, row: G },
      { monsterId: "bog_toad", x: 27, row: 9 },
      { monsterId: "thorn_wolf", x: 34, row: 8 },
      { monsterId: "thorn_wolf", x: 34, row: 4 },
      { monsterId: "bog_toad", x: 40, row: 9 },
      { monsterId: "horned_rabbit", x: 45, row: 7 },
      { monsterId: "thorn_wolf", x: 47, row: G },
      { monsterId: "bog_toad", x: 53, row: G },
      { monsterId: "green_slime", x: 57, row: 7 },
      { monsterId: "bog_toad", x: 61, row: G },
      { monsterId: "bog_toad", x: 65, row: G },
    ],
    rooms: [],
    decor: [
      { frame: "bush", x: 2.8, row: G },
      { frame: "grass", x: 6, row: G },
      { frame: "mushroom_brown", x: 14, row: G, scale: 0.8 },
      { frame: "grass", x: 22.5, row: G, front: true },
      { frame: "bush", x: 25, row: G },
      { frame: "mushroom_red", x: 33, row: 8, scale: 0.7 },
      { frame: "grass", x: 41, row: 9 },
      { frame: "rock", x: 49, row: G },
      { frame: "grass_purple", x: 50, row: G },
      { frame: "grass_purple", x: 67, row: G },
      { frame: "mushroom_brown", x: 69, row: G, scale: 0.7 },
      { frame: "rock", x: 74.5, row: 9, scale: 0.8 },
    ],
    gateTop: 0,
  };
})();

// ---------- Hollow of the Mire ----------

const hollow: SideMap = (() => {
  const W = 66;
  const G = 9;
  const t = grid(W, 12).fill(0, G, W - 1, 11, "#").fill(0, 0, W - 1, 1, "#");
  t.fill(0, 2, 0, G - 1, "#").fill(W - 1, 2, W - 1, G - 1, "#");
  // room 2 (golem) has a ledge, the queen's hall has two
  t.fill(24, 6, 28, 6, "=");
  t.fill(48, 6, 51, 6, "=").fill(57, 6, 60, 6, "=");
  return {
    id: "hollow_of_the_mire",
    zoneId: "hollow_of_the_mire",
    terrain: "stone",
    backdrop: "cave",
    tiles: t.rows(),
    buildings: [],
    npcs: [],
    portals: [
      { x: 1.5, row: G, to: "mirewood_fields", toX: 70, toRow: 11, label: "Leave the Hollow", kind: "walk" },
      { x: 63.5, row: G, to: null, toX: 70, toRow: 11, label: "Back to Mirewood Fields", kind: "dungeon_exit" },
    ],
    signs: [],
    spawns: [],
    rooms: [
      { x0: 5, x1: 18, spawnX: 14, spawnRow: 5, gateX: 19 },
      { x0: 20, x1: 31, spawnX: 27, spawnRow: G, gateX: 32 },
      { x0: 33, x1: 43, spawnX: 40, spawnRow: 5, gateX: 44 },
      { x0: 45, x1: 64, spawnX: 56, spawnRow: G, gateX: null },
    ],
    decor: [
      { frame: "torch_on_a", x: 4, row: G },
      { frame: "torch_on_a", x: 18, row: G },
      { frame: "torch_on_a", x: 31, row: G },
      { frame: "torch_on_a", x: 43, row: G },
      { frame: "torch_on_a", x: 46, row: G },
      { frame: "torch_on_a", x: 63, row: G },
      { frame: "rock", x: 10, row: G, scale: 0.8 },
      { frame: "mushroom_brown", x: 36, row: G, scale: 0.7 },
    ],
    gateTop: 2,
  };
})();

export const SIDE_MAPS: Record<SideMapId, SideMap> = {
  thornvale,
  mirewood_fields: mirewood,
  hollow_of_the_mire: hollow,
};

export const SIDE_START = { map: "thornvale" as SideMapId, x: 10, row: 9 };
/** Where you wake up after falling in a fight: in front of the inn. */
export const SIDE_INN = { map: "thornvale" as SideMapId, x: 6, row: 9 };

// ---------- helpers shared by the game and the tests ----------

export function tileAt(m: SideMap, x: number, y: number): string {
  if (y < 0) return ".";
  if (y >= m.tiles.length || x < 0 || x >= m.tiles[0].length) return "#";
  return m.tiles[y][x];
}

export const isSolid = (c: string) => c === "#";
export const isPlatform = (c: string) => c === "=";
export const isLadder = (c: string) => c === "H";
export const isSwamp = (c: string) => c === "~";

/** Is there something to stand on at the top of this row, at this column? */
export function standable(m: SideMap, x: number, row: number): boolean {
  const c = tileAt(m, x, row);
  return isSolid(c) || isPlatform(c);
}

/** How far a monster standing at (x, row) can walk left and right before an edge or a wall (tile columns). */
export function walkSpan(m: SideMap, x: number, row: number): [number, number] {
  const col = Math.floor(x);
  const ok = (c: number) => standable(m, c, row) && !isSolid(tileAt(m, c, row - 1)) && !isSolid(tileAt(m, c, row - 2));
  let a = col;
  let b = col;
  while (ok(a - 1)) a--;
  while (ok(b + 1)) b++;
  return [a, b + 1];
}

export function mapSize(m: SideMap) {
  return { w: m.tiles[0].length * TILE, h: m.tiles.length * TILE };
}
