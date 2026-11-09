import { handle, requireAdmin } from "@/lib/api";
import { GameError } from "@/lib/game/character";
import { skillDefinitionSchema } from "@/lib/game/schema";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  const store = getStore();
  const [skills, owners] = await Promise.all([store.listSkillDefs(), store.skillOwnerCounts()]);
  return { skills: skills.map((s) => ({ ...s, owners: owners[s.id] ?? 0 })) };
});

// Edit conditions, effects, locks and limits as data. No deploy needed.
// Existing owners keep their skill: only future unlocks see the change.
export const PUT = handle(async ({ skill }) => {
  await requireAdmin();
  const parsed = skillDefinitionSchema.safeParse(skill);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new GameError(`Invalid skill: ${issue.path.join(".") || "root"}: ${issue.message}`);
  }
  const store = getStore();
  const all = await store.listSkillDefs();
  const s = parsed.data;
  for (const ref of [s.evolvesFrom, ...s.excludes].filter(Boolean) as string[]) {
    if (ref === s.id || !all.some((d) => d.id === ref)) throw new GameError(`Unknown skill referenced: ${ref}`);
  }
  await store.saveSkillDef(s);
  return { ok: true };
});
