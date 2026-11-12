import type { BattleState } from "../game/combat";
import { ALL_SKILLS } from "../game/data/all-skills";
import { UNIQUE_ITEMS } from "../game/data/world";
import type { Counters, InventoryItem, Player, PlayerSkill, SkillDefinition, UniqueItem, UnlockLogEntry } from "../game/types";
import type { BreedRecord, GameStore, GrantOptions } from "./types";

/**
 * In-memory store so the game runs with no Supabase project (local play and tests).
 * JavaScript is single-threaded and these methods don't await mid-update, so the
 * "atomic" operations really are atomic here.
 */
export class MemoryStore implements GameStore {
  readonly kind = "memory" as const;
  players = new Map<string, Player>();
  counters = new Map<string, Counters>();
  defs = new Map<string, SkillDefinition>(ALL_SKILLS.map((d) => [d.id, structuredClone(d)]));
  skills = new Map<string, PlayerSkill[]>();
  inventory = new Map<string, Map<string, number>>();
  battles = new Map<string, BattleState>();
  uniques = new Map<string, UniqueItem>(
    Object.values(UNIQUE_ITEMS).map((u) => [
      u.id,
      {
        id: u.id,
        name: u.name,
        description: u.description,
        ownerId: null,
        ownerName: null,
        level: 1,
        exp: 0,
        statBonus: { ...u.statBonus },
        attachedSkills: [...u.attachedSkills],
        claimedAt: null,
        equipped: true,
      },
    ]),
  );
  log: UnlockLogEntry[] = [];

  async createPlayer(p: Player) {
    this.players.set(p.id, structuredClone(p));
  }
  async getPlayer(id: string) {
    const p = this.players.get(id);
    return p ? structuredClone(p) : null;
  }
  async savePlayer(p: Player) {
    this.players.set(p.id, structuredClone(p));
  }

  async getCounters(id: string) {
    return { ...(this.counters.get(id) ?? {}) };
  }
  async applyCounters(id: string, deltas: Parameters<GameStore["applyCounters"]>[1]) {
    const c = this.counters.get(id) ?? {};
    for (const [k, d] of Object.entries(deltas)) {
      const cur = c[k] ?? 0;
      c[k] = d.op === "inc" ? cur + d.value : d.op === "set" ? d.value : Math.max(cur, d.value);
    }
    this.counters.set(id, c);
    return { ...c };
  }

  async listSkillDefs() {
    return [...this.defs.values()].map((d) => structuredClone(d));
  }
  async saveSkillDef(def: SkillDefinition) {
    this.defs.set(def.id, structuredClone(def));
  }

  async getPlayerSkills(id: string) {
    return structuredClone(this.skills.get(id) ?? []);
  }
  async grantSkill(playerId: string, skillId: string, o: GrantOptions) {
    const def = this.defs.get(skillId);
    if (!def) return false;
    if (def.limit !== null) {
      let taken = 0;
      for (const [pid, list] of this.skills)
        if (pid !== playerId && list.some((s) => s.skillId === skillId && s.status !== "declined")) taken++;
      if (taken >= def.limit) return false;
    }
    const list = this.skills.get(playerId) ?? [];
    const row: PlayerSkill = {
      skillId,
      status: o.status,
      equipped: o.equipped,
      stage: o.stage,
      evolvedInto: null,
      unlockedAt: new Date().toISOString(),
    };
    const i = list.findIndex((s) => s.skillId === skillId);
    if (i >= 0) list[i] = { ...list[i], ...row };
    else list.push(row);
    if (o.evolvesFrom && o.status === "owned") {
      const prev = list.find((s) => s.skillId === o.evolvesFrom);
      if (prev) {
        prev.evolvedInto = skillId;
        prev.equipped = false;
      }
    }
    this.skills.set(playerId, list);
    this.log.unshift({ playerId, playerName: this.players.get(playerId)?.name ?? "?", skillId, at: row.unlockedAt });
    return true;
  }
  async updatePlayerSkill(playerId: string, skillId: string, patch: Partial<Pick<PlayerSkill, "status" | "equipped">>) {
    const s = (this.skills.get(playerId) ?? []).find((x) => x.skillId === skillId);
    if (s) Object.assign(s, patch);
  }

  async getInventory(id: string): Promise<InventoryItem[]> {
    return [...(this.inventory.get(id) ?? new Map()).entries()].filter(([, q]) => q > 0).map(([itemId, qty]) => ({ itemId, qty }));
  }
  async changeItem(id: string, itemId: string, delta: number) {
    const inv = this.inventory.get(id) ?? new Map<string, number>();
    inv.set(itemId, Math.max(0, (inv.get(itemId) ?? 0) + delta));
    this.inventory.set(id, inv);
  }

  async getActiveBattle(id: string) {
    const b = this.battles.get(id);
    return b ? structuredClone(b) : null;
  }
  async saveBattle(state: BattleState, active: boolean) {
    if (active) this.battles.set(state.playerId, structuredClone(state));
    else this.battles.delete(state.playerId);
  }

  async getUniqueItems() {
    return [...this.uniques.values()].map((u) => ({
      ...structuredClone(u),
      ownerName: u.ownerId ? this.players.get(u.ownerId)?.name ?? null : null,
    }));
  }
  private breeds = new Map<string, BreedRecord>();
  async recordBreed(id: string, parts: string[], playerId: string) {
    const b = this.breeds.get(id);
    if (b) {
      b.timesBred++;
      return { isNew: false, times: b.timesBred };
    }
    const name = this.players.get(playerId)?.name ?? null;
    this.breeds.set(id, { id, parts: [...parts], firstBredBy: playerId, firstBredByName: name, firstBredAt: new Date().toISOString(), timesBred: 1 });
    return { isNew: true, times: 1 };
  }
  async listBreeds() {
    return [...this.breeds.values()].map((b) => structuredClone(b)).reverse();
  }

  async claimUniqueItem(itemId: string, playerId: string) {
    const u = this.uniques.get(itemId);
    if (!u || u.ownerId || u.claimedAt) return false;
    u.ownerId = playerId;
    u.claimedAt = new Date().toISOString();
    return true;
  }
  async saveUniqueItem(item: UniqueItem) {
    this.uniques.set(item.id, structuredClone(item));
  }

  async recentUnlocks(limit: number) {
    return this.log.slice(0, limit);
  }
  async skillOwnerCounts() {
    const out: Record<string, number> = {};
    for (const list of this.skills.values()) for (const s of list) if (s.status === "owned") out[s.skillId] = (out[s.skillId] ?? 0) + 1;
    return out;
  }
  async playerCount() {
    return this.players.size;
  }
}
