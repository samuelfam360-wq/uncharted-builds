import { describe, expect, it } from "vitest";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, maxHit } from "../src/lib/game/live";
import { skillDefinitionSchema } from "../src/lib/game/schema";
import * as game from "../src/lib/game/service";
import type { WeaponType } from "../src/lib/game/types";
import type { MemoryStore } from "../src/lib/store/memory";
import { blank, engineSetup, faceOff, give, hit, newPlayer, seeded } from "./helpers";

async function hold(store: MemoryStore, playerId: string, weapon: WeaponType) {
  const p = (await store.getPlayer(playerId))!;
  p.weapon = weapon;
  p.ownedWeapons = [...new Set([...p.ownedWeapons, weapon])];
  await store.savePlayer(p);
}

describe("Dagger, Hammer, Fists, Gun and Bow skills: data", () => {
  it("all are valid, and the ones waiting on missing systems are off", () => {
    for (const s of MASTERY_SKILLS) expect(skillDefinitionSchema.safeParse(s).success, s.id).toBe(true);
    const off = MASTERY_SKILLS.filter((s) => !s.enabled).map((s) => s.id);
    expect(off.sort()).toEqual(
      [
        ...["bending_shot", "broken_blade", "empty_vessel", "final_round", "full_swing", "heavens_draw", "last_arrow", "pressure_point", "ricochet", "titans_defiance"],
        ...["storm_sovereign", "divine_blessing", "purify", "curse_ward", "hallowed_soul", "skewer"],
      ].sort(),
    );
    const on = MASTERY_SKILLS.filter((s) => s.enabled).map((s) => s.name);
    for (const n of [
      "Silent Finish",
      "Phantom Legion",
      "Thousand Needles",
      "Shadow Walk",
      "Phantom Verdict",
      "Armor Crusher",
      "Quake Slam",
      "Ringing Blow",
      "Anvil Breaker",
      "Seven Strikes",
      "Breath Control",
      "Heavenly Palm",
      "Quick Draw",
      "Dead Man's Hand",
      "High Noon",
      "Hawk Line",
      "Marked Prey",
    ])
      expect(on).toContain(n);
  });
});

describe("unlock counters are kept per weapon", () => {
  it("dagger crits, hammer hits, fists combos, pistol quick draws and bow far hits only count with that weapon", async () => {
    const { store, p } = await newPlayer("assassin", { AGI: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const report = () =>
      blank("mirewood_fields", { hits: [hit(1, { crit: true }), hit(1)], combos7: 0, quickDraws: 1, farHits: 1 });
    await game.liveReport(store, p.id, report(), seeded(), t);
    let c = await store.getCounters(p.id);
    expect(c.crits_daggers).toBe(1);
    expect(c.hits_daggers).toBe(2);
    expect(c.quick_draw_wins ?? 0).toBe(0);
    expect(c.max_range_hits ?? 0).toBe(0);
    await hold(store, p.id, "pistol");
    await game.liveReport(store, p.id, report(), seeded(), t + 10_000);
    await hold(store, p.id, "bow");
    await game.liveReport(store, p.id, report(), seeded(), t + 20_000);
    await hold(store, p.id, "hammer");
    await game.liveReport(store, p.id, report(), seeded(), t + 30_000);
    c = await store.getCounters(p.id);
    expect([c.crits_daggers, c.quick_draw_wins, c.max_range_hits, c.hits_hammer]).toEqual([1, 1, 1, 2]);
  });

  it("kills by a skill are counted for that skill (Quake Slam's unlock)", async () => {
    const { store, p } = await newPlayer();
    await give(store, p.id, "ground_slam");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const pl = (await store.getPlayer(p.id))!;
    pl.currentMp = 100;
    await store.savePlayer(pl);
    const r = blank("mirewood_fields", {
      type: "kill",
      monsterId: "green_slime",
      hits: [hit(20, { skillId: "ground_slam" }), hit(20, { skillId: "ground_slam" })],
      skillUses: { ground_slam: 1 },
      directToTarget: 40,
      hitsOnTarget: 2,
      killSkill: "ground_slam",
      mp: 0,
    });
    await game.liveReport(store, p.id, r, seeded(), t);
    expect((await store.getCounters(p.id)).skill_kills_ground_slam).toBe(1);
  });

  it("refuses impossible counts", async () => {
    const { store, p } = await newPlayer();
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 10_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { escapes: 10 }), seeded(), t)).rejects.toThrow("Too many fights");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { phantomFights: 3, dodged: 50 }), seeded(), t)).rejects.toThrow("Not enough dodges");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { stunsDealt: 3, hits: [hit(1)] }), seeded(), t)).rejects.toThrow("More stuns");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { combos7: 2, hits: [hit(1)] }), seeded(), t)).rejects.toThrow("don't add up");
  });
});

