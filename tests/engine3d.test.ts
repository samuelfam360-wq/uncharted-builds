import { describe, expect, it } from "vitest";
import { Engine3D, flat, yawTo, type CombatInfo, type Monster } from "../src/components/three/engine3d";
import { MAPS3D, TILE3 as TILE, inSwamp, solidCircles, type Map3DId } from "../src/lib/game/data/maps3d";
import { MONSTERS, ZONES } from "../src/lib/game/data/world";
import type { LiveReport } from "../src/lib/game/live";
import { MemoryStore } from "../src/lib/store/memory";
import * as game from "../src/lib/game/service";
import type { ClassId } from "../src/lib/game/types";

function seeded(seed = 11) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function setup(mapId: Map3DId, x: number, z: number, rng = seeded(), classId: ClassId = "swordsman") {
  const store = new MemoryStore();
  const p = await game.createCharacter(store, { name: "Rin", classId, stats: { STR: 3, HP: 2 } });
  await game.liveEnter(store, p.id, MAPS3D[mapId].zoneId, 0);
  const st = await game.getState(store, p.id);
  const reports: LiveReport[] = [];
  const toasts: string[] = [];
  const e = new Engine3D({
    mapId,
    x,
    z,
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

/** Pin a monster in place (it can still attack) and put the player `gap` in front of it, facing it. */
function faceOff(e: Engine3D, m: Monster, gap: number) {
  m.home = { x: m.x, z: m.z, r: 0 };
  e.player.x = m.x - gap;
  e.player.z = m.z;
  e.player.y = 0;
  e.player.yaw = yawTo(e.player, m);
  // nothing else in the way
  e.monsters = [m];
}

describe("3D maps", () => {
  it("every place, person, portal and monster sits inside its map and out of trees and walls", () => {
    for (const m of Object.values(MAPS3D)) {
      const solids = solidCircles(m);
      const spots = [
        ...m.npcs.map((n) => ({ what: n.id, x: n.x, z: n.z })),
        ...m.signs.map((s) => ({ what: `sign ${s.zoneId}`, x: s.x, z: s.z })),
        ...m.portals.map((p) => ({ what: `portal ${p.label}`, x: p.x, z: p.z })),
        ...m.spawns.map((s) => ({ what: s.monsterId, x: s.x, z: s.z })),
        ...m.rooms.map((r, i) => ({ what: `room ${i}`, x: r.spawnX, z: r.spawnZ })),
        ...m.buildings.map((b) => ({ what: `${b.kind} door`, x: b.doorX, z: b.z + b.d + 0.6 })),
      ];
      for (const s of spots) {
        expect(s.x, `${m.id} ${s.what}`).toBeGreaterThan(0);
        expect(s.x, `${m.id} ${s.what}`).toBeLessThan(m.w);
        expect(s.z, `${m.id} ${s.what}`).toBeGreaterThan(0);
        expect(s.z, `${m.id} ${s.what}`).toBeLessThan(m.d);
        for (const c of solids) expect(Math.hypot(c.x - s.x * TILE, c.z - s.z * TILE), `${m.id} ${s.what} inside a tree/rock`).toBeGreaterThan(c.r);
        for (const b of m.buildings) {
          const inside = s.x > b.x && s.x < b.x + b.w && s.z > b.z && s.z < b.z + b.d;
          expect(inside, `${m.id} ${s.what} inside a building`).toBe(false);
        }
      }
    }
  });

  it("uses the same places, people and monsters as the side view", () => {
    expect(Object.keys(MAPS3D).sort()).toEqual(["hollow_of_the_mire", "mirewood_fields", "thornvale"]);
    for (const m of Object.values(MAPS3D)) expect(ZONES[m.zoneId]).toBeTruthy();
    expect(MAPS3D.thornvale.npcs.map((n) => n.id)).toEqual(["villager_a", "villager_b"]);
    expect(MAPS3D.thornvale.buildings.map((b) => b.kind).sort()).toEqual(["house", "house", "inn", "shop"]);
    const field = MAPS3D.mirewood_fields.spawns.map((s) => s.monsterId);
    for (const id of field) expect(MONSTERS[id]).toBeTruthy();
    expect(new Set(field)).toEqual(new Set(["green_slime", "horned_rabbit", "bog_toad", "thorn_wolf"]));
    expect(MAPS3D.hollow_of_the_mire.rooms).toHaveLength(ZONES.hollow_of_the_mire.rooms!.length);
  });

  it("portals lead to open ground on the other map", () => {
    for (const m of Object.values(MAPS3D)) {
      for (const p of m.portals) {
        const to = MAPS3D[p.to ?? "mirewood_fields"];
        expect(p.toX).toBeGreaterThan(0);
        expect(p.toX).toBeLessThan(to.w);
        expect(p.toZ).toBeGreaterThan(0);
        expect(p.toZ).toBeLessThan(to.d);
        // you don't land standing on the way back (or you'd bounce straight back)
        for (const back of to.portals) expect(Math.hypot(back.x - p.toX, back.z - p.toZ) * TILE, `${m.id} -> ${to.id}`).toBeGreaterThan(110);
      }
    }
  });

  it("there is swamp in Mirewood Fields, and only there", () => {
    expect(MAPS3D.mirewood_fields.swamp.length).toBeGreaterThan(0);
    expect(MAPS3D.thornvale.swamp).toEqual([]);
    const c = MAPS3D.mirewood_fields.swamp[0];
    expect(inSwamp(MAPS3D.mirewood_fields, c.x * TILE, c.z * TILE)).toBe(true);
  });
});

describe("moving around in 3D", () => {
  it("walks any direction on the ground, jumps and lands", async () => {
    const { e, run } = await setup("thornvale", 22, 21);
    const x0 = e.player.x;
    const z0 = e.player.z;
    e.held.mx = 1;
    run(400);
    e.held.mx = 0;
    expect(e.player.x).toBeGreaterThan(x0 + 80);
    e.held.mz = -1;
    run(400);
    e.held.mz = 0;
    expect(e.player.z).toBeLessThan(z0 - 80);
    // turned to face where it walked (north = yaw pi)
    expect(Math.abs(Math.abs(e.player.yaw) - Math.PI)).toBeLessThan(0.2);
    e.press("jump");
    run(120);
    expect(e.player.y).toBeLessThan(-40);
    expect(e.player.onGround).toBe(false);
    run(1500);
    expect(e.player.y).toBe(0);
    expect(e.player.onGround).toBe(true);
  });

  it("can't walk through buildings, trees or off the map", async () => {
    const { e, run } = await setup("thornvale", 9, 12);
    // the inn is north of its door
    e.held.mz = -1;
    run(2000);
    expect(e.player.z).toBeGreaterThanOrEqual((4 + 6) * TILE + 17);
    e.held.mz = 0;
    e.held.mx = -1;
    run(6000);
    expect(e.player.x).toBeGreaterThan(17);
    // never inside a solid
    for (const c of solidCircles(e.map)) expect(Math.hypot(c.x - e.player.x, c.z - e.player.z)).toBeGreaterThanOrEqual(c.r + 17);
  });

  it("finds the inn door, a villager, the sign and the portal", async () => {
    const { e } = await setup("thornvale", 9, 10.6);
    expect(e.nearby()).toMatchObject({ kind: "door", building: { kind: "inn" } });
    e.player.x = 18.5 * TILE;
    e.player.z = 15.8 * TILE;
    expect(e.nearby()).toMatchObject({ kind: "npc" });
    e.player.x = 40 * TILE;
    e.player.z = 15.6 * TILE;
    expect(e.nearby()).toMatchObject({ kind: "sign" });
    e.player.x = 43 * TILE;
    e.player.z = 17 * TILE;
    expect(e.nearby()).toMatchObject({ kind: "portal", portal: { to: "mirewood_fields" } });
  });

  it("changing maps puts you on the new map with your pet beside you", async () => {
    const { e } = await setup("thornvale", 43, 17);
    e.setPet({ species: "green_slime", attacker: { stats: { HP: 40, STR: 9, VIT: 3, AGI: 2, DEX: 5, INT: 2 }, passive: { dmg_mult: 1, crit_bonus: 0, crit_mult: 1.5, hit_bonus: 0, low_hp_dmg: null } } as never });
    e.setMap("mirewood_fields", 3.5, 30, null);
    expect(e.map.id).toBe("mirewood_fields");
    expect(e.player.x).toBe(3.5 * TILE);
    expect(e.monsters.length).toBe(MAPS3D.mirewood_fields.spawns.length);
    expect(flat(e.pet!, e.player)).toBeLessThan(200);
  });
});

describe("live 3D combat against the real server rules", () => {
  it("kills a slime by holding attack, and the server accepts the report", async () => {
    const { e, run, reports, store, p, clock } = await setup("mirewood_fields", 4, 30);
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    faceOff(e, slime, 60);
    // facing a bit away: the attack turns you toward it
    e.player.yaw += 0.6;
    e.held.attack = true;
    for (let i = 0; i < 200 && !reports.some((r) => r.type === "kill"); i++) run(100);
    e.held.attack = false;
    const kill = reports.find((r) => r.type === "kill")!;
    expect(kill).toBeTruthy();
    expect(kill.monsterId).toBe("green_slime");
    const res = await game.liveReport(store, p.id, kill, seeded(), clock() + 1000);
    expect(res.rewards?.exp).toBeGreaterThan(0);
  });

  it("swinging at a monster far behind you does nothing", async () => {
    const { e, run, reports } = await setup("mirewood_fields", 4, 30);
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    faceOff(e, slime, 500);
    e.player.yaw += Math.PI;
    e.held.attack = true;
    run(1500);
    e.held.attack = false;
    expect(slime.hp).toBe(slime.maxHp);
    expect(reports.some((r) => r.hits.length > 0)).toBe(false);
  });

  it("a well-timed block parries: no damage, the monster is stunned", async () => {
    const { e, run } = await setup("mirewood_fields", 4, 30);
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    faceOff(e, slime, 70);
    slime.aggro = true;
    slime.provoked = true;
    slime.nextAttackAt = 0;
    run(20);
    expect(slime.state).toBe("windup");
    const hp = e.player.hp;
    const until = slime.stateUntil;
    while (e.now < until - 100) run(16);
    e.held.block = true;
    run(300);
    expect(e.player.hp).toBe(hp);
    expect(slime.state).toBe("stunned");
  });

  it("holding block too early only blocks", async () => {
    const { e, run } = await setup("mirewood_fields", 4, 30, seeded(5));
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    faceOff(e, slime, 70);
    slime.aggro = true;
    slime.provoked = true;
    slime.nextAttackAt = 0;
    e.held.block = true;
    run(1200);
    expect(slime.state).not.toBe("stunned");
  });

  it("stepping aside during a wind-up dodges the blow", async () => {
    const { e, run } = await setup("mirewood_fields", 4, 30);
    const wolf = e.monsters.find((m) => m.id === "thorn_wolf")!;
    faceOff(e, wolf, 90);
    wolf.aggro = true;
    wolf.provoked = true;
    wolf.nextAttackAt = 0;
    run(20);
    expect(wolf.state).toBe("windup");
    const hp = e.player.hp;
    // jump far to the side of where it aimed
    e.player.z += 260;
    while (wolf.state === "windup") run(16);
    expect(e.player.hp).toBe(hp);
  });

  it("falling in a fight sends a death report the server accepts", async () => {
    const { e, run, reports, store, p, clock } = await setup("mirewood_fields", 4, 30);
    e.player.hp = 1;
    const wolf = e.monsters.find((m) => m.id === "thorn_wolf")!;
    faceOff(e, wolf, 80);
    wolf.aggro = true;
    wolf.nextAttackAt = 0;
    for (let i = 0; i < 100 && !e.player.dead; i++) run(100);
    expect(e.player.dead).toBe(true);
    const death = reports.find((r) => r.type === "death")!;
    expect(death.hp).toBe(0);
    await expect(game.liveReport(store, p.id, death, seeded(), clock() + 1000)).resolves.toBeTruthy();
  });

  it("standing in the swamp hurts every 2 seconds", async () => {
    const c = MAPS3D.mirewood_fields.swamp[0];
    const { e, run } = await setup("mirewood_fields", c.x, c.z);
    e.monsters = [];
    const hp = e.player.hp;
    run(4100);
    expect(e.player.inSwamp).toBe(true);
    expect(hp - e.player.hp).toBeGreaterThanOrEqual(8);
  });

  it("the dungeon gate stays shut until the room is cleared", async () => {
    const { e, run } = await setup("hollow_of_the_mire", 3, 6);
    e.run = { room: 0, totalRooms: 4, cleared: false };
    e.held.mx = 1;
    run(8000);
    expect(e.player.x).toBeLessThan(19 * TILE);
    expect(e.monsters.some((m) => m.id === "mire_bat")).toBe(true);
    e.setRun({ room: 1, totalRooms: 4, cleared: false });
    e.monsters = [];
    run(3000);
    expect(e.player.x).toBeGreaterThan(19 * TILE);
  });

  it("monsters chase you across open ground and stay near home when you leave", async () => {
    const { e, run } = await setup("mirewood_fields", 4, 30);
    const wolf = e.monsters.find((m) => m.id === "thorn_wolf")!;
    e.monsters = [wolf];
    e.player.x = wolf.x + 200;
    e.player.z = wolf.z + 120;
    e.player.hp = 99999;
    e.player.maxHp = 99999;
    const d0 = flat(wolf, e.player);
    run(300);
    expect(wolf.aggro).toBe(true);
    expect(flat(wolf, e.player)).toBeLessThan(d0);
    // run far away: it gives up and doesn't follow past its leash
    e.player.x = wolf.home.x + 3000;
    run(4000);
    expect(wolf.aggro).toBe(false);
    expect(Math.hypot(wolf.x - wolf.home.x, wolf.z - wolf.home.z)).toBeLessThanOrEqual(wolf.home.r + 6 * TILE + 1);
  });

  it("a ranged shot flies at the monster in front and hits it", async () => {
    const { e, run, reports } = await setup("mirewood_fields", 4, 30, seeded(3), "ranger");
    expect(e.weapon).toBe("bow");
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    faceOff(e, slime, 300);
    e.held.attack = true;
    run(1200);
    e.held.attack = false;
    expect(slime.hp).toBeLessThan(slime.maxHp);
    e.flush();
    expect(reports.some((r) => r.hits.some((h) => !h.miss))).toBe(true);
  });

  it("the Hollow's rooms spawn in order and the boss is Mirefang", async () => {
    const { e, run } = await setup("hollow_of_the_mire", 3, 6);
    e.run = { room: 3, totalRooms: 4, cleared: false };
    e.player.x = 50 * TILE;
    e.player.hp = 99999;
    e.player.maxHp = 99999;
    run(100);
    const boss = e.monsters.find((m) => m.id === "mirefang");
    expect(boss).toBeTruthy();
    expect(boss!.room).toBeTruthy();
  });
});

describe("taming in 3D", () => {
  it("a weak Green Slime you ate next to can be tamed with the wand, and the server adds the pet", async () => {
    const { e, run, reports, store, p, clock } = await setup("mirewood_fields", 4, 30, seeded(), "tamer");
    expect(e.weapon).toBe("tamer_wand");
    const slime = e.monsters.find((m) => m.id === "green_slime")!;
    faceOff(e, slime, 70);
    // hurt it with the wand until it's weak
    e.held.attack = true;
    for (let i = 0; i < 300 && slime.hp / slime.maxHp >= 0.3 && slime.state !== "dead"; i++) run(50);
    e.held.attack = false;
    expect(slime.state).not.toBe("dead");
    expect(e.tameTarget()).toBeNull(); // not yet: you haven't eaten next to it
    await store.changeItem(p.id, "rabbit_meat", 1);
    e.bag.push({ itemId: "rabbit_meat", qty: 1 });
    e.player.hp = Math.max(1, e.player.hp - 5);
    e.eatBest();
    expect(e.tameTarget()).toBe(slime);
    expect(e.nearby()).toMatchObject({ kind: "tame" });
    expect(e.tame(slime)).toBe(true);
    const tame = reports.find((r) => r.type === "tame")!;
    expect(tame.monsterId).toBe("green_slime");
    for (const r of reports) await game.liveReport(store, p.id, r, seeded(), clock() + 1000);
    const st = await game.getState(store, p.id);
    expect(st.pets.some((x) => x.species === "green_slime")).toBe(true);
    void run;
  });
});
