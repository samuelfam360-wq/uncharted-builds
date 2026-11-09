"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { STAT_INFO } from "@/lib/game/constants";
import { STAT_KEYS, type StatKey } from "@/lib/game/types";
import type { UnlockNotice, getState, publicBattle } from "@/lib/game/service";
import { api } from "@/lib/client";

type GameState = Awaited<ReturnType<typeof getState>>;
type Battle = ReturnType<typeof publicBattle>;

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">
          {Math.max(0, value)} / {max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Statuses({ list }: { list: { type: string; turns: number }[] }) {
  if (!list.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {list.map((s) => (
        <span key={s.type} className="rounded bg-venom/20 px-1.5 py-0.5 text-[11px] text-venom">
          {s.type} {s.turns}
        </span>
      ))}
    </div>
  );
}

export default function Game() {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocks, setUnlocks] = useState<UnlockNotice[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [rumorList, setRumorList] = useState<string[]>([]);
  const [lastBattle, setLastBattle] = useState<Battle | null>(null);
  const [alloc, setAlloc] = useState<Partial<Record<StatKey, number>>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api<GameState>("/api/state"));
    } catch (e) {
      if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 404) router.replace("/");
      else setError((e as Error).message);
    }
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [state?.battle?.log.length, lastBattle?.log.length]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      const u = (r as { unlocks?: UnlockNotice[] })?.unlocks;
      if (u?.length) setUnlocks((q) => [...q, ...u]);
      await refresh();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return <main className="flex min-h-screen items-center justify-center text-muted">{error ?? "Loading…"}</main>;
  }

  const { player, derived, battle } = state;
  const offered = state.skills.filter((s) => s.status === "offered");
  const owned = state.skills.filter((s) => s.status === "owned");
  const activeEquipped = owned.filter((s) => s.kind === "active" && s.equipped);
  const allocTotal = Object.values(alloc).reduce((n, v) => n + (v ?? 0), 0);
  const shownBattle = battle ?? lastBattle;

  const act = (action: Record<string, unknown>) =>
    run(async () => {
      const r = await api<{ battle: Battle; nextBattle: Battle | null; unlocks: UnlockNotice[] }>("/api/battle/action", { action });
      setLastBattle(r.battle.over ? r.battle : null);
      if (r.nextBattle) setLastBattle(null);
      return r;
    });

  const startFight = (zoneId: string) =>
    run(async () => {
      setLastBattle(null);
      setNotes([]);
      return api("/api/battle/start", { zoneId });
    });

  const town = (body: Record<string, unknown>) =>
    run(async () => {
      const r = await api<{ log?: string[]; rumors?: string[]; unlocks?: UnlockNotice[] }>("/api/town", body);
      if (r.log) setNotes(r.log);
      if (r.rumors) setRumorList(r.rumors);
      return r;
    });

  const skill = (skillId: string, action: string) => run(() => api("/api/skills", { skillId, action }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-5">
      {/* ---------- Header ---------- */}
      <header className="panel mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-center">
        <div>
          <h1 className="title text-2xl text-gold">{player.name}</h1>
          <p className="text-xs text-muted">
            {state.className} · Level {player.level} · {player.gold} gold
          </p>
          <p className="text-xs text-muted/70">
            {state.look} · {state.weapons.find((w) => w.type === player.weapon)?.name}
          </p>
        </div>
        <div className="space-y-1.5">
          <Bar label="HP" value={battle ? battle.player.hp : player.currentHp} max={derived.maxHp} color="bg-blood" />
          <Bar label="MP" value={battle ? battle.player.mp : player.currentMp} max={derived.maxMp} color="bg-mana" />
        </div>
        <Bar label="EXP" value={player.exp} max={state.expToNext} color="bg-gold" />
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-blood/40 bg-blood/10 px-3 py-2 text-sm text-blood" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        {/* ---------- Main column ---------- */}
        <div className="space-y-4">
          {shownBattle ? (
            <section className="panel space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="label">
                    {state.zones.find((z) => z.id === shownBattle.zoneId)?.name}
                    {shownBattle.run && ` · Room ${shownBattle.run.room} of ${shownBattle.run.totalRooms}`}
                    {shownBattle.hazard && <span className="ml-2 text-venom">· {shownBattle.hazard}</span>}
                  </div>
                  <h2 className={`title mt-1 text-xl ${shownBattle.enemy.isBoss ? "text-blood" : ""}`}>{shownBattle.enemy.name}</h2>
                  <div className="mt-2 max-w-sm">
                    <Bar label="Enemy HP" value={shownBattle.enemy.hp} max={shownBattle.enemy.maxHp} color="bg-blood" />
                  </div>
                  <Statuses list={shownBattle.enemy.statuses} />
                </div>
                <div className="text-right">
                  <div className="label">You</div>
                  <Statuses list={shownBattle.player.statuses} />
                </div>
              </div>

              <div ref={logRef} className="h-64 overflow-y-auto rounded-lg bg-ink/80 p-3 font-mono text-[13px] leading-relaxed">
                {shownBattle.log.map((l, i) => (
                  <div key={i} className={l.startsWith("—") ? "mt-2 text-muted" : l.includes("Level up") || l.includes("one-of-a-kind") ? "text-gold" : ""}>
                    {l}
                  </div>
                ))}
              </div>

              {battle && !battle.over ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <button className="btn-primary" disabled={busy} onClick={() => act({ type: "attack" })}>
                      Attack
                    </button>
                    <button className="btn" disabled={busy} onClick={() => act({ type: "defend" })}>
                      Defend
                    </button>
                    <button className="btn" disabled={busy} onClick={() => act({ type: "wait" })}>
                      Wait
                    </button>
                    <select
                      className="btn"
                      disabled={busy || state.inventory.length === 0}
                      value=""
                      onChange={(e) => e.target.value && act({ type: "eat", itemId: e.target.value })}
                      aria-label="Eat an item"
                    >
                      <option value="">Eat…</option>
                      {state.inventory.map((i) => (
                        <option key={i.itemId} value={i.itemId}>
                          {i.name} ×{i.qty}
                        </option>
                      ))}
                    </select>
                    <button className="btn-danger" disabled={busy} onClick={() => act({ type: "flee" })}>
                      Flee
                    </button>
                  </div>
                  {activeEquipped.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {activeEquipped.map((s) => {
                        const used = battle.skillUses[s.id] ?? 0;
                        const out = s.usesPerBattle !== null && used >= s.usesPerBattle;
                        return (
                          <button
                            key={s.id}
                            className="btn border-gold/40 text-gold"
                            disabled={busy || out || battle.player.mp < s.mpCost}
                            onClick={() => act({ type: "skill", skillId: s.id })}
                            title={s.description}
                          >
                            {s.name}
                            <span className="text-xs text-mana">{s.mpCost} MP</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`title text-lg ${shownBattle.result === "win" ? "text-moss" : shownBattle.result === "loss" ? "text-blood" : "text-muted"}`}>
                    {shownBattle.result === "win" ? "Victory" : shownBattle.result === "loss" ? "Defeated" : "Escaped"}
                  </span>
                  <span className="flex-1" />
                  {shownBattle.result !== "loss" && shownBattle.kind === "field" && (
                    <button className="btn-primary" disabled={busy} onClick={() => startFight(shownBattle.zoneId)}>
                      Fight again
                    </button>
                  )}
                  <button className="btn" onClick={() => setLastBattle(null)}>
                    Back to map
                  </button>
                </div>
              )}
            </section>
          ) : (
            <>
              {state.zones.map((z) => (
                <section key={z.id} className="panel">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-lg">
                      <div className="label">{z.kind === "town" ? "Town" : z.kind === "field" ? "Field" : "Dungeon"}</div>
                      <h2 className="title text-xl">{z.name}</h2>
                      <p className="mt-1 text-sm text-muted">{z.description}</p>
                      {z.kind === "dungeon" && (
                        <p className="mt-1 text-xs text-gold/80">
                          {(player.dungeonAttempts[z.id] ?? 0) === 0
                            ? "Your first attempt. Legends say the Hollow rewards those who clear it alone on their first try."
                            : `Attempts so far: ${player.dungeonAttempts[z.id]}`}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {z.kind === "town" ? (
                        <>
                          <button className="btn-primary" disabled={busy} onClick={() => town({ action: "rest" })}>
                            Rest at the inn
                          </button>
                          <button className="btn" disabled={busy} onClick={() => town({ action: "rumors" })}>
                            Listen for rumors
                          </button>
                        </>
                      ) : (
                        <button
                          className={z.kind === "dungeon" ? "btn-danger" : "btn-primary"}
                          disabled={busy || player.currentHp <= 0}
                          onClick={() => startFight(z.id)}
                        >
                          {z.kind === "dungeon" ? "Enter the dungeon" : "Look for a fight"}
                        </button>
                      )}
                    </div>
                  </div>
                  {z.kind === "town" && (
                    <div className="mt-4 space-y-3">
                      {player.currentHp <= 0 && <p className="text-sm text-blood">You&apos;re too hurt to fight. Rest first.</p>}
                      {notes.map((n, i) => (
                        <p key={i} className="text-sm text-moss">
                          {n}
                        </p>
                      ))}
                      {rumorList.length > 0 && (
                        <ul className="space-y-1 border-l-2 border-gold/40 pl-3 text-sm italic text-muted">
                          {rumorList.map((r) => (
                            <li key={r}>“{r}”</li>
                          ))}
                        </ul>
                      )}
                      <div>
                        <div className="label mb-1">Armory · new weapons {state.weaponPrice} gold</div>
                        <div className="flex flex-wrap gap-1.5">
                          {state.weapons.map((w) => (
                            <button
                              key={w.type}
                              className={`btn px-2 py-1 text-xs ${player.weapon === w.type ? "border-gold text-gold" : ""}`}
                              disabled={busy || player.weapon === w.type}
                              onClick={() => town({ action: "weapon", weapon: w.type })}
                              title={w.blurb}
                            >
                              {w.name}
                              {!w.owned && <span className="text-gold/70">· buy</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              ))}
            </>
          )}
        </div>

        {/* ---------- Side column ---------- */}
        <aside className="space-y-4">
          {offered.map((s) => (
            <section key={s.id} className="panel border-gold/60">
              <div className="label text-gold">A power awakens</div>
              <h3 className="title mt-1 text-lg text-gold">{s.name}</h3>
              <p className="mt-1 text-sm">{s.description}</p>
              {s.locks.length > 0 && (
                <p className="mt-2 text-sm text-blood">Accepting locks {s.locks.join(" and ")} forever. Points already spent stay.</p>
              )}
              {s.excludes.length > 0 && <p className="mt-1 text-sm text-blood">It closes the path to {s.excludes.join(", ")} forever.</p>}
              <div className="mt-3 flex gap-2">
                <button className="btn-primary" disabled={busy || !!battle} onClick={() => skill(s.id, "accept")}>
                  Accept
                </button>
                <button className="btn-danger" disabled={busy || !!battle} onClick={() => skill(s.id, "decline")}>
                  Refuse forever
                </button>
              </div>
            </section>
          ))}

          <section className="panel">
            <div className="flex items-baseline justify-between">
              <h3 className="title text-lg">Stats</h3>
              {player.freePoints > 0 && <span className="text-sm text-gold">{player.freePoints - allocTotal} free points</span>}
            </div>
            <div className="mt-2 divide-y divide-line">
              {STAT_KEYS.map((k) => {
                const locked = player.lockedStats.includes(k);
                return (
                  <div key={k} className="flex items-center gap-2 py-1.5 text-sm" title={STAT_INFO[k]}>
                    <span className="w-9 font-mono font-bold">{k}</span>
                    <span className="flex-1 font-mono">
                      {derived.stats[k]}
                      {derived.stats[k] !== player.stats[k] && <span className="ml-1 text-xs text-muted">({player.stats[k]} base)</span>}
                      {(alloc[k] ?? 0) > 0 && <span className="ml-1 text-gold">+{alloc[k]}</span>}
                    </span>
                    {locked && <span className="text-xs text-blood">locked</span>}
                    {player.freePoints > 0 && !battle && !locked && (
                      <button
                        className="btn px-2 py-0.5"
                        disabled={allocTotal >= player.freePoints}
                        onClick={() => setAlloc((a) => ({ ...a, [k]: (a[k] ?? 0) + 1 }))}
                        aria-label={`Add a point to ${k}`}
                      >
                        +
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {allocTotal > 0 && (
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-primary flex-1"
                  disabled={busy}
                  onClick={async () => {
                    await run(() => api("/api/stats", { add: alloc }));
                    setAlloc({});
                  }}
                >
                  Confirm (can&apos;t be undone)
                </button>
                <button className="btn" onClick={() => setAlloc({})}>
                  Reset
                </button>
              </div>
            )}
            {derived.immunities.length > 0 && <p className="mt-2 text-xs text-moss">Immune: {derived.immunities.join(", ")}</p>}
          </section>

          <section className="panel">
            <div className="flex items-baseline justify-between">
              <h3 className="title text-lg">Skills</h3>
              <span className="text-xs text-muted">
                Active {state.slots.active.used}/{state.slots.active.max} · Passive {state.slots.passive.used}/{state.slots.passive.max}
              </span>
            </div>
            {owned.length === 0 ? (
              <p className="mt-2 text-sm text-muted">
                None yet. There are no skills to buy here. Play the way you want, and the world will notice.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {owned.map((s) => (
                  <li key={s.id} className="rounded-lg bg-panel-2 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">
                        {s.name}
                        {s.stage > 1 && <span className="ml-1 text-xs text-gold">★{s.stage}</span>}
                      </span>
                      <button
                        className={`btn px-2 py-0.5 text-xs ${s.equipped ? "border-moss text-moss" : ""}`}
                        disabled={busy || !!battle}
                        onClick={() => skill(s.id, s.equipped ? "unequip" : "equip")}
                      >
                        {s.equipped ? "Equipped" : "Equip"}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      <span className="uppercase">{s.kind}</span> · {s.description}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {state.uniqueItem && (
            <section className="panel border-gold/60">
              <div className="label text-gold">Unique · one on the whole server</div>
              <h3 className="title text-lg text-gold">
                {state.uniqueItem.name} <span className="text-sm">Lv {state.uniqueItem.level}</span>
              </h3>
              <p className="mt-1 text-xs text-muted">{state.uniqueItem.description}</p>
            </section>
          )}

          <section className="panel">
            <h3 className="title text-lg">Bag</h3>
            {state.inventory.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Empty. Monsters drop things.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {state.inventory.map((i) => (
                  <li key={i.itemId} className="flex items-center gap-2 text-sm">
                    <span className="flex-1" title={i.description}>
                      {i.name} <span className="text-muted">×{i.qty}</span>
                    </span>
                    <button
                      className="btn px-2 py-0.5 text-xs"
                      disabled={busy || !!battle}
                      onClick={() => town({ action: "eat", itemId: i.itemId })}
                      title={i.edible ? "Eat" : "This doesn't look like food…"}
                    >
                      Eat
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            className="w-full text-xs text-muted underline-offset-2 hover:underline"
            onClick={async () => {
              if (!confirm("Start over with a new character? This one will be left behind.")) return;
              await api("/api/character", {}, "DELETE");
              router.replace("/");
            }}
          >
            Start a new character
          </button>
        </aside>
      </div>

      {/* ---------- Dramatic unlock notification ---------- */}
      {unlocks.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="unlock-card w-full max-w-md rounded-2xl border border-gold bg-panel p-6 text-center">
            <div className="label text-gold">{unlocks[0].evolvedFrom ? `${unlocks[0].evolvedFrom} evolves` : "Hidden skill unlocked"}</div>
            <h2 className="title mt-2 text-3xl text-gold">{unlocks[0].name}</h2>
            <p className="mt-3">{unlocks[0].description}</p>
            {unlocks[0].needsConfirmation && (
              <p className="mt-3 text-sm text-blood">This power has a price. Decide whether to accept it in your skill panel.</p>
            )}
            <p className="mt-4 text-xs italic text-muted">You can&apos;t quite tell what you did to earn it.</p>
            <button className="btn-primary mt-5 w-full" onClick={() => setUnlocks((q) => q.slice(1))}>
              {unlocks.length > 1 ? `Continue (${unlocks.length - 1} more)` : "Continue"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
