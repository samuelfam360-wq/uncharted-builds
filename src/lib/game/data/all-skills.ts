import { MASTERY_SKILLS } from "./mastery-skills";
import { STARTER_SKILLS } from "./skills";

/** Every skill the game ships with (the seed for the skill_definitions table). */
export const ALL_SKILLS = [...STARTER_SKILLS, ...MASTERY_SKILLS];
