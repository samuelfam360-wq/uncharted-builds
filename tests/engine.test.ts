import { describe, expect, it } from "vitest";
import { Engine, PLAYER_H, type CombatInfo } from "../src/components/side/engine";
import { SIDE_MAPS, TILE, isLadder, isPlatform, standable, tileAt, walkSpan } from "../src/lib/game/data/sidemaps";
import type { LiveReport } from "../src/lib/game/live";
import { MemoryStore } from "../src/lib/store/memory";
import * as game from "../src/lib/game/service";

function seeded(seed = 11) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function setup(mapId: "thornvale" | "mirewood_fields" | "hollow_of_the_mire", x: number, row: number, rng = seeded()) {
  const store = new MemoryStore();
  const p = await game.createCharacter(store, { name: "Rin", classId: "swordsman", stats: { STR: 3, HP: 2 } });
  await game.liveEnter(store, p.id, SIDE_MAPS[mapId].zoneId, 0);
  const st = await game.getState(store, p.id);
  const reports: LiveReport[] = [];
  const toasts: string[] = [];
  const e = new Engine({
    mapId,
    x,
    row,
    combat: st.combat as CombatInfo,
    weapon: st.player.weapon,
    hp: st.player.currentHp,
    mp: st.player.currentMp,
    maxHp: st.derived.maxHp,
    maxMp: st.derived.maxMp,
    bag: st.inventory,
    events: { report: (r) => reports.push(r), toast: (t) => toasts.push(t) },
    rng,
    now: 0,
  });
  let now = 0;
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 16) e.update(16, (now += 16));
  };
  return { store, p, e, reports, toasts, run, clock: () => now };
}

describe("side maps", () => {
  it("every row of every map is the same width", () => {
    for (const m of Object.values(SIDE_MAPS)) {
      const w = m.tiles[0].length;
      expect(m.tiles.every((r) => r.length === w)).toBe(true);
    }
  });
  it("monsters, people, signs and portals all stand on something", () => {
    for (const m of Object.values(SIDE_MAPS)) {
      for (const s of m.spawns) expect(standable(m, Math.floor(s.x), s.row), `${m.id} ${s.monsterId} at ${s.x},${s.row}`).toBe(true);
      for (const n of m.npcs) expect(standable(m, Math.floor(n.x), n.row), n.id).toBe(true);
      for (const s of m.signs) expect(standable(m, Math.floor(s.x), s.row), `sign ${s.x}`).toBe(true);
      for (const p of m.portals) expect(standable(m, Math.floor(p.x), p.row), `portal ${p.label}`).toBe(true);
    }
  });
  it("every field monster has room to walk", () => {
    const m = SIDE_MAPS.mirewood_fields;
    for (const s of m.spawns) {
      const [a, b] = walkSpan(m, s.x, s.row);
      expect(b - a, `${s.monsterId} at ${s.x}`).toBeGreaterThanOrEqual(2);
    }
  });
  it("every ladder reaches a platform or ground at its top", () => {
    for (const m of Object.values(SIDE_MAPS)) {
      m.tiles.forEach((row, y) =>
        [...row].forEach((c, x) => {
          if (isLadder(c) && !isLadder(tileAt(m, x, y - 1))) {
            const above = tileAt(m, x, y - 1);
            expect(isPlatform(above) || above === "#", `${m.id} ladder top at ${x},${y}`).toBe(true);
          }
        }),
      );
    }
  });
  it("portals connect to standable spots", () => {
    for (const m of Object.values(SIDE_MAPS)) {
      for (const p of m.portals) {
        const to = SIDE_MAPS[p.to ?? "mirewood_fields"];
        expect(standable(to, Math.floor(p.toX), p.toRow), `${m.id} -> ${to.id}`).toBe(true);
      }
    }
  });
});

