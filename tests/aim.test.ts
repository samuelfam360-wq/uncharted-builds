import { describe, expect, it } from "vitest";
import { engineSetup } from "./helpers";

describe("shooting weapons aim at monsters", () => {
  it("a gun shot hits a short monster standing on the same floor", async () => {
    const { e, run } = await engineSetup("mirewood_fields", [], "gunslinger");
    expect(e.weapon).toBe("pistol");
    const m = e.monsters.find((x) => x.id === "green_slime" && x.y === 704)!;
    e.monsters = [m];
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    m.span = [m.x, m.x];
    e.player.x = m.x - 250;
    e.player.y = m.y;
    e.player.facing = 1;
    e.held.attack = true;
    run(150);
    e.held.attack = false;
    run(1000);
    expect(m.hp).toBeLessThan(1e6);
  });

  it("an arrow flies down at a monster on the floor below", async () => {
    const { e, run } = await engineSetup("mirewood_fields", [], "ranger");
    // the player starts on a ledge; the rabbit is on the ground below and ahead
    const m = e.monsters.find((x) => x.id === "horned_rabbit" && x.y === 704 && x.x > 1400)!;
    e.monsters = [m];
    m.hp = m.maxHp = 1e6;
    m.nextAttackAt = 1e12;
    m.span = [m.x, m.x];
    e.player.x = 1060;
    e.player.y = 576;
    e.player.facing = 1;
    e.held.attack = true;
    run(150);
    e.held.attack = false;
    expect(e.projectiles[0].vy).toBeGreaterThan(0);
    run(1000);
    expect(m.hp).toBeLessThan(1e6);
  });

  it("with nothing in front, the shot flies straight", async () => {
    const { e, run } = await engineSetup("mirewood_fields", [], "ranger");
    e.monsters = [];
    e.held.attack = true;
    run(150);
    e.held.attack = false;
    expect(e.projectiles[0].vy).toBe(0);
  });
});