describe("the server's checks on the new hits", () => {
  it("Silent Finish: 3x from hiding, +1x per stealth kill in a row, never beyond what the chain allows", async () => {
    const { store, p } = await newPlayer("assassin", { AGI: 3, HP: 2, STR: 0 });
    await give(store, p.id, "silent_finish");
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("daggers", st.combat), st.combat);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(cap * 3 + 5, { stealth: 3 })] }), seeded(), t)).rejects.toThrow("bigger");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(5, { stealth: 4 })] }), seeded(), t)).rejects.toThrow("stealth chain");
    // a stealth kill grows the chain to 1, so 4x is allowed next
    const kill = blank("mirewood_fields", { type: "kill", monsterId: "horned_rabbit", hits: [hit(32, { stealth: 3 })], directToTarget: 32, hitsOnTarget: 1 });
    if (32 > cap * 3) kill.hits[0].dmg = cap * 3; // keep it legal whatever the stats
    kill.directToTarget = kill.hits[0].dmg;
    kill.indirectToTarget = 32 - kill.hits[0].dmg;
    await game.liveReport(store, p.id, kill, seeded(), t);
    expect((await store.getCounters(p.id)).stealth_chain).toBe(1);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(5, { stealth: 4 })] }), seeded(), t + 1000)).resolves.toBeTruthy();
    // that hit didn't kill: the chain is over
    expect((await store.getCounters(p.id)).stealth_chain).toBe(0);
  });

  it("Seven Strikes: only one 7x finisher per 7 hits", async () => {
    const { store, p } = await newPlayer("monk", { STR: 3, HP: 2 });
    await give(store, p.id, "seven_strikes");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const seven = [...Array.from({ length: 6 }, () => hit(1)), hit(30, { combo7: true })];
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: seven, combos7: 1 }), seeded(), t)).resolves.toBeTruthy();
    expect((await store.getCounters(p.id)).combos_7).toBe(1);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(1, { combo7: true }), hit(1, { combo7: true })] }), seeded(), t + 1000)).rejects.toThrow(
      "combo finishers",
    );
  });

  it("Phantom Legion clones hit for 30% at most, and only after dodges", async () => {
    const { store, p } = await newPlayer("assassin", { AGI: 3, HP: 2 });
    await give(store, p.id, "phantom_legion");
    const st = await game.getState(store, p.id);
    const cap = Math.ceil(maxHit(attackSpec("daggers", st.combat), st.combat) * 0.3) + 1;
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const clone = (dmg: number) => hit(dmg, { skillId: "phantom_legion" });
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [clone(1)] }), seeded(), t)).rejects.toThrow("More clone hits");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { dodged: 1, hits: [clone(cap + 1)] }), seeded(), t)).rejects.toThrow("bigger");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { dodged: 1, hits: [clone(cap)] }), seeded(), t)).resolves.toBeTruthy();
  });

  it("Shadow Walk can only be used once every 10 minutes", async () => {
    const { store, p } = await newPlayer("assassin", { AGI: 3, HP: 2 });
    await give(store, p.id, "shadow_walk");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await game.liveReport(store, p.id, blank("mirewood_fields", { skillUses: { shadow_walk: 1 } }), seeded(), t);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { skillUses: { shadow_walk: 1 } }), seeded(), t + 60_000)).rejects.toThrow("cooldown");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { skillUses: { shadow_walk: 1 } }), seeded(), t + 600_000)).resolves.toBeTruthy();
  });

  it("Anvil Breaker's gauge is hammer hits on the boss, and those hits unlock it", async () => {
    const { store, p } = await newPlayer("blacksmith", { DEX: 3, HP: 2 });
    await give(store, p.id, "anvil_breaker");
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 600_000);
    const bossHits = (n: number) => ({ hits: Array.from({ length: n }, () => hit(1)), boss: { hits: 0, parries: 0, parryDmg: 0, dodges: 0, weaponHits: n, dmg: n, mp: 0, healed: 0, charges: 0 } });
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", bossHits(50)), seeded(), t - 500_000);
    const c = await store.getCounters(p.id);
    expect(c.boss_fight_hits_hammer_best).toBe(50);
    expect(c.boss_fight_hammer_dmg_best).toBe(50);
    await expect(
      game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [hit(210, { skillId: "anvil_breaker", ult: 1 })] }), seeded(), t - 400_000),
    ).resolves.toBeTruthy();
    // more boss hits than hits landed is refused
    await expect(
      game.liveReport(store, p.id, blank("hollow_of_the_mire", { boss: { hits: 0, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 1, dmg: 0, mp: 0, healed: 0, charges: 0 } }), seeded(), t),
    ).rejects.toThrow("don't add up");
  });

  it("Breath Control lets HP come back during long fights", async () => {
    const { store, p } = await newPlayer("monk", { STR: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await game.liveReport(store, p.id, blank("mirewood_fields", { hp: 5 }), seeded(), t - 60_000);
    await game.liveReport(store, p.id, blank("mirewood_fields", { hp: 30 }), seeded(), t - 30_000);
    expect((await game.getState(store, p.id)).player.currentHp).toBe(5);
    await give(store, p.id, "breath_control");
    await game.liveReport(store, p.id, blank("mirewood_fields", { hp: 30 }), seeded(), t);
    expect((await game.getState(store, p.id)).player.currentHp).toBeGreaterThan(5);
  });
});

