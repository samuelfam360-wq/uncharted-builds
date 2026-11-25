import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HERO, SAMPLE } from "@/components/three/vroid";

const dir = join(__dirname, "..", "public", "models", "vroid");

/** The JSON part of a .vrm (a glTF binary file). */
function gltfJson(file: string) {
  const b = readFileSync(join(dir, file));
  const n = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + n).toString("utf8"));
}

describe("anime hero files", () => {
  it("the hero and the stand-in are in the game", () => {
    expect(existsSync(join(dir, HERO))).toBe(true);
    expect(existsSync(join(dir, SAMPLE))).toBe(true);
  });

  it("the hero has the bones the game's moves need, and its hair has its own material", () => {
    const j = gltfJson(HERO);
    const bones = Object.keys(j.extensions.VRMC_vrm.humanoid.humanBones);
    for (const b of ["hips", "spine", "chest", "head", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot"])
      expect(bones, b).toContain(b);
    expect(j.materials.some((m: { name: string }) => /HAIR/.test(m.name))).toBe(true);
  });
});
