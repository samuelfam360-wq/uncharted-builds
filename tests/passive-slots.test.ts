import { describe, expect, it } from "vitest";
import { MASTERY_SKILLS } from "../src/lib/game/data/mastery-skills";
import * as game from "../src/lib/game/service";
import { give, newPlayer } from "./helpers";

describe("passive skills have no limit", () => {
  it("every passive you own can be equipped at once; active skills still have slots", async () => {
    const { store, p } = await newPlayer();
    const passives = MASTERY_SKILLS.filter((s) => s.kind === "passive" && s.id !== "horn_rabbit_weapons").slice(0, 9).map((s) => s.id);
    expect(passives.length).toBe(9);
    await give(store, p.id, ...passives);
    for (const id of passives) await store.updatePlayerSkill(p.id, id, { equipped: false });
    for (const id of passives) await game.setEquipped(store, p.id, id, true);
    const st = await game.getState(store, p.id);
    expect(st.slots.passive.used).toBe(9);
    expect(st.slots.passive.max).toBeNull();

    const actives = MASTERY_SKILLS.filter((s) => s.kind === "active").slice(0, st.slots.active.max + 1).map((s) => s.id);
    await give(store, p.id, ...actives);
    for (const id of actives) await store.updatePlayerSkill(p.id, id, { equipped: false });
    for (const id of actives.slice(0, -1)) await game.setEquipped(store, p.id, id, true);
    await expect(game.setEquipped(store, p.id, actives[actives.length - 1], true)).rejects.toThrow("No free slot");
  });
});