describe("the new skills in the live game", () => {
  it("Silent Finish: a first hit from hiding does 3x, a kill hides you, and the server accepts it", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["silent_finish"], "assassin");
    const m = e.monsters.find((x) => x.id === "green_slime")!;
    m.hp = 1;
    e.player.x = m.x - 60;
    e.player.y = m.y;
    e.player.facing = 1;
    m.span = [m.x, m.x];
    m.aggro = false;
    m.provoked = false;
    e.held.attack = true;
    for (let i = 0; i < 100 && !reports.some((r) => r.type === "kill"); i++) run(16);
    e.held.attack = false;
    const kill = reports.find((r) => r.type === "kill")!;
    expect(kill.hits.find((h) => !h.miss)).toMatchObject({ stealth: 3 });
    expect(e.stealthChain).toBe(1);
    expect(e.player.invisibleUntil).toBeGreaterThan(e.now);
    // the slime only had 1 HP left here, so tell the server the rest was poison
    kill.indirectToTarget = MONSTERS.green_slime.stats.HP;
    await game.liveReport(store, p.id, kill, seeded(), clock() + 60_000);
  });

  it("Seven Strikes: the 7th fist hit in a combo is the finisher", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", ["seven_strikes"], "monk");
    expect(e.weapon).toBe("strength_bracelet");
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.held.attack = true;
    run(6000);
    e.held.attack = false;
    e.flush();
    const hits = reports.flatMap((r) => r.hits);
    const finishers = hits.filter((h) => h.combo7);
    expect(finishers.length).toBeGreaterThan(0);
    // every finisher follows 6 landed hits in a row
    let run7 = 0;
    for (const h of hits) {
      if (h.miss) run7 = 0;
      else if (++run7 === 7) {
        expect(h.combo7).toBe(true);
        run7 = 0;
      } else expect(h.combo7).toBeFalsy();
    }
  });

  it("Phantom Legion: a dodge leaves a clone that fights, and the server accepts its hits", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["phantom_legion"], "assassin", seeded(3));
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    // force a dodge: this monster can't hit
    (e as unknown as { rng: () => number }).rng = () => 0.999;
    for (let i = 0; i < 300 && e.clones.length === 0; i++) run(16);
    expect(e.clones.length).toBe(1);
    m.nextAttackAt = 1e12;
    run(3000);
    e.flush();
    const cloneHits = reports.flatMap((r) => r.hits).filter((h) => h.skillId === "phantom_legion");
    expect(cloneHits.length).toBeGreaterThan(1);
    for (const r of reports) await game.liveReport(store, p.id, r, seeded(), clock() + 60_000);
  });

  it("Thousand Needles: 10 crit stacks finish a normal monster", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", ["thousand_needles"], "assassin");
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e5;
    m.nextAttackAt = 1e12;
    (e as unknown as { rng: () => number }).rng = () => 0.001; // every hit lands and crits
    e.held.attack = true;
    for (let i = 0; i < 2000 && m.state !== "dead"; i++) run(16);
    e.held.attack = false;
    expect(m.state).toBe("dead");
    const kill = reports.find((r) => r.type === "kill")!;
    expect(kill.indirectToTarget).toBeGreaterThan(50_000);
  });

  it("Shadow Walk: invisible and behind the monster, then a 10 minute wait", async () => {
    const { e, run } = await engineSetup("mirewood_fields", ["shadow_walk"], "assassin");
    const m = faceOff(e, "bog_toad");
    m.facing = -1; // looking at the player
    e.press("skill0");
    run(16);
    expect(e.player.invisibleUntil).toBeGreaterThan(e.now + 4000);
    expect(e.player.x).toBeGreaterThan(m.x);
    expect(e.skillState(0)!.cdLeft).toBeGreaterThan(590_000);
  });

  it("Quake Slam knocks down everything around a Ground Slam; Ringing Blow keeps them down longer", async () => {
    const { e, run } = await engineSetup("mirewood_fields", ["ground_slam", "quake_slam", "ringing_blow"], "blacksmith");
    e.player.mp = e.player.maxMp = 100;
    const m = faceOff(e, "bog_toad");
    m.nextAttackAt = 1e12;
    const i = e.skillSlots.findIndex((s) => s.id === "ground_slam");
    e.press(`skill${i}` as "skill0");
    run(16);
    expect(m.state).toBe("stunned");
    expect(m.stateUntil - e.now).toBeGreaterThan(1900);
  });

  it("Armor Crusher wears defense down with each hammer hit", async () => {
    const { e, run } = await engineSetup("mirewood_fields", ["armor_crusher"], "blacksmith");
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.held.attack = true;
    run(4000);
    expect(m.defDown).toBeGreaterThan(0.05);
    run(60_000);
    expect(m.defDown).toBe(0.5);
  });

  it("Hawk Line shoots farther; far shots count toward it", async () => {
    const { e, run, reports, store, p } = await engineSetup("mirewood_fields", ["hawk_line"], "ranger");
    expect(e.weapon).toBe("bow");
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.player.x = m.x - 700; // far enough that the arrow is still flying
    e.monsters = e.monsters.filter((x) => x === m); // nothing else to aim at
    e.held.attack = true;
    run(150);
    e.held.attack = false;
    expect(e.projectiles[0].range).toBeGreaterThan(600);
    run(1000);
    expect(m.hp).toBeLessThan(1e6);
    expect((e as unknown as { acc: { farHits: number } }).acc.farHits).toBeGreaterThan(0);
    void store;
    void p;
    void reports;
  });

  it("fights you get away from count as escapes, once per monster", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", []);
    const m = faceOff(e, "bog_toad");
    m.nextAttackAt = 1e12;
    // nothing else may wander in and keep the fight going
    e.monsters = e.monsters.filter((x) => x === m);
    e.held.attack = true;
    run(400);
    e.held.attack = false;
    // run far away
    m.x = e.player.x + 3000;
    m.span = [m.x, m.x];
    m.aggro = false;
    run(5500);
    e.flush();
    expect(reports.reduce((n, r) => n + r.escapes, 0)).toBe(1);
  });
});
