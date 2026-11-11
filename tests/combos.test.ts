import { describe, expect, it } from "vitest";
import type { Engine, Monster } from "../src/components/side/engine";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS, type EnemyAttack } from "../src/lib/game/data/world";
import { attackSpec, maxHit, type LiveReport } from "../src/lib/game/live";
import { describeCondition } from "../src/lib/game/reveal";
import * as game from "../src/lib/game/service";
import type { MemoryStore } from "../src/lib/store/memory";
import { blank, engineSetup, faceOff, give, hit, newPlayer, seeded } from "./helpers";

const strike = (e: Engine, m: Monster, atk: EnemyAttack) => (e as unknown as { enemyStrikesPlayer(m: Monster, a: EnemyAttack): void }).enemyStrikesPlayer(m, atk);

async function sendAll(store: MemoryStore, playerId: string, reports: LiveReport[], at: number) {
  for (const r of reports) await game.liveReport(store, playerId, r, seeded(), at);
}

describe("combo skills: data", () => {
  it("Spellblade, Iron Sanctuary and Life Palm use the design's names and unlocks", () => {
    const by = new Map(MASTERY_SKILLS.map((s) => [s.id, s]));
    expect(by.get("spellblade")?.name).toBe("Spellblade");
    expect(by.get("iron_sanctuary")?.name).toBe("Iron Sanctuary");
    expect(by.get("life_palm")?.name).toBe("Life Palm");
    for (const id of ["spellblade", "iron_sanctuary", "life_palm"]) expect(by.get(id)?.enabled).not.toBe(false);
    expect(describeCondition(by.get("spellblade")!.conditions, (id) => id)).toEqual([
      "Defeat 1,000 enemies with a sword",
      "Defeat 1,000 enemies with spells",
    ]);
    expect(describeCondition(by.get("iron_sanctuary")!.conditions, (id) => id).join(" | ")).toContain("Heal 100,000 HP");
    expect(describeCondition(by.get("life_palm")!.conditions, (id) => id)[0]).toContain("Heal 50,000 HP while fighting with your fists");
  });
});

describe("combo unlock counters", () => {
  it("spell kills are counted, and heals the server can't account for are not", async () => {
    const { store, p } = await newPlayer("mage", { INT: 3, HP: 2 });
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("staff", st.combat), st.combat);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 600_000);
    const hpM = MONSTERS.green_slime.stats.HP;
    const hits = Array.from({ length: Math.ceil(hpM / cap) }, () => hit(cap));
    await game.liveReport(store, p.id, blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits, directToTarget: hits.length * cap, hitsOnTarget: hits.length }), seeded(), t - 300_000);
    expect((await store.getCounters(p.id)).spell_kills).toBe(1);

    // a heal the server can't account for isn't counted
    const pl = (await store.getPlayer(p.id))!;
    pl.currentHp = 1;
    await store.savePlayer(pl);
    await game.liveReport(store, p.id, blank("mirewood_fields", { healed: 50, hp: 1 }), seeded(), t - 200_000);
    expect((await store.getCounters(p.id)).hp_healed ?? 0).toBe(0);
  });
});

describe("combo skills in the live game", () => {
  it("Spellblade: sword hits add half your INT, and the server accepts the bigger hit", async () => {
    const plain = await engineSetup("mirewood_fields", [], "swordsman");
    const blade = await engineSetup("mirewood_fields", ["spellblade"], "swordsman");
    // these test characters put no points in INT; give both the same INT
    for (const s of [plain, blade]) {
      s.e.combat.stats.INT = 40;
      const pl = (await s.store.getPlayer(s.p.id))!;
      pl.stats.INT = 40;
      await s.store.savePlayer(pl);
    }
    expect(blade.e.combat.passive.spellblade).toEqual({ int_mult: 0.5 });
    const dmgOf = (s: typeof plain) => {
      const m = faceOff(s.e, "bog_toad");
      m.hp = m.maxHp = 1e6;
      m.nextAttackAt = 1e12;
      s.e.held.attack = true;
      s.run(3000);
      s.e.held.attack = false;
      s.e.flush();
      const hs = s.reports.flatMap((r) => r.hits).filter((h) => !h.miss && !h.crit);
      return hs.reduce((n, h) => n + h.dmg, 0) / hs.length;
    };
    const bonus = Math.ceil(blade.e.combat.stats.INT * 0.5);
    expect(bonus).toBeGreaterThan(0);
    expect(dmgOf(blade) - dmgOf(plain)).toBeGreaterThan(bonus * 0.5);
    await sendAll(blade.store, blade.p.id, blade.reports, blade.clock() + 60_000);
  });

  it("Spellblade: without the skill, a sword hit that big is refused", async () => {
    const { store, p } = await newPlayer("swordsman", { STR: 2, INT: 3 });
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("sword", st.combat), st.combat);
    const big = cap + Math.ceil(st.combat.stats.INT * 0.5);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(big)] }), seeded(), t + 100)).rejects.toThrow();
    await give(store, p.id, "spellblade");
    await game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(big)] }), seeded(), t + 100);
  });

  it("Iron Sanctuary: blocking heals you, and the server allows it", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["iron_sanctuary"], "tanker");
    expect(e.weapon).toBe("large_shield");
    const m = faceOff(e, "bog_toad");
    m.nextAttackAt = 1e12;
    e.player.hp = Math.floor(e.player.maxHp / 2);
    const pl = (await store.getPlayer(p.id))!;
    pl.currentHp = e.player.hp;
    await store.savePlayer(pl);
    e.held.block = true;
    run(1000);
    strike(e, m, MONSTERS.bog_toad.attacks[0]);
    e.held.block = false;
    e.flush();
    const blocked = reports.reduce((n, r) => n + r.blockedDamage, 0);
    expect(blocked).toBeGreaterThan(0);
    const healed = reports.reduce((n, r) => n + r.healed, 0);
    expect(healed).toBe(Math.floor(blocked * 0.5));
    await sendAll(store, p.id, reports, clock() + 60_000);
    expect((await store.getCounters(p.id)).hp_healed).toBe(healed);
  });

  it("Life Palm: unarmed hits heal 10% of the damage, and only with fists", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["life_palm"], "monk");
    expect(e.combat.passive.life_palm).toEqual({ pct: 0.1 });
    expect(e.player.shield).toBe(0);
    const m = faceOff(e, "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    e.player.hp = 1;
    const pl = (await store.getPlayer(p.id))!;
    pl.currentHp = 1;
    await store.savePlayer(pl);
    e.held.attack = true;
    run(6000);
    e.held.attack = false;
    e.flush();
    const dealt = reports.flatMap((r) => r.hits).reduce((n, h) => n + (h.miss ? 0 : h.dmg), 0);
    const drained = reports.reduce((n, r) => n + r.drained, 0);
    expect(drained).toBeGreaterThan(0);
    expect(drained).toBeLessThanOrEqual(Math.ceil(dealt * 0.1));
    // no shield from Life Palm: that's only Soul Drain
    expect(e.player.shield).toBe(0);
    await sendAll(store, p.id, reports, clock() + 60_000);
    const c = await store.getCounters(p.id);
    expect(c.hp_healed).toBe(drained);
    expect(c.hp_healed_unarmed).toBe(drained);
    // with a sword in hand the skill does nothing
    const sw = await engineSetup("mirewood_fields", ["life_palm"], "swordsman");
    expect(sw.e.combat.passive.life_palm).toBeUndefined();
  });
});
