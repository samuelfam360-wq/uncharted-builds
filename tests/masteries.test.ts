import { describe, expect, it } from "vitest";
import { blank, engineSetup, faceOff, give, hit, newPlayer, parryOnce, seeded } from "./helpers";
import { derive } from "../src/lib/game/character";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import { MONSTERS } from "../src/lib/game/data/world";
import { attackSpec, maxHit } from "../src/lib/game/live";
import { masteryLevel, masteryXpForLevel, masteryViews } from "../src/lib/game/masteries";
import { skillDefinitionSchema } from "../src/lib/game/schema";
import * as game from "../src/lib/game/service";

describe("mastery levels", () => {
  it("follows 100 x level EXP per level", () => {
    expect(masteryLevel(0)).toBe(1);
    expect(masteryXpForLevel(2)).toBe(100);
    expect(masteryLevel(99)).toBe(1);
    expect(masteryLevel(100)).toBe(2);
    expect(masteryLevel(300)).toBe(3);
    expect(masteryLevel(masteryXpForLevel(20))).toBe(20);
    expect(masteryLevel(masteryXpForLevel(20) - 1)).toBe(19);
    expect(masteryLevel(1e12)).toBe(100);
  });

  it("lists all 12 masteries and marks the class's own (Blacksmith gets two)", () => {
    const v = masteryViews("blacksmith", { mxp_hammer: 150 });
    expect(v.map((m) => m.name)).toEqual(["Sword", "Staff", "Dagger", "Shield", "Bow", "Gun", "Taming", "Lance", "Holy", "Hammer", "Crafting", "Fists"]);
    expect(v.filter((m) => m.classBonus).map((m) => m.id)).toEqual(["hammer", "crafting"]);
    const hammer = v.find((m) => m.id === "hammer")!;
    expect(hammer).toMatchObject({ level: 2, xp: 50, next: 200 });
    expect(masteryViews("free", {}).some((m) => m.classBonus)).toBe(false);
  });
});

describe("masteries grow in live fights", () => {
  it("hits and kills grow the weapon in hand, 20% faster for your class", async () => {
    const { store, p } = await newPlayer("swordsman");
    const r = await game.liveReport(store, p.id, blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: [hit(20), hit(20), hit(1, { miss: true, dmg: 0 })], directToTarget: 40, hitsOnTarget: 3 }), seeded(), Date.now());
    // 2 landed hits x 5 + a kill 50 = 60, x1.2 for a Swordsman = 72
    expect(r.mastery).toMatchObject({ id: "sword", gained: 72, level: 1 });
    expect((await store.getCounters(p.id)).mxp_sword).toBe(72);

    // Not the class weapon: no bonus.
    const m = await newPlayer("mage", { INT: 3, HP: 2 });
    await game.weaponAction(m.store, m.p.id, "sword").catch(() => undefined);
    const pl = (await m.store.getPlayer(m.p.id))!;
    pl.weapon = "sword";
    pl.ownedWeapons = [...pl.ownedWeapons, "sword"];
    await m.store.savePlayer(pl);
    const r2 = await game.liveReport(m.store, m.p.id, blank("mirewood_fields", { type: "kill", monsterId: "green_slime", hits: Array.from({ length: 8 }, () => hit(5)), directToTarget: 40, hitsOnTarget: 8 }), seeded(), Date.now());
    // 8 x 5 + 50 = 90, no class bonus
    expect(r2.mastery.gained).toBe(90);
  });

  it("blocking with a shield grows Shield mastery, and level-ups are announced", async () => {
    const { store, p } = await newPlayer("tanker", { VIT: 3, HP: 2 });
    await store.applyCounters(p.id, { mxp_shield: { op: "set", value: 95 } });
    const r = await game.liveReport(store, p.id, blank("mirewood_fields", { blocks: 1 }), seeded(), Date.now());
    expect(r.mastery).toMatchObject({ id: "shield", gained: 6, level: 2, levelUp: true });
    expect(r.log).toContain("Shield mastery reached level 2!");
    const st = await game.getState(store, p.id);
    expect(st.masteries.find((m) => m.id === "shield")).toMatchObject({ level: 2, classBonus: true });
  });

  it("reaching level 20 in 5 masteries unlocks Wanderer's Path", async () => {
    const { store, p } = await newPlayer();
    await store.applyCounters(p.id, { masteries_lv20: { op: "set", value: 4 }, mxp_sword: { op: "set", value: masteryXpForLevel(20) - 5 } });
    const r = await game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(10)] }), seeded(), Date.now());
    expect(r.mastery.level).toBe(20);
    expect(r.unlocks.map((u) => u.id)).toContain("wanderers_path");
  });
});

