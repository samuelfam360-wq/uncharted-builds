import { describe, expect, it } from "vitest";
import { INN_SPOT, MAPS, START, buildingAt, npcAt, tileAt, walkable, type MapId, type WorldMap } from "../src/lib/game/data/maps";
import { ZONES } from "../src/lib/game/data/world";

const KNOWN = new Set([".", ",", "%", "=", "f", "T", "~", "F", "R", "S", "C"]);
const step = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/** Every tile the player can reach on foot from (x, y). */
function reachable(m: WorldMap, x: number, y: number) {
  const seen = new Set<string>([`${x},${y}`]);
  const queue = [[x, y]];
  while (queue.length) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of step) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = `${nx},${ny}`;
      if (seen.has(k) || !walkable(m, nx, ny) || npcAt(m, nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}
const nextTo = (seen: Set<string>, x: number, y: number) => step.some(([dx, dy]) => seen.has(`${x + dx},${y + dy}`));

describe("world maps", () => {
  for (const m of Object.values(MAPS)) {
    describe(m.id, () => {
      it("is a clean rectangle of known tiles and matches a real zone", () => {
        const w = m.tiles[0].length;
        for (const row of m.tiles) {
          expect(row.length).toBe(w);
          for (const c of row) expect(KNOWN.has(c)).toBe(true);
        }
        expect(ZONES[m.zoneId]).toBeDefined();
      });

      const entry = m.id === START.map ? START : m.warps.length ? Object.values(MAPS).flatMap((o) => o.warps).find((w) => w.to === m.id)! : null;
      const from = entry && "toX" in entry ? { x: entry.toX, y: entry.toY } : { x: START.x, y: START.y };

      it("every door, warp, sign, cave and villager can be reached", () => {
        expect(walkable(m, from.x, from.y)).toBe(true);
        const seen = reachable(m, from.x, from.y);
        for (const w of m.warps) expect(seen.has(`${w.x},${w.y}`), `warp ${w.x},${w.y}`).toBe(true);
        for (const b of m.buildings) {
          expect(buildingAt(m, b.door.x, b.door.y)).toBe(b);
          expect(b.door.y).toBe(b.y + b.h - 1);
          if (b.kind !== "house") expect(seen.has(`${b.door.x},${b.door.y + 1}`), `${b.kind} door`).toBe(true);
        }
        for (const s of m.signs) {
          expect(tileAt(m, s.x, s.y)).toBe("S");
          expect(ZONES[s.zoneId]).toBeDefined();
          expect(nextTo(seen, s.x, s.y), `sign ${s.x},${s.y}`).toBe(true);
        }
        for (const n of m.npcs) {
          expect(walkable(m, n.x, n.y)).toBe(true);
          expect(nextTo(seen, n.x, n.y), `npc ${n.id}`).toBe(true);
        }
        if (m.cave) {
          expect(tileAt(m, m.cave.x, m.cave.y)).toBe("C");
          expect(seen.has(`${m.cave.x},${m.cave.y}`)).toBe(true);
          expect(seen.has(`${m.cave.exitX},${m.cave.exitY}`)).toBe(true);
          expect(ZONES[m.cave.zoneId].kind).toBe("dungeon");
        }
      });

      it("warps land on open ground in the other map", () => {
        for (const w of m.warps) {
          const to = MAPS[w.to as MapId];
          expect(walkable(to, w.toX, w.toY)).toBe(true);
          expect(to.warps.some((b) => b.x === w.toX && b.y === w.toY)).toBe(false);
        }
      });
    });
  }

  it("the fields have tall grass and swamp to find monsters in", () => {
    const tiles = MAPS.mirewood_fields.tiles.join("");
    expect(tiles).toContain(",");
    expect(tiles).toContain("%");
  });

  it("start and inn spots are open ground", () => {
    expect(walkable(MAPS[START.map], START.x, START.y)).toBe(true);
    expect(walkable(MAPS[INN_SPOT.map], INN_SPOT.x, INN_SPOT.y)).toBe(true);
  });
});
