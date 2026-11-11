"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { STAT_INFO } from "@/lib/game/constants";
import { STAT_KEYS, type StatKey } from "@/lib/game/types";
import type { getState } from "@/lib/game/service";
import { api } from "@/lib/client";

type GameState = Awaited<ReturnType<typeof getState>>;

/** Stats, skills, bag and the rest: the side column on big screens, the MENU on phones. */
export default function MenuPanels({
  state,
  busy,
  inBattle,
  run,
}: {
  state: GameState;
  busy: boolean;
  inBattle: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}) {
  const router = useRouter();
  const [alloc, setAlloc] = useState<Partial<Record<StatKey, number>>>({});
  const { player, derived } = state;
  const battle = inBattle;
  const offered = state.skills.filter((s) => s.status === "offered");
  const owned = state.skills.filter((s) => s.status === "owned");
  const allocTotal = Object.values(alloc).reduce((n, v) => n + (v ?? 0), 0);
  const skill = (skillId: string, action: string) => run(() => api("/api/skills", { skillId, action }));
  const town = (body: Record<string, unknown>) => run(() => api("/api/town", body));

  return (
    <div className="space-y-4">
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
                <span className="uppercase">{s.ultimate ? "ultimate" : s.kind}</span> · {s.description}
              </p>
              {s.needsWeapon && <p className="mt-1 text-xs text-blood">Asleep: needs {s.needsWeapon.join(" or ")} in hand.</p>}
              {s.earnedBy?.length > 0 && <p className="mt-1 text-xs italic text-muted">Earned by: {s.earnedBy.join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>

    {state.hints.length > 0 && (
      <section className="panel border-gold/40">
        <h3 className="title text-lg text-gold">Something stirs…</h3>
        <p className="mt-1 text-xs text-muted">You&apos;re close to a hidden skill. Its name stays a secret until you earn it.</p>
        <ul className="mt-2 space-y-2">
          {state.hints.map((h, i) => (
            <li key={i} className="rounded-lg bg-panel-2 p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-widest text-gold">??????</span>
                <span className="ml-auto text-xs text-muted">{Math.floor(h.pct * 100)}%</span>
              </div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {h.left.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    )}

    <section className="panel">
      <h3 className="title text-lg">Masteries</h3>
      <p className="mt-1 text-xs text-muted">Each weapon grows as you use it. Your class&apos;s own mastery grows 20% faster.</p>
      <ul className="mt-2 grid grid-cols-2 gap-2">
        {state.masteries.map((m) => {
          const inHand = m.usedBy.includes(player.weapon);
          return (
            <li key={m.id} className={`rounded-lg bg-panel-2 p-2 ${inHand ? "ring-1 ring-gold/60" : ""}`}>
              <div className="flex items-baseline justify-between gap-1 text-sm">
                <span className="font-semibold">
                  {m.name}
                  {m.classBonus && <span className="ml-1 text-[10px] text-gold" title="Your class's mastery: grows 20% faster">+20%</span>}
                </span>
                <span className="text-xs text-muted">Lv {m.level}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/40">
                <div className="h-full bg-gold" style={{ width: `${m.next ? Math.min(100, (m.xp / m.next) * 100) : 100}%` }} />
              </div>
              <div className="mt-0.5 text-[10px] text-muted">{m.id === "crafting" ? "Grows by crafting (coming later)" : m.next ? `${m.xp}/${m.next}` : "Max level"}</div>
            </li>
          );
        })}
      </ul>
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
    </div>
  );
}
