"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BASE_HP, BASE_MP, HP_PER_POINT, MP_PER_POINT, STARTING_POINTS, STAT_INFO, WEAPONS } from "@/lib/game/constants";
import { STAT_KEYS, WEAPON_TYPES, type StatKey, type WeaponType } from "@/lib/game/types";
import { api } from "@/lib/client";

const LOOKS = ["Wanderer", "Hooded rogue", "Armored knight", "Robed scholar", "Wild hunter", "Bandaged brawler"];

export default function CreateCharacter() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [look, setLook] = useState(LOOKS[0]);
  const [weapon, setWeapon] = useState<WeaponType>("sword");
  const [stats, setStats] = useState<Record<StatKey, number>>({ HP: 0, MP: 0, STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const spent = STAT_KEYS.reduce((n, k) => n + stats[k], 0);
  const left = STARTING_POINTS - spent;
  const bump = (k: StatKey, n: number) =>
    setStats((s) => ({ ...s, [k]: Math.max(0, Math.min(s[k] + n, s[k] + (n > 0 ? left : 0))) }));
  const allIn = (k: StatKey) => setStats({ HP: 0, MP: 0, STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0, [k]: STARTING_POINTS });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/character", { name, appearance: look, weapon, stats });
      router.push("/play");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="panel space-y-4">
        <h2 className="title text-xl">1. Who are you?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="2 to 20 characters" required />
          </label>
          <label className="block space-y-1">
            <span className="label">Appearance</span>
            <select className="input" value={look} onChange={(e) => setLook(e.target.value)}>
              {LOOKS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="panel space-y-3">
        <h2 className="title text-xl">2. Starting weapon</h2>
        <p className="text-sm text-muted">This only sets your starting gear. It is not a class, and you can switch weapons any time in town.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WEAPON_TYPES.map((w) => (
            <button
              type="button"
              key={w}
              onClick={() => setWeapon(w)}
              className={`rounded-lg border p-3 text-left text-sm transition ${weapon === w ? "border-gold bg-gold/10" : "border-line bg-panel-2 hover:border-moss"}`}
            >
              <div className="font-semibold">{WEAPONS[w].name}</div>
              <div className="mt-1 text-xs text-muted">{WEAPONS[w].blurb}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="panel space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="title text-xl">3. Spend your points</h2>
          <span className={`font-mono text-lg ${left === 0 ? "text-muted" : "text-gold"}`}>{left} left</span>
        </div>
        <p className="text-sm text-muted">
          Spend them however you like. Putting every point into one stat is allowed. Points can&apos;t be refunded later.
        </p>
        <div className="divide-y divide-line">
          {STAT_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-3 py-2">
              <div className="w-10 font-mono font-bold">{k}</div>
              <div className="flex-1 text-xs text-muted sm:text-sm">{STAT_INFO[k]}</div>
              <button type="button" className="btn px-2 py-1" onClick={() => bump(k, -5)} disabled={stats[k] === 0} aria-label={`-5 ${k}`}>
                −5
              </button>
              <button type="button" className="btn px-2 py-1" onClick={() => bump(k, -1)} disabled={stats[k] === 0} aria-label={`-1 ${k}`}>
                −
              </button>
              <div className="w-8 text-center font-mono">{stats[k]}</div>
              <button type="button" className="btn px-2 py-1" onClick={() => bump(k, 1)} disabled={left === 0} aria-label={`+1 ${k}`}>
                +
              </button>
              <button type="button" className="btn px-2 py-1" onClick={() => bump(k, 5)} disabled={left === 0} aria-label={`+5 ${k}`}>
                +5
              </button>
              <button type="button" className="btn hidden px-2 py-1 text-xs sm:inline-flex" onClick={() => allIn(k)}>
                All in
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-4 text-sm text-muted">
          <span>
            Max HP <b className="text-blood">{BASE_HP + stats.HP * HP_PER_POINT}</b>
          </span>
          <span>
            Max MP <b className="text-mana">{BASE_MP + stats.MP * MP_PER_POINT}</b>
          </span>
        </div>
      </section>

      {error && <p className="rounded-lg border border-blood/40 bg-blood/10 p-3 text-sm text-blood">{error}</p>}
      <button className="btn-primary w-full py-3 text-base" disabled={busy || name.trim().length < 2}>
        {busy ? "Entering the world…" : left > 0 ? `Begin (keep ${left} points for later)` : "Begin"}
      </button>
    </form>
  );
}
