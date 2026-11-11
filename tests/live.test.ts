import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/lib/store/memory";
import * as game from "../src/lib/game/service";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, cleanReport, maxHit, rollHit, type LiveReport, type ReportHit } from "../src/lib/game/live";

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const blank = (zoneId: string, extra: Partial<LiveReport> = {}): LiveReport => ({
  type: "sync",
  zoneId,
  hits: [],
  skillUses: {},
  itemsUsed: [],
  taken: { enemy: 0, hazard: 0, poison: 0, burn: 0 },
  dodged: 0,
  dodgeStreak: 0,
  dodgeStreakBest: 0,
  blocks: 0,
  parries: 0,
  blockedDamage: 0,
  zeroHits: 0,
  statuses: [],
  swampTicks: 0,
  inSwamp: false,
  minHpPct: 1,
  hp: 0,
  mp: 0,
  hitsTaken: 0,
  hitStreak: 0,
  guardStored: 0,
  boss: { hits: 0, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0 },
  bossEnd: false,
  stormFights: 0,
  phantomFights: 0,
  escapes: 0,
  stunsDealt: 0,
  combos7: 0,
  spellsTaken: 0,
  spellsAbsorbed: 0,
  lowHpHeals: 0,
  healed: 0,
  drained: 0,
  bloodUses: {},
  cleanFights: 0,
  quickDraws: 0,
  farHits: 0,
  markedRuns: 0,
  ...extra,
});

/** Swing at a monster with the shared math until it drops, like the browser does. */
async function fightLegit(store: MemoryStore, playerId: string, zoneId: string, monsterId: string, rng = seeded()) {
  const st = await game.getState(store, playerId);
  const a = { stats: st.combat.stats, passive: st.combat.passive };
  const spec = attackSpec(st.player.weapon, a);
  const m = MONSTERS[monsterId];
  const hits: ReportHit[] = [];
  let hp = m.stats.HP;
  let direct = 0;
  let onTarget = 0;
  while (hp > 0 && hits.length < 500) {
    const r = rollHit(rng, spec, a, { VIT: m.stats.VIT, INT: m.stats.INT, AGI: m.stats.AGI }, 1);
    hits.push({ dmg: r.dmg, crit: r.crit, miss: r.miss });
    onTarget++;
    hp -= r.dmg;
    direct += r.dmg;
  }
  return blank(zoneId, {
    type: "kill",
    monsterId,
    hits,
    directToTarget: direct,
    hitsOnTarget: onTarget,
    fightMs: hits.length * 500,
    hp: st.player.currentHp,
    mp: st.player.currentMp,
  });
}

async function newHero(store: MemoryStore, classId: "swordsman" | "mage" = "swordsman") {
  return game.createCharacter(store, { name: "Rin", classId, stats: { STR: 3, HP: 2 } });
}

