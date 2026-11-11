import { describe, expect, it } from "vitest";
import type { Engine, Monster } from "../src/components/side/engine";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS } from "../src/lib/game/data/world";
import { CHARGE_FULL, attackSpec, maxHit, type BossTally, type LiveReport } from "../src/lib/game/live";
import * as game from "../src/lib/game/service";
import type { EnemyAttack } from "../src/lib/game/data/world";
import type { WeaponType } from "../src/lib/game/types";
import type { MemoryStore } from "../src/lib/store/memory";
import { blank, engineSetup, faceOff, give, hit, newPlayer, seeded } from "./helpers";

async function hold(store: MemoryStore, playerId: string, weapon: WeaponType) {
  const p = (await store.getPlayer(playerId))!;
  p.weapon = weapon;
  p.ownedWeapons = [...new Set([...p.ownedWeapons, weapon])];
  await store.savePlayer(p);
}

const tally = (t: Partial<BossTally>): BossTally => ({ hits: 0, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0, ...t });

/** Let a monster's attack land on the player right now (the engine keeps this private). */
const strike = (e: Engine, m: Monster, atk: EnemyAttack) => (e as unknown as { enemyStrikesPlayer(m: Monster, a: EnemyAttack): void }).enemyStrikesPlayer(m, atk);

/** Send every report to the server, oldest first. */
async function sendAll(store: MemoryStore, playerId: string, reports: LiveReport[], at: number) {
  for (const r of reports) await game.liveReport(store, playerId, r, seeded(), at);
}

describe("Staff, Holy and Lance skills: data", () => {
  it("uses the agreed names, and the ones waiting on missing systems are off", () => {
    const byName = new Map(MASTERY_SKILLS.map((s) => [s.name, s]));
    for (const n of ["Spell Thief", "Chain Catastrophe", "Blood Sorcery", "Star Fall", "Grace Rebound", "Soul Drain", "Judgment of Mercy", "Comet Charge", "Iron Momentum", "Sky Lance", "Dragonpiercer"])
      expect(byName.get(n)?.enabled, n).toBe(true);
    for (const n of ["Storm Sovereign", "Divine Blessing", "Purify", "Curse Ward", "Hallowed Soul", "Skewer"]) expect(byName.get(n)?.enabled, n).toBe(false);
  });
});

describe("unlock counters", () => {
  it("spells survived, low-HP heals, bracelet hits and lance charges are counted", async () => {
    const { store, p } = await newPlayer("saint", { MP: 3, HP: 2 });
    await give(store, p.id, "second_wind");
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 60_000);
    await game.liveReport(
      store,
      p.id,
      blank("hollow_of_the_mire", { hits: [hit(1), hit(1)], hitsTaken: 2, spellsTaken: 2, skillUses: { second_wind: 1 }, lowHpHeals: 1, mp: 0 }),
      seeded(),
      t,
    );
    let c = await store.getCounters(p.id);
    expect([c.spells_survived, c.low_hp_heals, c.hits_healing_bracelet]).toEqual([2, 1, 2]);
    // more spells than hits taken, or more low-HP heals than heals, is refused
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { hitsTaken: 1, spellsTaken: 2 }), seeded(), t + 1000)).rejects.toThrow("spells");
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { lowHpHeals: 1 }), seeded(), t + 1000)).rejects.toThrow("More heals");

    await hold(store, p.id, "lance");
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [hit(1, { charge: 0.6 }), hit(1, { charge: 1 })] }), seeded(), t + 10_000);
    c = await store.getCounters(p.id);
    expect(c.charges_done).toBe(2);
  });

  it("10 kills by one spell count once toward Chain Catastrophe; kills spread out don't", async () => {
    const { store, p } = await newPlayer("mage", { INT: 3, HP: 2 });
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("staff", st.combat), st.combat);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 600_000);
    const hp = MONSTERS.green_slime.stats.HP;
    const kill = (cast: number) => {
      const hits = Array.from({ length: Math.ceil(hp / cap) }, () => hit(cap));
      return blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits, directToTarget: hits.length * cap, hitsOnTarget: hits.length, killCast: cast });
    };
    for (let i = 0; i < 10; i++) await game.liveReport(store, p.id, kill(7), seeded(), t - 300_000 + i * 100);
    expect((await store.getCounters(p.id)).spell_multikills_10).toBe(1);
    // 10 more kills from one cast number, but too far apart in time
    for (let i = 0; i < 10; i++) await game.liveReport(store, p.id, kill(8), seeded(), t - 200_000 + i * 6000);
    expect((await store.getCounters(p.id)).spell_multikills_10).toBe(1);
  });

  it("boss fights track MP spent, HP healed and lance charges for the ultimates' unlocks", async () => {
    const { store, p } = await newPlayer("lancer", { STR: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 600_000);
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [hit(1, { charge: 1 })], boss: tally({ weaponHits: 1, dmg: 1, charges: 1 }) }), seeded(), t - 500_000);
    expect((await store.getCounters(p.id)).boss_fight_charge_hits_best).toBe(1);
    // charges on the boss can't outnumber charges landed, healing can't be more than you healed, MP more than you spent
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { boss: tally({ charges: 1 }) }), seeded(), t)).rejects.toThrow("don't add up");
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { boss: tally({ healed: 50 }) }), seeded(), t)).rejects.toThrow("don't add up");
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { boss: tally({ mp: 5 }) }), seeded(), t)).rejects.toThrow("don't add up");
  });
});

