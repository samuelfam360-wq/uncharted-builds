import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/lib/store/memory";
import * as game from "../src/lib/game/service";

describe("full play-through on the memory store", () => {
  it("creates a character, fights, and unlocks a weapon skill by habit", async () => {
    const store = new MemoryStore();
    const p = await game.createCharacter(store, { name: "Rin", appearance: "red cloak", weapon: "sword", stats: { STR: 8, HP: 2 } });
    expect(p.freePoints).toBe(0);

    const unlocked: string[] = [];
    for (let i = 0; i < 200 && !unlocked.includes("twin_cut"); i++) {
      const st = await game.getState(store, p.id);
      if (st.player.currentHp < st.derived.maxHp * 0.5) await game.rest(store, p.id);
      const start = await game.beginBattle(store, p.id, "mirewood_fields");
      unlocked.push(...start.unlocks.map((u) => u.id));
      for (let t = 0; t < 60; t++) {
        const r = await game.battleAction(store, p.id, { type: "attack" });
        unlocked.push(...r.unlocks.map((u) => u.id));
        if (r.battle.over) break;
      }
    }
    expect(unlocked).toContain("twin_cut");
    const st = await game.getState(store, p.id);
    expect(st.player.level).toBeGreaterThan(1);
    expect(st.skills.find((s) => s.id === "twin_cut")?.equipped).toBe(true);
    // The player never sees conditions.
    expect(JSON.stringify(st)).not.toContain("kills_sword");
  });

  it("server-first: only one player can ever own First Light", async () => {
    const store = new MemoryStore();
    const a = await game.createCharacter(store, { name: "Aa", appearance: "", weapon: "sword", stats: {} });
    const b = await game.createCharacter(store, { name: "Bb", appearance: "", weapon: "sword", stats: {} });
    const battle = { dungeon_cleared: true } as const;
    const ua = await game.checkUnlocks(store, a.id, { battle });
    const ub = await game.checkUnlocks(store, b.id, { battle });
    expect(ua.map((u) => u.id)).toContain("first_light");
    expect(ub.map((u) => u.id)).not.toContain("first_light");
  });

  it("stat-locking skills are offered first, and accepting locks the stats", async () => {
    const store = new MemoryStore();
    const p = await game.createCharacter(store, { name: "Wall", appearance: "", weapon: "large_shield", stats: { VIT: 10 } });
    await store.savePlayer({ ...(await store.getPlayer(p.id))!, stats: { HP: 0, MP: 0, STR: 0, VIT: 30, AGI: 0, DEX: 0, INT: 0 } });
    await store.applyCounters(p.id, { damage_blocked: { op: "inc", value: 6000 } });
    const u = await game.checkUnlocks(store, p.id, { battle: { attacks_made: 0 } });
    const iron = u.find((x) => x.id === "iron_endurance")!;
    expect(iron.needsConfirmation).toBe(true);
    let st = await game.getState(store, p.id);
    expect(st.derived.stats.VIT).toBe(30); // not active until accepted
    await game.respondToOffer(store, p.id, "iron_endurance", true);
    st = await game.getState(store, p.id);
    expect(st.derived.stats.VIT).toBe(60);
    expect(st.player.lockedStats).toEqual(["STR", "AGI"]);
    await store.savePlayer({ ...st.player, freePoints: 5 });
    await expect(game.spendPoints(store, p.id, { STR: 1 })).rejects.toThrow(/locked/);
  });

  it("the unique item goes to the first player who clears the dungeon on their first attempt", async () => {
    const store = new MemoryStore();
    // A ridiculous glass cannon so the run is deterministic enough.
    const p = await game.createCharacter(store, { name: "Hero", appearance: "", weapon: "hammer", stats: { STR: 10 } });
    await store.savePlayer({ ...(await store.getPlayer(p.id))!, stats: { HP: 100, MP: 0, STR: 400, VIT: 400, AGI: 0, DEX: 200, INT: 400 } });
    await game.rest(store, p.id);
    await game.beginBattle(store, p.id, "hollow_of_the_mire");
    let claimed: string | null = null;
    for (let i = 0; i < 100; i++) {
      const r = await game.battleAction(store, p.id, { type: "attack" });
      if (r.claimed) claimed = r.claimed;
      if (r.battle.over && !r.nextBattle) break;
    }
    expect(claimed).toBe("thornheart_mantle");
    const st = await game.getState(store, p.id);
    expect(st.uniqueItem?.id).toBe("thornheart_mantle");
    expect(st.skills.map((s) => s.id)).toContain("first_light");
  });
});
