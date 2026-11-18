// Picks the 3D hero for a look by its body style:
// Default and Chibi = anime (VRoid), Block = the KayKit pack heroes, Brick = toy bricks.

import type { Look } from "../side/hero";
import { makeBrickHero } from "./brick";
import { makeHero, type HeroModel } from "./models";
import { makeRiggedHero } from "./rigged";
import { makeVroidHero } from "./vroid";

export function heroFor(look: Look): HeroModel {
  switch (look.style) {
    case "Default":
    case "Chibi":
      return makeVroidHero(look);
    case "Brick":
      return makeBrickHero(look);
    default:
      // Block: the animated pack character once it has loaded, else the code-built one
      return makeRiggedHero(look) ?? makeHero(look);
  }
}