describe("the server's checks", () => {
  it("Spell Thief: a cast-back spell needs an absorbed spell and hits for 2x at most", async () => {
    const { store, p } = await newPlayer("mage", { INT: 3, HP: 2 });
    await give(store, p.id, "spell_thief");
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 60_000);
    const breath = MONSTERS.mirefang.attacks.find((a) => a.name === "Toxic Breath")!;
    const max = Math.ceil(MONSTERS.mirefang.stats.INT * breath.multiplier + (breath.piercing ?? 0)) * 2;
    const back = (dmg: number) => hit(dmg, { skillId: "spell_thief" });
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [back(5)] }), seeded(), t)).rejects.toThrow("absorbed");
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { spellsAbsorbed: 1, hits: [back(max + 5)] }), seeded(), t)).rejects.toThrow("bigger");
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { spellsAbsorbed: 1, hits: [back(max)] }), seeded(), t)).resolves.toBeTruthy();
    expect((await store.getCounters(p.id)).spells_survived).toBe(1);
  });

  it("Chain Catastrophe: explosions only after a spell kill, and only so many", async () => {
    const { store, p } = await newPlayer("mage", { INT: 3, HP: 2 });
    await give(store, p.id, "chain_catastrophe");
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("staff", st.combat), st.combat);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 600_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(1, { chain: true })] }), seeded(), t - 500_000)).rejects.toThrow("explosions");
    const hp = MONSTERS.green_slime.stats.HP;
    const hits = Array.from({ length: Math.ceil(hp / cap) }, () => hit(cap));
    await game.liveReport(store, p.id, blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits, directToTarget: hits.length * cap, hitsOnTarget: hits.length }), seeded(), t - 400_000);
    expect((await store.getCounters(p.id)).chain_bank).toBe(30);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(cap + 2, { chain: true })] }), seeded(), t - 300_000)).rejects.toThrow("bigger");
    await game.liveReport(store, p.id, blank("mirewood_fields", { hits: Array.from({ length: 30 }, () => hit(cap, { chain: true })) }), seeded(), t - 300_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(1, { chain: true })] }), seeded(), t - 200_000)).rejects.toThrow("explosions");
  });

  it("Blood Sorcery: HP-paid casts don't use MP and hit for 2x at most", async () => {
    const { store, p } = await newPlayer("mage", { INT: 3, HP: 2 });
    await give(store, p.id, "fireball");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t);
    const pl = (await store.getPlayer(p.id))!;
    pl.currentMp = 0;
    await store.savePlayer(pl);
    const st = await game.getState(store, p.id);
    const fireball = st.combat.skills.find((s) => s.id === "fireball")!;
    const cap = maxHit(attackSpec("staff", st.combat, { name: "Fireball", active: fireball.active }), st.combat);
    const blood = { skillUses: { fireball: 1 }, bloodUses: { fireball: 1 }, hits: [hit(cap * 2, { skillId: "fireball", blood: true })] };
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", blood), seeded(), t + 100)).rejects.toThrow("isn't equipped");
    await give(store, p.id, "blood_sorcery");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { ...blood, hits: [hit(cap * 2 + 5, { skillId: "fireball", blood: true })] }), seeded(), t + 100)).rejects.toThrow(
      "bigger",
    );
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", blood), seeded(), t + 100)).resolves.toBeTruthy();
    // without the blood tag the same cast needs MP the player doesn't have
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { skillUses: { fireball: 1 } }), seeded(), t + 200)).rejects.toThrow("Not enough MP");
  });

  it("Soul Drain: drained HP can be up to 25% of the damage dealt, and it raises the HP the server allows", async () => {
    const { store, p } = await newPlayer("saint", { MP: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t);
    const pl = (await store.getPlayer(p.id))!;
    pl.currentHp = 5;
    await store.savePlayer(pl);
    const hits = Array.from({ length: 8 }, () => hit(5));
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits, drained: 10, hp: 15 }), seeded(), t + 100)).rejects.toThrow("Drained");
    await give(store, p.id, "soul_drain");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits, drained: 12, hp: 15 }), seeded(), t + 100)).rejects.toThrow("Drained");
    await game.liveReport(store, p.id, blank("mirewood_fields", { hits, drained: 10, hp: 15 }), seeded(), t + 100);
    expect((await game.getState(store, p.id)).player.currentHp).toBe(15);
  });

  it("Grace Rebound: the server allows a tripled heal", async () => {
    const { store, p } = await newPlayer("saint", { MP: 3, HP: 2 });
    await give(store, p.id, "second_wind");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t);
    const pl = (await store.getPlayer(p.id))!;
    pl.currentHp = 1;
    await store.savePlayer(pl);
    const st = await game.getState(store, p.id);
    const heal = Math.round(st.derived.maxHp * 0.3);
    const report = () => blank("mirewood_fields", { skillUses: { second_wind: 1 }, hp: 1 + heal * 3, mp: 0 });
    await game.liveReport(store, p.id, report(), seeded(), t + 100);
    expect((await game.getState(store, p.id)).player.currentHp).toBe(1 + heal);
    pl.currentHp = 1;
    pl.currentMp = 30;
    await store.savePlayer({ ...(await store.getPlayer(p.id))!, currentHp: 1, currentMp: 30 });
    await give(store, p.id, "grace_rebound");
    await game.liveReport(store, p.id, report(), seeded(), t + 200);
    expect((await game.getState(store, p.id)).player.currentHp).toBe(Math.min(st.derived.maxHp, 1 + heal * 3));
  });

  it("charges: only with a lance, only after a long enough run, and Comet Charge allows up to 2x", async () => {
    const { store, p } = await newPlayer("lancer", { STR: 3, HP: 2 });
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("lance", st.combat), st.combat);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(1, { charge: 0.3 })] }), seeded(), t)).rejects.toThrow("charge");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(cap + 2, { charge: 1 })] }), seeded(), t)).rejects.toThrow("bigger");
    await give(store, p.id, "comet_charge");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(cap * 2, { charge: 1 })] }), seeded(), t)).resolves.toBeTruthy();
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(cap * 2, { charge: 0.5 })] }), seeded(), t + 10_000)).rejects.toThrow("bigger");
    await hold(store, p.id, "sword");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(1, { charge: 1 })] }), seeded(), t + 20_000)).rejects.toThrow("charge");
  });

  it("the new ultimates charge from MP spent, HP healed and lance charges on the boss", async () => {
    const t = Date.now();
    const cases: { cls: "mage" | "saint" | "lancer"; skill: string; tally: Partial<BossTally>; extra: Partial<LiveReport> }[] = [
      { cls: "mage", skill: "star_fall", tally: { mp: 500 }, extra: {} },
      { cls: "saint", skill: "judgment_of_mercy", tally: { healed: 10_000 }, extra: { drained: 10_000 } },
      { cls: "lancer", skill: "dragonpiercer", tally: { charges: 15, weaponHits: 15, dmg: 15 }, extra: { hits: Array.from({ length: 15 }, () => hit(1, { charge: 1 })) } },
    ];
    for (const c of cases) {
      const { store, p } = await newPlayer(c.cls, c.cls === "mage" ? { INT: 3, HP: 2 } : { STR: 3, HP: 2 });
      await give(store, p.id, c.skill);
      if (c.skill === "judgment_of_mercy") await give(store, p.id, "soul_drain");
      await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 600_000);
      const ult = blank("hollow_of_the_mire", { hits: [hit(210, { skillId: c.skill, ult: 1 })] });
      await expect(game.liveReport(store, p.id, ult, seeded(), t - 500_000)).rejects.toThrow("isn't charged");
      // charge it (Star Fall needs that much MP spent, Judgment that much drained)
      if (c.skill === "star_fall") {
        await store.applyCounters(p.id, { bf_mp: { op: "set", value: 500 } });
      } else if (c.skill === "judgment_of_mercy") {
        await store.applyCounters(p.id, { bf_healed: { op: "set", value: 10_000 } });
      } else {
        await game.liveReport(store, p.id, blank("hollow_of_the_mire", { ...c.extra, boss: tally(c.tally) }), seeded(), t - 400_000);
      }
      await expect(game.liveReport(store, p.id, ult, seeded(), t - 300_000), c.skill).resolves.toBeTruthy();
    }
  });
});

