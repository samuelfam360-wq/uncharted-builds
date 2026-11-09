// Top-down maps for World 1, drawn tile by tile in the browser.
// Tile key:
//   .  grass        ,  tall grass (wild monsters)   %  poison swamp (monsters, swamp fights)
//   =  dirt road    f  flowers                      T  tree (blocks)
//   ~  water (blocks)   F  fence (blocks)   R  rock (blocks)   S  sign (blocks, read it)
//   C  cave mouth (the dungeon entrance)

export type MapId = "thornvale" | "mirewood_fields";
export type Facing = "up" | "down" | "left" | "right";

export interface Building {
  kind: "inn" | "shop" | "house";
  x: number;
  y: number;
  w: number;
  h: number;
  door: { x: number; y: number }; // bottom row; walking up into it opens the inn or shop
}

export interface Npc {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  look: { skin: string; hair: string; shirt: string };
  talk: "rumors";
}

export interface Warp {
  x: number;
  y: number;
  to: MapId;
  toX: number;
  toY: number;
  facing: Facing;
}

export interface Sign {
  x: number;
  y: number;
  zoneId: string; // shows that zone's name and description
}

export interface WorldMap {
  id: MapId;
  zoneId: string; // matches ZONES in world.ts
  tiles: string[];
  buildings: Building[];
  npcs: Npc[];
  warps: Warp[];
  signs: Sign[];
  cave?: { x: number; y: number; zoneId: string; exitX: number; exitY: number };
}

export const MAPS: Record<MapId, WorldMap> = {
  thornvale: {
    id: "thornvale",
    zoneId: "thornvale",
    tiles: [
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "T..........................T",
      "T.ff......ff.............f.T",
      "T..............f...........T",
      "T..........................T",
      "T....=...............=.....T",
      "T....=...............=..S..T",
      "T===========================",
      "T===========================",
      "T............==............T",
      "T............==............T",
      "T..FFFFFF....==.........f..T",
      "T..FffffF....==..~~~~......T",
      "T..FffffF....==..~~~~......T",
      "T..FffffF....==..~~~~......T",
      "T.fFFFFFF..................T",
      "T........ff................T",
      "T..........................T",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    ],
    buildings: [
      { kind: "inn", x: 3, y: 2, w: 6, h: 4, door: { x: 5, y: 5 } },
      { kind: "house", x: 11, y: 2, w: 5, h: 3, door: { x: 13, y: 4 } },
      { kind: "shop", x: 19, y: 2, w: 6, h: 4, door: { x: 21, y: 5 } },
      { kind: "house", x: 21, y: 11, w: 5, h: 3, door: { x: 23, y: 13 } },
    ],
    npcs: [
      { id: "villager_a", x: 16, y: 10, facing: "down", look: { skin: "#eec39a", hair: "#6b4226", shirt: "#5b8bd9" }, talk: "rumors" },
      { id: "villager_b", x: 10, y: 17, facing: "right", look: { skin: "#c68642", hair: "#ececec", shirt: "#9b6bd1" }, talk: "rumors" },
    ],
    warps: [
      { x: 27, y: 8, to: "mirewood_fields", toX: 1, toY: 8, facing: "right" },
      { x: 27, y: 9, to: "mirewood_fields", toX: 1, toY: 9, facing: "right" },
    ],
    signs: [{ x: 24, y: 7, zoneId: "thornvale" }],
  },
  mirewood_fields: {
    id: "mirewood_fields",
    zoneId: "mirewood_fields",
    tiles: [
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTRRRRRRRRRT",
      "T......TTT....................RRRRRRRRRT",
      "T.TTT..TTT....,,,,,,,,,.......RRRRRCRRRT",
      "T.TTT.........,,,,,,,,,..===========...T",
      "T.TTT.........,,,,,,,,,..========S.....T",
      "T.............,,,,,,,,,..==...f........T",
      "T.S...........,,,,,,,,,..==............T",
      "=====f=======.,,,,,,,,,..==.%%%%%%%%%%.T",
      "=============............==.%%%%%%%%~~.T",
      "T.....f....==......f.....==.%%~~~%%%~~.T",
      "T.,,,,,,,,.==.TTTT..TTT..==.%%~~~%%%%%.T",
      "T.,,,,,,,,.==.TTTT..TTT..==.%%%%%%%%%%.T",
      "T.,,,,,,,,.==.TTTT..TTT..==.%%%%%%~~%%.T",
      "T.,,,,,,,,.==..........f.==.%%%%%%~~%%.T",
      "T.,,,,,,,,.==............==.%%%%%%~~%%.T",
      "T.,,,,,,,,.================.%%%%%%%%%%.T",
      "T..........================............T",
      "TTT......f..................TTT........T",
      "TTT...........,,,,,,,,,,....TTT.%%%%%%.T",
      "TTT,,,,,,,....,,,,,,,,,,....TTT.%%%%%%.T",
      "TTT,,,,,,,....,,,,,,,,,,....TTT.%%%%%%.T",
      "TTT,,,,,,,....,,,,,,,,,,........%%%%%%.T",
      "TTT,,,,,,,....,,,,,,,,,,........%%%%%%.T",
      "TTT....................................T",
      "TTT....................................T",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    ],
    buildings: [],
    npcs: [],
    warps: [
      { x: 0, y: 8, to: "thornvale", toX: 26, toY: 8, facing: "left" },
      { x: 0, y: 9, to: "thornvale", toX: 26, toY: 9, facing: "left" },
    ],
    signs: [
      { x: 2, y: 7, zoneId: "mirewood_fields" },
      { x: 33, y: 5, zoneId: "hollow_of_the_mire" },
    ],
    cave: { x: 35, y: 3, zoneId: "hollow_of_the_mire", exitX: 35, exitY: 4 },
  },
};

export const START = { map: "thornvale" as MapId, x: 13, y: 9, facing: "down" as Facing };
/** Where you wake up after losing a fight: outside the inn. */
export const INN_SPOT = { map: "thornvale" as MapId, x: 5, y: 6, facing: "up" as Facing };

export const TILE = 16;

const BLOCKING = new Set(["T", "~", "F", "R", "S"]);

export function tileAt(m: WorldMap, x: number, y: number): string {
  if (y < 0 || y >= m.tiles.length || x < 0 || x >= m.tiles[0].length) return "T";
  return m.tiles[y][x];
}

export function buildingAt(m: WorldMap, x: number, y: number): Building | undefined {
  return m.buildings.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
}

/** Can the player stand on this tile? (NPCs are checked separately.) */
export function walkable(m: WorldMap, x: number, y: number): boolean {
  if (BLOCKING.has(tileAt(m, x, y))) return false;
  return !buildingAt(m, x, y);
}

export function npcAt(m: WorldMap, x: number, y: number): Npc | undefined {
  return m.npcs.find((n) => n.x === x && n.y === y);
}
