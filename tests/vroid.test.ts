import { describe, expect, it } from "vitest";
import { APPEARANCE_OPTIONS } from "@/lib/game/data/classes";
import { HAIR_FILE, vrmFilesFor } from "@/components/three/vroid";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(__dirname, "..", "public", "models", "vroid");

describe("anime hero files", () => {
  it("every hair style in the create screen has a hair file", () => {
    for (const style of APPEARANCE_OPTIONS.hairStyle.options) expect(HAIR_FILE[style], style).toBeTruthy();
  });

  it("picks the body by gender and the hair by hair style", () => {
    expect(vrmFilesFor({ female: false, hairStyle: "Short" })).toEqual({ body: "body-male.vrm", hair: null });
    expect(vrmFilesFor({ female: true, hairStyle: "Short" })).toEqual({ body: "body-female.vrm", hair: null });
    expect(vrmFilesFor({ female: true, hairStyle: "Long" })).toEqual({ body: "body-female.vrm", hair: "hair-long.vrm" });
    expect(vrmFilesFor({ female: false, hairStyle: "Spiky" })).toEqual({ body: "body-male.vrm", hair: "hair-standard.vrm" });
    expect(vrmFilesFor({ female: false, hairStyle: "Unknown" }).hair).toBeNull();
  });

  it("every file it can ask for is in the game (and the sample that stands in)", () => {
    const wanted = new Set<string>(["sample.vrm", "body-male.vrm", "body-female.vrm"]);
    for (const f of Object.values(HAIR_FILE)) if (f !== "hair-short.vrm") wanted.add(f);
    for (const f of wanted) expect(existsSync(join(dir, f)), f).toBe(true);
  });
});