describe("hidden mastery skills: data", () => {
  it("every mastery skill is valid and uses the agreed names", () => {
    for (const s of MASTERY_SKILLS) expect(skillDefinitionSchema.safeParse(s).success, s.id).toBe(true);
    const names = MASTERY_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["Blade Read", "Hundred Cuts", "Duelist's Oath", "Broken Blade", "Parry Emperor", "Retribution", "Titan's Defiance", "Iron Riposte", "Vengeance Vault", "Eye of the Storm", "Wanderer's Path", "Adaptive Body"])
      expect(names).toContain(n);
    // These wait for systems that don't exist yet.
    for (const id of ["broken_blade", "titans_defiance"]) expect(MASTERY_SKILLS.find((s) => s.id === id)!.enabled).toBe(false);
  });

  it("weapon techniques sleep without their weapon", async () => {
    const { store, p } = await newPlayer();
    await give(store, p.id, "blade_read", "duelists_oath");
    const st = await game.getState(store, p.id);
    expect(st.combat.passive.blade_read).toBeTruthy();
    const pl = (await store.getPlayer(p.id))!;
    pl.weapon = "unarmed";
    await store.savePlayer(pl);
    const st2 = await game.getState(store, p.id);
    expect(st2.combat.passive.blade_read).toBeUndefined();
    expect(st2.combat.passive.duelist).toBeTruthy(); // not a weapon technique
    expect(st2.skills.find((s) => s.id === "blade_read")!.needsWeapon).toEqual(["Wood Sword"]);
  });

  it("Adaptive Body needs level 30 and stats within 5 points", async () => {
    const { store, p } = await newPlayer("free", { HP: 2, MP: 2, STR: 1, VIT: 1, AGI: 1, DEX: 1, INT: 2 });
    const pl = (await store.getPlayer(p.id))!;
    pl.level = 30;
    await store.savePlayer(pl);
    expect((await game.checkUnlocks(store, p.id)).map((u) => u.id)).toContain("adaptive_body");
    const d = derive((await store.getPlayer(p.id))!, await store.getPlayerSkills(p.id), new Map(MASTERY_SKILLS.map((s) => [s.id, s])), null);
    expect(d.stats.HP).toBe(Math.floor(2 * 1.1));
  });
});

describe("the 50% reveal", () => {
  it("shows what's left at 50%, never the name", async () => {
    const { store, p } = await newPlayer();
    await store.applyCounters(p.id, { parries: { op: "set", value: 499 } });
    expect((await game.getState(store, p.id)).hints).toEqual([]);
    await store.applyCounters(p.id, { parries: { op: "set", value: 500 } });
    const hints = (await game.getState(store, p.id)).hints;
    expect(hints).toEqual([{ pct: 0.5, left: ["Parry 500 more attacks"] }]);
    expect(JSON.stringify(hints)).not.toContain("Blade");
  });

  it("one-fight records show the target and the best so far", async () => {
    const { store, p } = await newPlayer();
    await store.applyCounters(p.id, { hit_streak_best: { op: "set", value: 85 } });
    const [h] = (await game.getState(store, p.id)).hints;
    expect(h.left).toEqual(["Land 100 hits in a row in one fight without being hit (best so far: 85)"]);
  });

  it("disabled skills and owned skills give no hints", async () => {
    const { store, p } = await newPlayer();
    await store.applyCounters(p.id, { broken_blade_kills: { op: "set", value: 290 }, parries: { op: "set", value: 900 } });
    await give(store, p.id, "blade_read");
    expect((await game.getState(store, p.id)).hints).toEqual([]);
  });
});