describe("the new skills in the live game", () => {
  it("Spell Thief absorbs each enemy's first spell and casts it back; the server accepts it", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("hollow_of_the_mire", ["spell_thief"], "mage");
    e.setRun({ room: 0, totalRooms: 4, cleared: false });
    e.player.x = e.map.rooms[0].x0 * 64 + 40;
    run(50);
    const bat = e.monsters.find((m) => m.id === "mire_bat" && m.state !== "dead")!;
    expect(bat).toBeTruthy();
    bat.nextAttackAt = 1e12;
    const screech = MONSTERS.mire_bat.attacks.find((a) => a.name === "Screech")!;
    const hp0 = e.player.hp;
    strike(e, bat, screech);
    expect(e.player.hp).toBe(hp0);
    expect(bat.hp).toBeLessThan(bat.maxHp);
    // the second spell from the same bat lands normally
    e.player.invulnUntil = 0;
    strike(e, bat, screech);
    e.flush();
    const all = reports.flatMap((r) => r.hits);
    expect(all.filter((h) => h.skillId === "spell_thief")).toHaveLength(1);
    expect(reports.reduce((n, r) => n + r.spellsAbsorbed, 0)).toBe(1);
    await sendAll(store, p.id, reports, clock() + 60_000);
  });

  it("Chain Catastrophe: a spell kill explodes into the monsters around it", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["chain_catastrophe"], "mage");
    expect(e.weapon).toBe("staff");
    const target = faceOff(e, "bog_toad");
    target.nextAttackAt = 1e12;
    target.hp = 1;
    // two more monsters right next to it
    const others = e.monsters.filter((m) => m !== target && m.state !== "dead").slice(0, 2);
    for (const m of others) {
      m.x = target.x + 40;
      m.y = target.y;
      m.span = [m.x, m.x];
      m.nextAttackAt = 1e12;
    }
    e.held.attack = true;
    for (let i = 0; i < 200 && target.state !== "dead"; i++) run(16);
    e.held.attack = false;
    run(32);
    e.flush();
    const chains = reports.flatMap((r) => r.hits).filter((h) => h.chain);
    expect(chains.length).toBeGreaterThanOrEqual(1);
    // the slime only had 1 HP: tell the server the rest came from poison
    const kill = reports.find((r) => r.type === "kill" && r.monsterId === "bog_toad")!;
    kill.indirectToTarget = MONSTERS.bog_toad.stats.HP;
    await sendAll(store, p.id, reports, clock() + 60_000);
  });

  it("Blood Sorcery: at 0 MP a skill costs HP and hits for double", async () => {
    const { e, run, reports, store, p } = await engineSetup("mirewood_fields", ["blood_sorcery", "fireball"], "mage");
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.player.mp = 0;
    const hp0 = e.player.hp;
    const slot = e.skillSlots.findIndex((s) => s.id === "fireball");
    e.press(`skill${slot}` as "skill0");
    run(600);
    expect(e.player.hp).toBeLessThan(hp0);
    e.flush();
    const r = reports.find((x) => x.bloodUses.fireball)!;
    expect(r).toBeTruthy();
    expect(r.hits.filter((h) => h.skillId === "fireball").every((h) => h.blood)).toBe(true);
    const pl = (await store.getPlayer(p.id))!;
    pl.currentMp = 0;
    await store.savePlayer(pl);
    await sendAll(store, p.id, reports, Date.now() + 60_000);
  });

  it("Soul Drain heals you as you hit, and extra HP becomes a shield that soaks the next blow", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["soul_drain"], "saint");
    expect(e.weapon).toBe("healing_bracelet");
    // this test character put no points in INT, so the bracelet would barely scratch the toad
    e.combat.stats.INT = 60;
    const pl = (await store.getPlayer(p.id))!;
    pl.stats.INT = 60;
    await store.savePlayer(pl);
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.player.hp = 5;
    e.held.attack = true;
    run(8000);
    e.held.attack = false;
    expect(e.player.hp).toBe(e.player.maxHp);
    expect(e.player.shield).toBeGreaterThan(0);
    const shield = e.player.shield;
    strike(e, m, MONSTERS.bog_toad.attacks[0]);
    expect(e.player.hp === e.player.maxHp || e.player.shield < shield).toBe(true);
    e.flush();
    expect(reports.reduce((n, r) => n + r.drained, 0)).toBeGreaterThan(0);
    await sendAll(store, p.id, reports, clock() + 60_000);
  });

  it("Grace Rebound triples the first heal below 10% HP in a fight", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", ["grace_rebound", "second_wind"], "saint");
    const slot = e.skillSlots.findIndex((s) => s.id === "second_wind");
    e.player.maxHp = 1000;
    e.player.hp = 40;
    e.player.mp = 50;
    e.press(`skill${slot}` as "skill0");
    run(32);
    expect(e.player.hp).toBe(40 + 900);
    // the second heal below 10% in the same fight is a normal one
    e.player.hp = 40;
    e.player.globalReady = 0;
    e.player.skillReady = {};
    e.press(`skill${slot}` as "skill0");
    run(32);
    expect(e.player.hp).toBe(40 + 300);
    e.flush();
    expect(reports.reduce((n, r) => n + r.lowHpHeals, 0)).toBe(2);
  });

  it("lance: a long run turns the attack into a charge; Comet Charge hits harder; Iron Momentum can't be knocked back", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["comet_charge", "iron_momentum"], "lancer");
    expect(e.weapon).toBe("lance");
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.player.x = m.x - CHARGE_FULL - 200;
    e.held.right = true;
    for (let i = 0; i < 300 && e.player.runDist < CHARGE_FULL; i++) run(16);
    expect(e.player.runDist).toBeGreaterThanOrEqual(CHARGE_FULL);
    // mid-charge a blow doesn't knock you back or stop the run
    e.player.invulnUntil = 0;
    const rng = (e as unknown as { rng: () => number }).rng;
    (e as unknown as { rng: () => number }).rng = () => 0;
    strike(e, m, MONSTERS.bog_toad.attacks[0]);
    (e as unknown as { rng: () => number }).rng = rng;
    expect(e.player.vx).toBeGreaterThanOrEqual(0);
    expect(e.player.runDist).toBeGreaterThanOrEqual(CHARGE_FULL);
    // the toad is right ahead: let go of the arrow and attack
    m.x = e.player.x + 80;
    m.y = e.player.y;
    m.span = [m.x, m.x];
    e.held.right = false;
    e.held.attack = true;
    run(200);
    e.held.attack = false;
    e.flush();
    const charge = reports.flatMap((r) => r.hits).find((h) => h.charge !== undefined);
    expect(charge?.charge).toBe(1);
    await sendAll(store, p.id, reports, clock() + 60_000);
    expect((await store.getCounters(p.id)).charges_done).toBe(1);
  });

  it("Sky Lance: attacking in the air dives down and hits everything where you land", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["sky_lance"], "lancer");
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.player.x = m.x - 60;
    e.press("jump");
    run(120);
    expect(e.player.onGround).toBe(false);
    e.held.attack = true;
    run(16);
    e.held.attack = false;
    expect(e.player.diving).toBe(true);
    for (let i = 0; i < 100 && !e.player.onGround; i++) run(16);
    run(200);
    e.flush();
    expect(reports.flatMap((r) => r.hits).some((h) => h.skillId === "sky_lance")).toBe(true);
    await sendAll(store, p.id, reports, clock() + 60_000);
  });
});

