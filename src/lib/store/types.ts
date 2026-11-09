import type { BattleState } from "../game/combat";
import type {
  CounterDeltas,
  Counters,
  InventoryItem,
  Player,
  PlayerSkill,
  SkillDefinition,
  UniqueItem,
  UnlockLogEntry,
} from "../game/types";

export interface GrantOptions {
  status: "owned" | "offered";
  equipped: boolean;
  stage: number;
  evolvesFrom: string | null;
}

/** Everything the game needs from storage. Supabase in production, memory for local play and tests. */
export interface GameStore {
  readonly kind: "supabase" | "memory";

  createPlayer(p: Player): Promise<void>;
  getPlayer(id: string): Promise<Player | null>;
  savePlayer(p: Player): Promise<void>;

  getCounters(playerId: string): Promise<Counters>;
  /** Atomic. Returns all counters after applying. */
  applyCounters(playerId: string, deltas: CounterDeltas): Promise<Counters>;

  listSkillDefs(): Promise<SkillDefinition[]>;
  saveSkillDef(def: SkillDefinition): Promise<void>;

  getPlayerSkills(playerId: string): Promise<PlayerSkill[]>;
  /** Atomic. Enforces owner limits (server-first). Returns false if the limit is reached. */
  grantSkill(playerId: string, skillId: string, opts: GrantOptions): Promise<boolean>;
  updatePlayerSkill(playerId: string, skillId: string, patch: Partial<Pick<PlayerSkill, "status" | "equipped">>): Promise<void>;

  getInventory(playerId: string): Promise<InventoryItem[]>;
  changeItem(playerId: string, itemId: string, delta: number): Promise<void>;

  getActiveBattle(playerId: string): Promise<BattleState | null>;
  saveBattle(state: BattleState, active: boolean): Promise<void>;

  getUniqueItems(): Promise<UniqueItem[]>;
  /** Atomic server-first claim. */
  claimUniqueItem(itemId: string, playerId: string): Promise<boolean>;
  saveUniqueItem(item: UniqueItem): Promise<void>;

  recentUnlocks(limit: number): Promise<UnlockLogEntry[]>;
  skillOwnerCounts(): Promise<Record<string, number>>;
  playerCount(): Promise<number>;
}