describe("hidden skill unlocks from live fights", () => {
  it("1,000 parries unlock Blade Read; 1,000 shield parries unlock Iron Riposte", async () => {
    const { store, p } = await newPlayer("tanker", { VIT: 3, HP: 2 });
    await store.applyCounters(p.id, { parries: { op: "set", value: 995 }, perfect_blocks: { op: "set", value: 995 } });
    const r = await game.liveReport(store, p.id, blank("mirewood_fields", { parries: 5, blocks: 5 }), seeded(), Date.now());
    expect(r.unlocks.map((u) => u.id).sort()).toEqual(["blade_read", "iron_riposte"]);
  });

  it("100 hits in a row unlock Hundred Cuts, and the run has to add up", async () => {
    const { store, p } = await newPlayer();
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 20_000);
    // Jumping straight to a run of 50 is refused.
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(5, { streak: 50 })], hitStreak: 51 }), seeded(), t)).rejects.toThrow(
      "doesn't add up",
    );
    const hits = Array.from({ length: 100 }, (_, i) => hit(5, { streak: i }));
    const r = await game.liveReport(store, p.id, blank("mirewood_fields", { hits, hitStreak: 100 }), seeded(), t);
    expect(r.unlocks.map((u) => u.id)).toContain("hundred_cuts");
    expect((await store.getCounters(p.id)).hit_streak_best).toBe(100);
  });

  it("50 one-on-one boss wins with only a sword and no items unlock Duelist's Oath", async () => {
    const { store, p } = await newPlayer();
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 60_000);
    await store.applyCounters(p.id, { boss_duels_won: { op: "set", value: 49 }, run_hollow_of_the_mire_room: { op: "set", value: 3 } });
    const kill = blank("hollow_of_the_mire", { type: "kill", monsterId: "mirefang", directToTarget: 420, hitsOnTarget: 1, duel: true, bossEnd: true });
    const big = { ...kill, hits: Array.from({ length: 30 }, () => hit(14)) };
    const r = await game.liveReport(store, p.id, big, seeded(), t);
    expect(r.unlocks.map((u) => u.id)).toContain("duelists_oath");
  });

  it("surviving 50 boss hits in one fight unlocks Retribution", async () => {
    const { store, p } = await newPlayer("tanker", { VIT: 3, HP: 2 });
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 60_000);
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", { hitsTaken: 30, boss: { hits: 30, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0 } }), seeded(), t - 30_000);
    const r = await game.liveReport(store, p.id, blank("hollow_of_the_mire", { hitsTaken: 20, boss: { hits: 20, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0 } }), seeded(), t);
    expect(r.unlocks.map((u) => u.id)).toContain("retribution");
    // more boss hits than hits taken is refused
    await expect(
      game.liveReport(store, p.id, blank("hollow_of_the_mire", { hitsTaken: 1, boss: { hits: 2, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0 } }), seeded(), t + 5000),
    ).rejects.toThrow("don't add up");
  });

  it("parried boss damage can't be more than the boss could hit for", async () => {
    const { store, p } = await newPlayer();
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 60_000);
    await expect(
      game.liveReport(store, p.id, blank("hollow_of_the_mire", { parries: 1, blocks: 1, boss: { hits: 0, parries: 1, parryDmg: 5000, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0 } }), seeded(), t),
    ).rejects.toThrow("Parried more damage");
    await expect(
      game.liveReport(store, p.id, blank("hollow_of_the_mire", { parries: 1, blocks: 1, boss: { hits: 0, parries: 1, parryDmg: 30, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0 } }), seeded(), t),
    ).resolves.toBeTruthy();
    expect((await store.getCounters(p.id)).boss_fight_parry_dmg_best).toBe(30);
  });

  it("a 10+ enemy fight survived counts toward Eye of the Storm, but not faster than fights can happen", async () => {
    const { store, p } = await newPlayer();
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 10_000);
    await game.liveReport(store, p.id, blank("mirewood_fields", { stormFights: 1 }), seeded(), t);
    expect((await store.getCounters(p.id)).storm_fights_survived).toBe(1);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { stormFights: 50 }), seeded(), t + 1000)).rejects.toThrow("Too many fights");
  });
});

