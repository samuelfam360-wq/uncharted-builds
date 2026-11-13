import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BattleState } from "../game/combat";
import { cleanAppearance } from "../game/data/classes";
import { CLASS_IDS, type ClassId, type Counters, type Player, type PlayerSkill, type SkillDefinition, type StatKey, type UniqueItem, type WeaponType } from "../game/types";

/** Appearance is stored as JSON text. Phase 1 rows hold a plain label, which falls back to defaults. */
function parseAppearance(raw: unknown) {
  if (typeof raw !== "string") return cleanAppearance(null);
  try {
    return cleanAppearance(JSON.parse(raw));
  } catch {
    return cleanAppearance(null);
  }
}
import type { GameStore, GrantOptions } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function check(res: { data: any; error: { message: string } | null }): any {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}
const many = (res: { data: any; error: { message: string } | null }): any[] => check(res) ?? [];

const toDef = (r: any): SkillDefinition => ({
  id: r.id,
  name: r.name,
  description: r.description,
  kind: r.kind,
  hidden: r.hidden,
  conditions: r.conditions,
  effect: r.effect,
  locks: r.locks ?? [],
  limit: r.owner_limit,
  evolvesFrom: r.evolves_from,
  excludes: r.excludes ?? [],
  usesPerBattle: r.uses_per_battle,
  rumor: r.rumor,
  enabled: r.enabled,
});

/** Server-only store. Uses the service role key, which bypasses RLS. Never import from client code. */
export class SupabaseStore implements GameStore {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async createPlayer(p: Player) {
    check(
      await this.db.from("players").insert({
        id: p.id,
        name: p.name,
        class_id: p.classId,
        appearance: JSON.stringify(p.appearance),
        level: p.level,
        exp: p.exp,
        free_points: p.freePoints,
        gold: p.gold,
        weapon: p.weapon,
        owned_weapons: p.ownedWeapons,
        current_hp: p.currentHp,
        current_mp: p.currentMp,
        dungeon_attempts: p.dungeonAttempts,
        pets: p.pets,
      }),
    );
    check(await this.db.from("player_stats").insert(this.statsRow(p)));
  }

  private statsRow(p: Player) {
    return {
      player_id: p.id,
      hp: p.stats.HP,
      mp: p.stats.MP,
      str: p.stats.STR,
      vit: p.stats.VIT,
      agi: p.stats.AGI,
      dex: p.stats.DEX,
      int: p.stats.INT,
      locked_stats: p.lockedStats,
      updated_at: new Date().toISOString(),
    };
  }

  async getPlayer(id: string): Promise<Player | null> {
    const r: any = check(await this.db.from("players").select("*, player_stats(*)").eq("id", id).maybeSingle());
    if (!r) return null;
    const s = Array.isArray(r.player_stats) ? r.player_stats[0] : r.player_stats;
    return {
      id: r.id,
      name: r.name,
      classId: (CLASS_IDS as readonly string[]).includes(r.class_id) ? (r.class_id as ClassId) : "free",
      appearance: parseAppearance(r.appearance),
      level: r.level,
      exp: r.exp,
      freePoints: r.free_points,
      gold: r.gold,
      weapon: r.weapon as WeaponType,
      ownedWeapons: r.owned_weapons,
      hornWeapon: (r.horn_weapon as WeaponType | null) ?? null,
      hornEquipped: r.horn_equipped === true,
      currentHp: r.current_hp,
      currentMp: r.current_mp,
      dungeonAttempts: r.dungeon_attempts ?? {},
      pets: Array.isArray(r.pets) ? r.pets : [],
      createdAt: r.created_at,
      stats: { HP: s.hp, MP: s.mp, STR: s.str, VIT: s.vit, AGI: s.agi, DEX: s.dex, INT: s.int },
      lockedStats: (s.locked_stats ?? []) as StatKey[],
    };
  }