describe("live fights", () => {
  it("a fair kill gives EXP, gold and counts toward weapon habits", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    const t0 = 1_000_000;
    await game.liveEnter(store, p.id, "mirewood_fields", t0);
    const rep = await fightLegit(store, p.id, "mirewood_fields", "green_slime");
    const r = await game.liveReport(store, p.id, rep, seeded(1), t0 + 60_000);
    expect(r.rewards?.exp).toBe(MONSTERS.green_slime.exp);
    const st = await game.getState(store, p.id);
    expect(st.player.exp).toBe(MONSTERS.green_slime.exp);
    expect(st.player.gold).toBe(p.gold + MONSTERS.green_slime.gold);
    const c = await store.getCounters(p.id);
    expect(c.kills_sword).toBe(1);
    expect(c.defeated_green_slime).toBe(1);
    expect(c.attacks_made).toBe(rep.hits.length);
  });

  it("refuses a hit bigger than the best possible roll", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.liveEnter(store, p.id, "mirewood_fields", 0);
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec(st.player.weapon, st.combat), st.combat);
    const rep = blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: [{ dmg: cap + 50, crit: true, miss: false }], directToTarget: cap + 50, hitsOnTarget: 1, hp: st.player.currentHp });
    await expect(game.liveReport(store, p.id, rep, seeded(), 60_000)).rejects.toThrow(/bigger than possible/);
  });

  it("refuses more swings than time allows", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.liveEnter(store, p.id, "mirewood_fields", 0);
    const hits = Array.from({ length: 40 }, () => ({ dmg: 1, crit: false, miss: false }));
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits, hp: 1 }), seeded(), 1000)).rejects.toThrow(/Too many hits/);
  });

  it("refuses a kill that didn't do enough damage, or in the wrong place", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.liveEnter(store, p.id, "mirewood_fields", 0);
    const weak = blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: [{ dmg: 3, crit: false, miss: false }], directToTarget: 3, hitsOnTarget: 1 });
    await expect(game.liveReport(store, p.id, weak, seeded(), 60_000)).rejects.toThrow(/wasn't defeated/);
    const rep = await fightLegit(store, p.id, "mirewood_fields", "green_slime");
    await expect(game.liveReport(store, p.id, { ...rep, monsterId: "mirefang" }, seeded(), 120_000)).rejects.toThrow();
    await expect(game.liveReport(store, p.id, { ...rep, zoneId: "thornvale" }, seeded(), 180_000)).rejects.toThrow(/nothing to fight/);
    await expect(game.liveReport(store, p.id, { ...rep, directToTarget: 9999 }, seeded(), 240_000)).rejects.toThrow(/more damage than you dealt/);
  });

  it("refuses skills that aren't equipped", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.liveEnter(store, p.id, "mirewood_fields", 0);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { skillUses: { twin_cut: 1 } }), seeded(), 10_000)).rejects.toThrow(/isn't equipped/);
  });

  it("HP can only go up through food or heals, and food is used up", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.liveEnter(store, p.id, "mirewood_fields", 0);
    const max = (await game.getState(store, p.id)).derived.maxHp;
    let r = await game.liveReport(store, p.id, blank("mirewood_fields", { hp: 10, taken: { enemy: max - 10, hazard: 0, poison: 0, burn: 0 } }), seeded(), 10_000);
    expect(r.hp).toBe(10);
    r = await game.liveReport(store, p.id, blank("mirewood_fields", { hp: max }), seeded(), 20_000);
    expect(r.hp).toBe(10); // no free healing
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hp: 40, itemsUsed: ["rabbit_meat"] }), seeded(), 30_000)).rejects.toThrow(/don't have/);
    await store.changeItem(p.id, "rabbit_meat", 1);
    r = await game.liveReport(store, p.id, blank("mirewood_fields", { hp: 40, itemsUsed: ["rabbit_meat"] }), seeded(), 40_000);
    expect(r.hp).toBe(40);
    expect(await store.getInventory(p.id)).toEqual([]);
  });

  it("dying sends you home poorer and with 0 HP", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.liveEnter(store, p.id, "mirewood_fields", 0);
    const r = await game.liveReport(store, p.id, blank("mirewood_fields", { type: "death", monsterId: "thorn_wolf", hp: 0 }), seeded(), 10_000);
    expect(r.hp).toBe(0);
    const st = await game.getState(store, p.id);
    expect(st.player.gold).toBe(Math.floor(p.gold * 0.9));
    expect((await store.getCounters(p.id)).deaths).toBe(1);
  });

  it("the dungeon goes room by room, and a first-try solo clear claims the unique item", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    // A strong hero so the test is about the rules, not the grind.
    const pl = (await store.getPlayer(p.id))!;
    pl.stats.STR = 400;
    pl.stats.DEX = 200;
    pl.stats.HP = 100;
    pl.currentHp = 1100;
    await store.savePlayer(pl);
    let now = 0;
    const enter = await game.liveEnter(store, p.id, "hollow_of_the_mire", now);
    expect(enter.run).toEqual({ room: 0, totalRooms: 4, firstAttempt: true });
    // Skipping ahead to the boss is refused.
    const skip = await fightLegit(store, p.id, "hollow_of_the_mire", "mirefang");
    await expect(game.liveReport(store, p.id, skip, seeded(), (now += 60_000))).rejects.toThrow(/isn't in this room/);
    let last;
    for (const id of ["mire_bat", "moss_golem", "mire_bat", "mirefang"]) {
      const rep = await fightLegit(store, p.id, "hollow_of_the_mire", id);
      last = await game.liveReport(store, p.id, rep, seeded(3), (now += 60_000));
    }
    expect(last!.run).toEqual({ room: 4, totalRooms: 4, cleared: true });
    expect(last!.claimed).toBe("thornheart_mantle");
    const c = await store.getCounters(p.id);
    expect(c.cleared_hollow_of_the_mire).toBe(1);
    expect(c.bosses_defeated).toBe(1);
    // A second run is not a first attempt.
    const again = await game.liveEnter(store, p.id, "hollow_of_the_mire", (now += 1000));
    expect(again.run?.firstAttempt).toBe(false);
  });

  it("leaving the dungeon ends the attempt", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.liveEnter(store, p.id, "hollow_of_the_mire", 0);
    await game.liveEnter(store, p.id, "mirewood_fields", 1000);
    const rep = await fightLegit(store, p.id, "hollow_of_the_mire", "mire_bat");
    await expect(game.liveReport(store, p.id, rep, seeded(), 120_000)).rejects.toThrow(/Enter the dungeon first/);
  });

  it("habits still unlock hidden skills: 25 sword kills give Twin Cut", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    let now = 0;
    await game.liveEnter(store, p.id, "mirewood_fields", now);
    const unlocked: string[] = [];
    for (let i = 0; i < 25; i++) {
      await game.rest(store, p.id);
      const rep = await fightLegit(store, p.id, "mirewood_fields", "green_slime", seeded(100 + i));
      const r = await game.liveReport(store, p.id, rep, seeded(i), (now += 60_000));
      unlocked.push(...r.unlocks.map((u) => u.id));
    }
    expect(unlocked).toContain("twin_cut");
  });

  it("closes an old turn-based fight so it never blocks the live game", async () => {
    const store = new MemoryStore();
    const p = await newHero(store);
    await game.beginBattle(store, p.id, "mirewood_fields", seeded());
    await expect(game.rest(store, p.id)).rejects.toThrow();
    await game.liveEnter(store, p.id, "thornvale");
    await expect(game.rest(store, p.id)).resolves.toBeUndefined();
  });

  it("cleans junk reports", () => {
    const r = cleanReport({ type: "hack", hits: [{ dmg: -5 }, { dmg: "9" }, null], statuses: ["poison", "godmode"], hp: 1e12, minHpPct: 7 });
    expect(r.type).toBe("sync");
    expect(r.hits.map((h) => h.dmg)).toEqual([0, 0, 0]);
    expect(r.statuses).toEqual(["poison"]);
    expect(r.hp).toBe(1e9);
    expect(r.minHpPct).toBe(1);
  });
});