describe("moving around", () => {
  it("walks, jumps and lands on the ground", async () => {
    const { e, run } = await setup("thornvale", 10, 9);
    const x0 = e.player.x;
    e.held.right = true;
    run(500);
    e.held.right = false;
    expect(e.player.x).toBeGreaterThan(x0 + 100);
    e.press("jump");
    run(100);
    expect(e.player.y).toBeLessThan(9 * TILE - 40);
    run(1200);
    expect(e.player.y).toBe(9 * TILE);
    expect(e.player.onGround).toBe(true);
  });

  it("climbs the ladder up to the lookout and drops back through it", async () => {
    const { e, run } = await setup("thornvale", 29.5, 9);
    e.held.up = true;
    run(2500);
    e.held.up = false;
    expect(e.player.y).toBe(5 * TILE);
    expect(e.player.onLadder).toBe(false);
    e.held.right = true;
    run(150);
    e.held.right = false;
    run(100);
    expect(e.player.y).toBe(5 * TILE); // standing on the platform
    e.held.down = true;
    e.press("jump");
    run(1500);
    e.held.down = false;
    expect(e.player.y).toBe(9 * TILE);
  });

  it("can't walk through the west wall", async () => {
    const { e, run } = await setup("thornvale", 2, 9);
    e.held.left = true;
    run(2000);
    expect(e.player.x).toBeGreaterThanOrEqual(TILE + 16);
  });

  it("finds the inn door, a villager, and the portal", async () => {
    const { e } = await setup("thornvale", 6.5, 9);
    expect(e.nearby()?.kind).toBe("door");
    e.player.x = 16.5 * TILE;
    expect(e.nearby()?.kind).toBe("npc");
    e.player.x = 42.5 * TILE;
    expect(e.nearby()?.kind).toBe("portal");
  });
});

describe("live combat against the real server rules", () => {
  it("kills a slime by holding attack, and the server accepts the report", async () => {
    const { e, run, reports, store, p, clock } = await setup("mirewood_fields", 4, 11);
    // stand next to the first slime and face it
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    e.player.x = slime.x - 60;
    slime.span = [slime.x, slime.x];
    e.held.right = true;
    run(30);
    e.held.right = false;
    e.held.attack = true;
    for (let i = 0; i < 200 && !reports.some((r) => r.type === "kill"); i++) run(100);
    e.held.attack = false;
    const kill = reports.find((r) => r.type === "kill")!;
    expect(kill).toBeTruthy();
    expect(kill.monsterId).toBe("green_slime");
    const res = await game.liveReport(store, p.id, kill, seeded(), clock() + 1000);
    expect(res.rewards?.exp).toBeGreaterThan(0);
  });

  it("a well-timed block parries: no damage, the monster is stunned", async () => {
    const { e, run } = await setup("mirewood_fields", 4, 11);
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    e.player.x = slime.x - 70;
    slime.span = [slime.x, slime.x];
    slime.aggro = true;
    slime.provoked = true;
    slime.nextAttackAt = 0;
    run(20);
    expect(slime.state).toBe("windup");
    const hp = e.player.hp;
    // press block 100ms before the blow lands
    const until = slime.stateUntil;
    while (e.now < until - 100) run(16);
    e.held.block = true;
    run(300);
    expect(e.player.hp).toBe(hp);
    expect(slime.state).toBe("stunned");
  });

  it("holding block too early only blocks", async () => {
    const { e, run } = await setup("mirewood_fields", 4, 11, seeded(5));
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    e.player.x = slime.x - 70;
    slime.span = [slime.x, slime.x];
    slime.aggro = true;
    slime.provoked = true;
    slime.nextAttackAt = 0;
    e.held.block = true;
    run(1200);
    expect(slime.state).not.toBe("stunned");
  });

  it("falling in a fight sends a death report the server accepts", async () => {
    const { e, run, reports, store, p, clock } = await setup("mirewood_fields", 4, 11);
    e.player.hp = 1;
    const wolf = e.monsters.find((m) => m.id === "thorn_wolf")!;
    e.player.x = wolf.x - 80;
    e.player.y = wolf.y;
    wolf.span = [wolf.x, wolf.x];
    wolf.aggro = true;
    wolf.nextAttackAt = 0;
    for (let i = 0; i < 100 && !e.player.dead; i++) run(100);
    expect(e.player.dead).toBe(true);
    const death = reports.find((r) => r.type === "death")!;
    expect(death.hp).toBe(0);
    await expect(game.liveReport(store, p.id, death, seeded(), clock() + 1000)).resolves.toBeTruthy();
  });

  it("standing in the swamp hurts every 2 seconds", async () => {
    const { e, run } = await setup("mirewood_fields", 58, 11);
    e.monsters = [];
    const hp = e.player.hp;
    run(4100);
    expect(e.player.inSwamp).toBe(true);
    expect(hp - e.player.hp).toBeGreaterThanOrEqual(8);
    e.flush();
  });

  it("the dungeon gate stays shut until the room is cleared", async () => {
    const { e, run } = await setup("hollow_of_the_mire", 3, 9);
    e.run = { room: 0, totalRooms: 4, cleared: false };
    e.held.right = true;
    run(8000);
    expect(e.player.x).toBeLessThan(19 * TILE);
    expect(e.monsters.some((m) => m.id === "mire_bat")).toBe(true);
    e.setRun({ room: 1, totalRooms: 4, cleared: false });
    e.monsters = [];
    run(3000);
    expect(e.player.x).toBeGreaterThan(19 * TILE);
    void PLAYER_H;
  });
});