  async savePlayer(p: Player) {
    check(
      await this.db
        .from("players")
        .update({
          level: p.level,
          exp: p.exp,
          free_points: p.freePoints,
          gold: p.gold,
          weapon: p.weapon,
          owned_weapons: p.ownedWeapons,
          current_hp: p.currentHp,
          current_mp: p.currentMp,
          dungeon_attempts: p.dungeonAttempts,
          pets: p.pets,
          // only written once there is one, so nothing changes for everyone else
          ...(p.hornWeapon ? { horn_weapon: p.hornWeapon, horn_equipped: !!p.hornEquipped } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.id),
    );
    check(await this.db.from("player_stats").upsert(this.statsRow(p)));
  }

  async getCounters(playerId: string): Promise<Counters> {
    const rows: any[] = many(await this.db.from("player_counters").select("key, value").eq("player_id", playerId));
    return Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  }

  async applyCounters(playerId: string, deltas: Parameters<GameStore["applyCounters"]>[1]): Promise<Counters> {
    if (Object.keys(deltas).length === 0) return this.getCounters(playerId);
    const out: any = check(await this.db.rpc("apply_counters", { p_player: playerId, p_deltas: deltas }));
    return Object.fromEntries(Object.entries(out ?? {}).map(([k, v]) => [k, Number(v)]));
  }

  // Skill definitions change only from the admin page: keep them for a little while
  // instead of asking the database on every request.
  private defsCache: { at: number; defs: SkillDefinition[] } | null = null;
  async listSkillDefs() {
    if (this.defsCache && Date.now() - this.defsCache.at < 30_000) return structuredClone(this.defsCache.defs);
    const rows: any[] = many(await this.db.from("skill_definitions").select("*").order("id"));
    const defs = rows.map(toDef);
    this.defsCache = { at: Date.now(), defs };
    return structuredClone(defs);
  }

  async saveSkillDef(d: SkillDefinition) {
    this.defsCache = null;
    check(
      await this.db.from("skill_definitions").upsert({
        id: d.id,
        name: d.name,
        description: d.description,
        kind: d.kind,
        hidden: d.hidden,
        conditions: d.conditions,
        effect: d.effect,
        locks: d.locks,
        owner_limit: d.limit,
        evolves_from: d.evolvesFrom,
        excludes: d.excludes,
        uses_per_battle: d.usesPerBattle,
        rumor: d.rumor,
        enabled: d.enabled,
        updated_at: new Date().toISOString(),
      }),
    );
  }

  async getPlayerSkills(playerId: string): Promise<PlayerSkill[]> {
    const rows: any[] = many(await this.db.from("player_skills").select("*").eq("player_id", playerId));
    return rows.map((r) => ({
      skillId: r.skill_id,
      status: r.status,
      equipped: r.equipped,
      stage: r.stage,
      evolvedInto: r.evolved_into,
      unlockedAt: r.unlocked_at,
    }));
  }

  async grantSkill(playerId: string, skillId: string, o: GrantOptions) {
    return !!check(
      await this.db.rpc("grant_skill", {
        p_player: playerId,
        p_skill: skillId,
        p_status: o.status,
        p_equipped: o.equipped,
        p_stage: o.stage,
        p_evolves_from: o.evolvesFrom,
      }),
    );
  }

  async updatePlayerSkill(playerId: string, skillId: string, patch: Partial<Pick<PlayerSkill, "status" | "equipped">>) {
    check(await this.db.from("player_skills").update(patch).eq("player_id", playerId).eq("skill_id", skillId));
  }

  async getInventory(playerId: string) {
    const rows: any[] = many(await this.db.from("items").select("item_id, qty").eq("player_id", playerId).gt("qty", 0));
    return rows.map((r) => ({ itemId: r.item_id, qty: r.qty }));
  }

  async changeItem(playerId: string, itemId: string, delta: number) {
    const cur: any = check(await this.db.from("items").select("qty").eq("player_id", playerId).eq("item_id", itemId).maybeSingle());
    const qty = Math.max(0, (cur?.qty ?? 0) + delta);
    check(await this.db.from("items").upsert({ player_id: playerId, item_id: itemId, qty }));
  }

  async getActiveBattle(playerId: string): Promise<BattleState | null> {
    const r: any = check(await this.db.from("battles").select("state").eq("player_id", playerId).eq("active", true).maybeSingle());
    return r?.state ?? null;
  }

  async saveBattle(state: BattleState, active: boolean) {
    check(
      await this.db
        .from("battles")
        .upsert({ id: state.id, player_id: state.playerId, state, active, updated_at: new Date().toISOString() }),
    );
  }

  async getUniqueItems(): Promise<UniqueItem[]> {
    const rows: any[] = many(await this.db.from("unique_items").select("*, players(name)"));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      ownerId: r.owner_id,
      ownerName: r.players?.name ?? null,
      level: r.level,
      exp: r.exp,
      statBonus: r.stat_bonus,
      attachedSkills: r.attached_skills,
      claimedAt: r.claimed_at,
      equipped: r.equipped,
    }));
  }

  async claimUniqueItem(itemId: string, playerId: string) {
    return !!check(await this.db.rpc("claim_unique_item", { p_item: itemId, p_player: playerId }));
  }

  async saveUniqueItem(u: UniqueItem) {
    check(await this.db.from("unique_items").update({ level: u.level, exp: u.exp, equipped: u.equipped }).eq("id", u.id));
  }

  async recordBreed(id: string, parts: string[], playerId: string) {
    const rows: any[] = many(await this.db.rpc("record_breed", { p_id: id, p_parts: parts, p_player: playerId }));
    return { isNew: !!rows[0]?.is_new, times: Number(rows[0]?.times ?? 1) };
  }

  async listBreeds() {
    const rows: any[] = many(
      await this.db.from("breeds").select("id, parts, first_bred_by, first_bred_at, times_bred, players(name)").order("first_bred_at", { ascending: false }).limit(200),
    );
    return rows.map((r) => ({
      id: r.id,
      parts: r.parts ?? [],
      firstBredBy: r.first_bred_by,
      firstBredByName: r.players?.name ?? null,
      firstBredAt: r.first_bred_at,
      timesBred: r.times_bred,
    }));
  }

  async recentUnlocks(limit: number) {
    const rows: any[] = many(
      await this.db
        .from("skill_unlock_log")
        .select("player_id, skill_id, created_at, players(name)")
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return rows.map((r) => ({ playerId: r.player_id, playerName: r.players?.name ?? "?", skillId: r.skill_id, at: r.created_at }));
  }

  async skillOwnerCounts() {
    const rows: any[] = many(await this.db.from("skill_ownership_stats").select("skill_id, owners"));
    return Object.fromEntries(rows.map((r) => [r.skill_id, Number(r.owners)]));
  }

  async playerCount() {
    const res = await this.db.from("players").select("id", { count: "exact", head: true });
    if (res.error) throw new Error(res.error.message);
    return res.count ?? 0;
  }
}