describe("hidden skill effects: the server's checks", () => {
  it("Blade Read one-shots need 20 parries, and only up to a normal monster's HP", async () => {
    const { store, p } = await newPlayer();
    await give(store, p.id, "blade_read");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 30_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { parries: 19, blocks: 19, hits: [hit(40, { execute: true })] }), seeded(), t)).rejects.toThrow(
      "Not enough parries",
    );
    await expect(
      game.liveReport(store, p.id, blank("mirewood_fields", { parries: 20, blocks: 20, hits: [hit(500, { execute: true })] }), seeded(), t),
    ).rejects.toThrow("bigger than possible");
    await expect(
      game.liveReport(store, p.id, blank("mirewood_fields", { parries: 20, blocks: 20, hits: [hit(75, { execute: true })] }), seeded(), t),
    ).resolves.toBeTruthy();
    // Without the skill, no one-shots at all.
    const o = await newPlayer();
    await expect(
      game.liveReport(o.store, o.p.id, blank("mirewood_fields", { parries: 20, blocks: 20, hits: [hit(40, { execute: true })] }), seeded(), t),
    ).rejects.toThrow("isn't equipped");
  });

  it("Hundred Cuts lets a long run hit harder, but no harder than +2% per hit", async () => {
    const { store, p } = await newPlayer();
    await give(store, p.id, "hundred_cuts");
    const st = await game.getState(store, p.id);
    const cap = maxHit(attackSpec("sword", st.combat), st.combat);
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const run = (n: number, last: number) => Array.from({ length: n }, (_, i) => hit(i === n - 1 ? last : 1, { streak: i }));
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: run(51, Math.floor(cap * 2)), hitStreak: 51 }), seeded(), t)).resolves.toBeTruthy();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: run(10, Math.ceil(cap * 1.5)), hitStreak: 10 }), seeded(), t)).rejects.toThrow(
      "bigger than possible",
    );
  });

  it("Vengeance Vault releases only what was stored while guarding", async () => {
    const { store, p } = await newPlayer("tanker", { VIT: 3, HP: 2 });
    await give(store, p.id, "vengeance_vault");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { blocks: 3, blockedDamage: 10, guardStored: 20 }), seeded(), t)).rejects.toThrow(
      "Stored more",
    );
    await game.liveReport(store, p.id, blank("mirewood_fields", { blocks: 3, blockedDamage: 30, guardStored: 30 }), seeded(), t);
    expect((await store.getCounters(p.id)).vault_store).toBe(30);
    // one wave of 30 that hits two monsters spends 30, not 60
    const wave = [hit(30, { skillId: "vengeance_vault", wave: 1 }), hit(30, { skillId: "vengeance_vault", wave: 1 })];
    await game.liveReport(store, p.id, blank("mirewood_fields", { hits: wave }), seeded(), t + 1000);
    expect((await store.getCounters(p.id)).vault_store).toBe(0);
    await expect(
      game.liveReport(store, p.id, blank("mirewood_fields", { hits: [hit(1, { skillId: "vengeance_vault", wave: 2 })] }), seeded(), t + 2000),
    ).rejects.toThrow("Released more");
  });

  it("Iron Riposte and Eye of the Storm strike back no more often than they're triggered", async () => {
    const { store, p } = await newPlayer("tanker", { VIT: 3, HP: 2 });
    const pl = (await store.getPlayer(p.id))!;
    pl.weapon = "large_shield";
    await store.savePlayer(pl);
    await give(store, p.id, "iron_riposte", "eye_of_the_storm");
    const t = Date.now();
    await game.liveEnter(store, p.id, "mirewood_fields", t - 60_000);
    const rip = (n: number) => Array.from({ length: n }, () => hit(5, { skillId: "iron_riposte" }));
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { parries: 1, blocks: 1, hits: rip(2) }), seeded(), t)).rejects.toThrow("More counters");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { parries: 2, blocks: 2, hits: rip(2) }), seeded(), t)).resolves.toBeTruthy();
    const storm = Array.from({ length: 3 }, () => hit(5, { skillId: "eye_of_the_storm" }));
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: storm }), seeded(), t)).rejects.toThrow("More counters");
    await expect(game.liveReport(store, p.id, blank("mirewood_fields", { hits: storm, hitsTaken: 1 }), seeded(), t)).resolves.toBeTruthy();
  });

  it("Retribution fires at 50 / 100 / 200 boss hits, the first tier once per fight, the top tier gives +20% EXP", async () => {
    const { store, p } = await newPlayer("tanker", { VIT: 3, HP: 2 });
    await give(store, p.id, "retribution");
    const t = Date.now();
    await game.liveEnter(store, p.id, "hollow_of_the_mire", t - 600_000);
    await store.applyCounters(p.id, { run_hollow_of_the_mire_room: { op: "set", value: 3 } });
    const ult = (tier: 1 | 2 | 3, dmg: number) => hit(dmg, { skillId: "retribution", ult: tier, crit: true });
    const bossHits = (n: number) => ({ hitsTaken: n, boss: { hits: n, parries: 0, parryDmg: 0, dodges: 0, weaponHits: 0, dmg: 0, mp: 0, healed: 0, charges: 0 } });

    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { ...bossHits(49), hits: [ult(1, 210)] }), seeded(), t - 500_000)).rejects.toThrow(
      "isn't charged",
    );
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", bossHits(50)), seeded(), t - 400_000);
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [ult(1, 300)] }), seeded(), t - 390_000)).rejects.toThrow("bigger than possible");
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [ult(1, 210)] }), seeded(), t - 380_000);
    // the first tier reset the gauge and can't be used again this fight
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", bossHits(60)), seeded(), t - 300_000);
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [ult(1, 100)] }), seeded(), t - 290_000)).rejects.toThrow("already used");
    await expect(game.liveReport(store, p.id, blank("hollow_of_the_mire", { hits: [ult(2, 210)] }), seeded(), t - 280_000)).rejects.toThrow("isn't charged");
    await game.liveReport(store, p.id, blank("hollow_of_the_mire", bossHits(140)), seeded(), t - 200_000);
    // 200 since the reset: the top tier finishes Mirefang for 20% more EXP
    const kill = blank("hollow_of_the_mire", {
      type: "kill",
      monsterId: "mirefang",
      hits: [ult(3, 210)],
      directToTarget: 420,
      indirectToTarget: 0,
      hitsOnTarget: 1,
      bossEnd: true,
    });
    kill.directToTarget = 210;
    kill.indirectToTarget = 210;
    const r = await game.liveReport(store, p.id, kill, seeded(), t);
    expect(r.rewards!.exp).toBe(Math.round(MONSTERS.mirefang.exp * 1.2));
    const c = await store.getCounters(p.id);
    expect([c.bf_hits, c.bf_base_retribution, c.bf_half_retribution]).toEqual([0, 0, 0]);
  });
});

