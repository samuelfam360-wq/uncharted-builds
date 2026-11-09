"use client";

import { useCallback, useEffect, useState } from "react";
import { COUNTER_KEYS } from "@/lib/game/counters";
import type { SkillDefinition, UniqueItem, UnlockLogEntry } from "@/lib/game/types";
import { api } from "@/lib/client";

type AdminSkill = SkillDefinition & { owners: number };
interface Overview {
  store: string;
  players: number;
  unlocks: UnlockLogEntry[];
  uniques: UniqueItem[];
}

export default function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([api<{ skills: AdminSkill[] }>("/api/admin/skills"), api<Overview>("/api/admin/overview")]);
      setSkills(s.skills);
      setOverview(o);
      setAuthed(true);
    } catch (e) {
      setAuthed(false);
      if ((e as { status?: number }).status === 403) setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function pick(s: AdminSkill) {
    setSelected(s.id);
    const { owners: _owners, ...def } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
    setDraft(JSON.stringify(def, null, 2));
    setMsg(null);
  }

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setMsg({ ok: false, text: "That isn't valid JSON." });
      return;
    }
    try {
      await api("/api/admin/skills", { skill: parsed }, "PUT");
      setMsg({ ok: true, text: "Saved. Live for future unlocks right away. Existing owners keep their skill." });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  if (authed === null) return <main className="p-8 text-muted">Loading…</main>;

  if (!authed) {
    return (
      <main className="mx-auto max-w-sm px-4 py-16">
        <form
          className="panel space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/api/admin/login", { password });
              setMsg(null);
              await load();
            } catch (err) {
              setMsg({ ok: false, text: (err as Error).message });
            }
          }}
        >
          <h1 className="title text-2xl">Admin</h1>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Admin password" />
          <button className="btn-primary w-full">Sign in</button>
          {msg && <p className="text-sm text-blood">{msg.text}</p>}
        </form>
      </main>
    );
  }

  const current = skills.find((s) => s.id === selected);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h1 className="title text-2xl text-gold">Skill admin</h1>
        <span className="text-sm text-muted">
          {overview?.players ?? 0} players · storage: {overview?.store}
          {overview?.store === "memory" && " (resets on restart, set Supabase env vars to persist)"}
        </span>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="panel max-h-[75vh] overflow-y-auto p-2">
          <ul>
            {skills.map((s) => (
              <li key={s.id}>
                <button
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-panel-2 ${selected === s.id ? "bg-panel-2 text-gold" : ""}`}
                  onClick={() => pick(s)}
                >
                  <span className={`flex-1 ${s.enabled ? "" : "text-muted line-through"}`}>{s.name}</span>
                  {s.locks.length > 0 && <span className="text-[10px] text-blood">lock</span>}
                  {s.limit !== null && <span className="text-[10px] text-gold">limit {s.limit}</span>}
                  {s.evolvesFrom && <span className="text-[10px] text-venom">evo</span>}
                  <span className="w-8 text-right font-mono text-xs text-muted" title="Owners">
                    {s.owners}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          {current ? (
            <div className="panel space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="title text-xl">{current.name}</h2>
                <span className="text-sm text-muted">{current.owners} owner(s)</span>
              </div>
              <p className="text-sm text-muted">
                Edit the whole definition as JSON. Conditions support <code>all</code>, <code>any</code> and <code>not</code> groups with leaves{" "}
                <code>counter</code>, <code>stat</code>, <code>player: &quot;level&quot;</code>, <code>battle</code>, <code>skill</code> and{" "}
                <code>zone</code>. Prefer tightening conditions over changing effects.
              </p>
              <textarea
                className="input h-[52vh] font-mono text-xs leading-relaxed"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary" onClick={save}>
                  Save
                </button>
                <button className="btn" onClick={() => pick(current)}>
                  Revert
                </button>
                {msg && <span className={`text-sm ${msg.ok ? "text-moss" : "text-blood"}`}>{msg.text}</span>}
              </div>
            </div>
          ) : (
            <div className="panel text-sm text-muted">Pick a skill to edit its conditions, effects, locks and limits.</div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel">
              <h3 className="title text-lg">Recent unlocks</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {overview?.unlocks.length ? (
                  overview.unlocks.map((u, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="flex-1">
                        <b>{u.playerName}</b> · {skills.find((s) => s.id === u.skillId)?.name ?? u.skillId}
                      </span>
                      <span className="text-xs text-muted">{new Date(u.at).toLocaleString()}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-muted">None yet.</li>
                )}
              </ul>
              <h3 className="title mt-4 text-lg">Unique items</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {overview?.uniques.map((u) => (
                  <li key={u.id}>
                    {u.name}: {u.ownerName ? <b className="text-gold">{u.ownerName} (Lv {u.level})</b> : <span className="text-muted">unclaimed</span>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel">
              <h3 className="title text-lg">Counter keys</h3>
              <p className="text-xs text-muted">
                Also tracked: <code>kills_&lt;weapon&gt;</code>, <code>defeated_&lt;monster&gt;</code>, <code>ate_&lt;item&gt;</code>,{" "}
                <code>skill_used_&lt;skill&gt;</code>, <code>cleared_&lt;dungeon&gt;</code>.
              </p>
              <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto text-xs">
                {Object.entries(COUNTER_KEYS).map(([k, v]) => (
                  <li key={k}>
                    <code className="text-moss">{k}</code> <span className="text-muted">{v}</span>
                  </li>
                ))}
              </ul>
              <h3 className="title mt-4 text-lg">Battle keys</h3>
              <p className="text-xs text-muted">
                result, kind, zone, weapon, turns, attacks_made, direct_damage_dealt, damage_taken, min_hp_pct, final_hp_pct, enemy_id, enemy_type,
                enemy_is_boss, in_hazard, dungeon_cleared, dungeon_direct_damage, dungeon_first_attempt
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
