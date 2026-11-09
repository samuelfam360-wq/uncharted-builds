import { handle, requireAdmin } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  const store = getStore();
  const [players, unlocks, uniques] = await Promise.all([store.playerCount(), store.recentUnlocks(30), store.getUniqueItems()]);
  return { store: store.kind, players, unlocks, uniques };
});