describe("hidden skills in the live game", () => {
  it("Blade Read: after a parry the next slash can't miss and crits", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["blade_read"]);
    const m = faceOff(e, "horned_rabbit"); // a quick, dodgy target
    await parryOnce(e, run, m);
    expect(e.parryChain).toBe(1);
    e.held.attack = true;
    run(200);
    e.held.attack = false;
    e.flush();
    const all = reports.flatMap((r) => r.hits);
    expect(all[0]).toMatchObject({ miss: false, crit: true });
    for (const r of reports) await game.liveReport(store, p.id, r, seeded(), clock() + 1000);
  });

  it("Hundred Cuts: every landed hit is numbered, and getting hit starts over", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", ["hundred_cuts"]);
    const m = faceOff(e, "moss_golem" in MONSTERS && e.monsters.some((x) => x.id === "moss_golem") ? "moss_golem" : "bog_toad");
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e9;
    e.held.attack = true;
    run(3000);
    e.held.attack = false;
    e.flush();
    const landed = reports.flatMap((r) => r.hits).filter((h) => !h.miss);
    expect(landed.length).toBeGreaterThan(3);
    expect(landed.map((h) => h.streak)).toEqual(landed.map((_, i) => i));
    expect(e.hitStreak).toBe(landed.length);
    // a blow lands: the run resets
    m.nextAttackAt = 0;
    for (let i = 0; i < 300 && e.hitStreak > 0; i++) run(16);
    expect(e.hitStreak).toBe(0);
  });

  it("Retribution: boss hits fill the gauge, and firing at 50 takes half of Mirefang's HP", async () => {
    const { e, run, reports, toasts, store, p, clock } = await engineSetup("hollow_of_the_mire", ["retribution"], "tanker");
    e.setRun({ room: 3, totalRooms: 4, cleared: false });
    e.player.x = e.map.rooms[3].x0 * 64 + 40;
    run(50);
    const boss = e.monsters.find((m) => m.id === "mirefang")!;
    expect(boss).toBeTruthy();
    e.press("skill0");
    run(16);
    expect(toasts.at(-1)).toContain("only works in a boss fight");
    // pretend 50 boss blows were survived
    boss.aggro = true;
    e.player.x = boss.x - 90;
    e.player.y = boss.y;
    e.player.facing = 1;
    boss.nextAttackAt = 1e9;
    (e as unknown as { engage(m: unknown): void }).engage(boss);
    e.bossFight!.hits = 50;
    expect(e.skillState(0)!.gauge).toMatchObject({ value: 50, tier: 1, next: 100 });
    e.press("skill0");
    run(16);
    expect(boss.hp).toBe(boss.maxHp - Math.ceil(boss.maxHp / 2));
    expect(e.skillState(0)!.gauge).toMatchObject({ value: 0, tier: 0, next: 100 });
    e.flush();
    const ultHit = reports.flatMap((r) => r.hits).find((h) => h.ult);
    expect(ultHit).toMatchObject({ skillId: "retribution", ult: 1, dmg: 210 });
    void store;
    void p;
    void clock;
  });

  it("Iron Riposte strikes back on a shield parry; Vengeance Vault releases on letting go of block", async () => {
    const { e, run, reports, store, p, clock } = await engineSetup("mirewood_fields", ["iron_riposte", "vengeance_vault"], "tanker");
    const m = faceOff(e, "thorn_wolf");
    m.hp = m.maxHp = 1e6;
    await parryOnce(e, run, m);
    const rip = reports.length ? reports.flatMap((r) => r.hits) : [];
    e.flush();
    const hits = [...rip, ...reports.flatMap((r) => r.hits)];
    expect(hits.some((h) => h.skillId === "iron_riposte")).toBe(true);
    // hold block through a blow: damage is stored, then released
    e.vaultStore = 0;
    for (let k = 0; k < 6 && e.vaultStore === 0; k++) {
      e.held.block = true;
      m.nextAttackAt = 0;
      m.state = "chase";
      for (let i = 0; i < 200 && (m.state as string) !== "recover"; i++) run(16);
      run(100);
    }
    const stored = e.vaultStore;
    expect(stored).toBeGreaterThan(0);
    e.held.block = false;
    run(16);
    expect(e.vaultStore).toBe(0);
    e.flush();
    const wave = reports.flatMap((r) => r.hits).filter((h) => h.skillId === "vengeance_vault");
    expect(wave).toEqual([{ skillId: "vengeance_vault", dmg: stored, crit: false, miss: false, wave: 1 }]);
    for (const r of reports) await game.liveReport(store, p.id, r, seeded(), clock() + 10_000);
  });

  it("a fight with 10+ monsters on you counts once it's over, if you're still standing", async () => {
    const { e, run, reports } = await engineSetup("mirewood_fields", []);
    const near = e.monsters.slice(0, 10);
    expect(near.length).toBe(10);
    for (const m of near) {
      m.x = e.player.x + 150;
      m.y = e.player.y;
      m.span = [m.x, m.x];
      m.aggro = true;
      m.nextAttackAt = 1e9;
    }
    run(32);
    // they all lose interest: walk them far away
    for (const m of e.monsters) {
      m.x = e.player.x + 3000;
      m.span = [m.x, m.x];
      m.aggro = false;
    }
    run(4000);
    expect(reports.reduce((n, r) => n + r.stormFights, 0)).toBe(0); // not over yet
    run(1200);
    e.flush();
    expect(reports.reduce((n, r) => n + r.stormFights, 0)).toBe(1);
  });
});