describe("the unlock pop-up says how you earned the skill", () => {
  it("every enabled skill has a plain-words description of what unlocks it", async () => {
    const { describeCondition } = await import("../src/lib/game/reveal");
    const { ALL_SKILLS } = await import("../src/lib/game/data/all-skills");
    const name = (id: string) => ALL_SKILLS.find((s) => s.id === id)?.name ?? id;
    expect(describeCondition(ALL_SKILLS.find((s) => s.id === "second_wind")!.conditions, name)).toEqual([
      "Win 5 battles",
      "Win a fight",
      "Drop to 30% HP or lower during that fight",
    ]);
    expect(describeCondition(ALL_SKILLS.find((s) => s.id === "venom_body")!.conditions, name)[0]).toBe("Own Poison Immunity");
    for (const s of ALL_SKILLS) {
      if (!s.enabled || s.id === "thorn_retort") continue;
      const lines = describeCondition(s.conditions, name);
      expect(lines.length, s.id).toBeGreaterThan(0);
      // no raw counter keys leak through
      for (const l of lines) expect(l, s.id).not.toMatch(/[a-z]_[a-z]/);
    }
  });

  it("the unlock notice carries it", async () => {
    const { store, p } = await newPlayer("mage", { INT: 3, HP: 2 });
    await store.applyCounters(p.id, { spells_survived: { op: "set", value: 999 } });
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 60_000);
    const r = await game.liveReport(store, p.id, blank("hollow_of_the_mire", { hitsTaken: 1, spellsTaken: 1 }), seeded(), t);
    const u = r.unlocks.find((x) => x.id === "spell_thief");
    expect(u?.earnedBy).toEqual(["Survive 1,000 enemy spells"]);
  });
});
