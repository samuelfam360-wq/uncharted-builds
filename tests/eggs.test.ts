import { describe, expect, it } from "vitest";
import { TILE } from "../src/lib/game/data/sidemaps";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, maxHit } from "../src/lib/game/live";
import { BOSS_EGG_MS, EGG_SWAMP_MS, petCap, petStats, newPet } from "../src/lib/game/pets";
import * as game from "../src/lib/game/service";
import type { MemoryStore } from "../src/lib/store/memory";
import { blank, engineSetup, hit, newPlayer, seeded } from "./helpers";

const HOLLOW = "hollow_of_the_mire";

/** Walk into Mirefang's room at `roomAt`, then beat her with a report sent at `killAt`. */
async function beatMirefang(store: MemoryStore, playerId: string, roomAt: number, killAt: number) {
  const st = await game.getState(store, playerId);
  const cap = maxHit(attackSpec(st.player.weapon, st.combat), st.combat);
  await game.liveEnter(store, playerId, HOLLOW, roomAt - 120_000);
  await store.applyCounters(playerId, {
    [`run_${HOLLOW}_room`]: { op: "set", value: 3 },
    [`run_${HOLLOW}_room_t`]: { op: "set", value: roomAt },
    live_t: { op: "set", value: killAt - 120_000 },
  });
  const pl = (await store.getPlayer(playerId))!;
  pl.currentHp = 9999;
  await store.savePlayer(pl);
  const hp = MONSTERS.mirefang.stats.HP;
  const hits = Array.from({ length: Math.ceil(hp / cap) }, () => hit(cap));
  return game.liveReport(
    store,
    playerId,
    blank(HOLLOW, { type: "kill", monsterId: "mirefang", hits, directToTarget: hits.length * cap, hitsOnTarget: hits.length, hp: 9999 }),
    seeded(),
    killAt,
  );
}

const swamp = (store: MemoryStore, id: string, ms: number, at: number) => game.liveReport(store, id, blank("mirewood_fields", { swampMs: ms }), seeded(), at);

describe("Mirefang's Egg", () => {
  it("a baby boss pet starts at 10% of the boss and grows to 50%", () => {
    const pet = newPet("mirefang", "x");
    expect(petStats(pet)).toEqual({ HP: 42, STR: 3, VIT: 2, AGI: 1, DEX: 2, INT: 1 });
    expect(petCap("mirefang", "HP")).toBe(210);
    expect(petCap("mirefang", "STR")).toBe(14);
  });

  it("beating her within 5 minutes of reaching her room gives the egg, once", async () => {
    const { store, p } = await newPlayer("swordsman", { STR: 3, HP: 2 });
    const t = Date.now();
    // too slow: no egg
    let r = await beatMirefang(store, p.id, t - BOSS_EGG_MS - 60_000, t);
    expect(r.egg).toBeNull();
    expect((await game.getState(store, p.id)).eggs).toEqual([]);
    // fast enough
    r = await beatMirefang(store, p.id, t + 1_000_000, t + 1_000_000 + 4 * 60_000);
    expect(r.egg).toBe("mirefang");
    expect(r.log.join(" ")).toContain("You found Mirefang's Egg!");
    const st = await game.getState(store, p.id);
    expect(st.eggs).toEqual([{ boss: "mirefang", name: "Mirefang's Egg", pct: null, hatch: null, needs: null }]);
    // only ever one per player
    r = await beatMirefang(store, p.id, t + 3_000_000, t + 3_000_000 + 60_000);
    expect(r.egg).toBeNull();
  });

  it("carried through the swamp for 10 minutes, it hatches for someone with Taming mastery", async () => {
    const { store, p } = await newPlayer("swordsman", { STR: 3, HP: 2 });
    const t0 = Date.now();
    await beatMirefang(store, p.id, t0, t0 + 60_000);
    let t = t0 + 200_000;
    await game.liveEnter(store, p.id, "mirewood_fields", t);
    // more swamp time than time passed is refused
    await expect(swamp(store, p.id, 60_000, t + 10_000)).rejects.toThrow(/swamp/);
    // 8 minutes in the swamp: the condition shows
    for (let i = 0; i < 4; i++) await swamp(store, p.id, 120_000, (t += 120_000));
    let egg = (await game.getState(store, p.id)).eggs[0];
    expect(egg.pct).toBeCloseTo(0.8);
    expect(egg.hatch).toContain("poison swamp");
    expect(egg.needs).toBe("Taming mastery level 2");
    // 10 minutes, but no Taming mastery yet: it waits
    await swamp(store, p.id, 120_000, (t += 120_000));
    egg = (await game.getState(store, p.id)).eggs[0];
    expect(egg.pct).toBe(1);
    expect((await game.getState(store, p.id)).pets).toEqual([]);
    // with Taming mastery it hatches at the next report
    await store.applyCounters(p.id, { mxp_taming: { op: "set", value: 100 } });
    const r = await swamp(store, p.id, 0, (t += 5_000));
    expect(r.tamed).toMatchObject({ species: "mirefang", level: 1, active: true });
    expect(r.log.join(" ")).toContain("Mirefang's Egg hatched!");
    const st = await game.getState(store, p.id);
    expect(st.eggs).toEqual([]);
    expect(st.pets).toHaveLength(1);
    expect(st.pets[0].caps.HP).toBe(210);
    expect((await store.getCounters(p.id)).eggs_hatched).toBe(1);
    void EGG_SWAMP_MS;
  });

  it("the game counts the time you stand in the swamp", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", [], "swordsman");
    e.monsters = [];
    e.player.x = 58 * TILE;
    e.player.hp = e.player.maxHp = 1e6;
    run(6000);
    e.flush();
    const ms = reports.reduce((n, r) => n + (r.swampMs ?? 0), 0);
    expect(ms).toBeGreaterThan(5000);
    expect(ms).toBeLessThanOrEqual(6100);
  });
});
