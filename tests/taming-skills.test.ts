import { describe, expect, it } from "vitest";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, maxHit } from "../src/lib/game/live";
import { petAttacker } from "../src/lib/game/pets";
import { describeCondition } from "../src/lib/game/reveal";
import * as game from "../src/lib/game/service";
import { blank, engineSetup, faceOff, give, hit, newPlayer, seeded } from "./helpers";

describe("Taming mastery skills", () => {
  it("use the design's names and unlocks; the ones waiting on missing systems are off", () => {
    const by = new Map(MASTERY_SKILLS.map((s) => [s.id, s]));
    expect(describeCondition(by.get("shared_glory")!.conditions)).toEqual(["Your pet lands 5,000 killing blows"]);
    expect(describeCondition(by.get("beast_tongue")!.conditions)).toEqual(["Tame 50 different species"]);
    expect(["Shared Glory", "Beast Tongue", "Pack Leader", "Kindred Spirit", "Primal Bond"].every((n) => MASTERY_SKILLS.some((s) => s.name === n))).toBe(true);
    expect(by.get("shared_glory")!.enabled && by.get("beast_tongue")!.enabled).toBe(true);
  });

  it("Shared Glory: the pet out borrows 20% of your stats (wand in hand) and earns 50% more EXP", async () => {
    const { store, p } = await newPlayer("tamer", { MP: 3, HP: 2 });
    await game.chooseFirstPet(store, p.id, "thorn_wolf");
    const plain = (await game.getState(store, p.id)).pets[0].stats;
    await give(store, p.id, "shared_glory");
    const st = await game.getState(store, p.id);
    expect(st.combat.passive.shared_glory).toEqual({ stat_share: 0.2, exp_mult: 1.5 });
    const glory = st.pets[0].stats;
    expect(glory.STR).toBe(plain.STR + Math.floor(st.derived.stats.STR * 0.2));
    expect(glory.HP).toBe(plain.HP + Math.floor(st.derived.stats.HP * 0.2));
    // the server allows the stronger bites
    const pl = (await store.getPlayer(p.id))!;
    const g = petAttacker(pl.pets[0], { stats: st.derived.stats, share: 0.2 });
    const cap = maxHit(attackSpec("unarmed", g), g);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const hp = MONSTERS.green_slime.stats.HP;
    const bites = Array.from({ length: Math.ceil(hp / cap) }, () => hit(cap, { pet: true }));
    await game.liveReport(
      store,
      p.id,
      blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: bites, petToTarget: bites.length * cap, hitsOnTarget: bites.length, petKill: true }),
      seeded(),
      t,
    );
    const after = (await store.getPlayer(p.id))!.pets[0];
    const exp = Math.round(MONSTERS.green_slime.exp * 1.5);
    expect(after.exp + (after.level > 1 ? 1e9 : 0)).toBe(exp);
    // without the wand in hand it sleeps
    const pl2 = (await store.getPlayer(p.id))!;
    pl2.weapon = "sword";
    pl2.ownedWeapons = [...pl2.ownedWeapons, "sword"];
    await store.savePlayer(pl2);
    expect((await game.getState(store, p.id)).combat.passive.shared_glory).toBeUndefined();
  });

  it("Beast Tongue: the next attack is named a second early, and it's the one that comes", async () => {
    const { e, run, store, p } = await engineSetup("mirewood_fields", ["beast_tongue"], "tamer");
    void store;
    void p;
    expect(e.combat.passive.beast_tongue).toEqual({ early_ms: 1000 });
    e.monsters = e.monsters.filter((m) => m.id === "horned_rabbit").slice(0, 1);
    const m = faceOff(e, "horned_rabbit");
    m.nextAttackAt = e.now + 1500;
    e.player.hp = e.player.maxHp = 1e6;
    const texts = () => (e as unknown as { texts: { text: string }[] }).texts.map((t) => t.text);
    run(400);
    expect(m.foreseen).toBeUndefined();
    run(400); // now within a second of its attack
    const told = m.foreseen;
    expect(told).toBeDefined();
    expect(texts()).toContain(`${told!.name} next!`);
    for (let i = 0; i < 200 && m.state !== "windup"; i++) run(16);
    expect(m.state).toBe("windup");
    expect(m.attack).toBe(told);
    expect(m.foreseen).toBeUndefined();
  });
});
