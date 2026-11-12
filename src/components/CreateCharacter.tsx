"use client";

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BASE_HP, BASE_MP, HP_PER_POINT, MP_PER_POINT, STAT_INFO, WEAPONS } from "@/lib/game/constants";
import { APPEARANCE_OPTIONS, BODY_OPTIONS, CLASS_BODY, CLASS_GLOW, CLASSES, DEFAULT_APPEARANCE, GLOW } from "@/lib/game/data/classes";
import { CLASS_IDS, STAT_KEYS, type Appearance, type ClassId, type StatKey } from "@/lib/game/types";
import { api } from "@/lib/client";
import { EYES, HAIR, SKIN, lookFor } from "./side/hero";

// the live 3D hero; it needs the browser, so it loads after the page
const AvatarPreview = dynamic(() => import("./three/AvatarPreview"), {
  ssr: false,
  loading: () => <div className="h-72 w-full rounded-lg border border-line bg-panel-2 sm:h-80" />,
});

/** Looks you pick by clicking a colour. */
const COLOUR_PICKS: { key: "skinTone" | "hairColor" | "eyeColor" | "glow"; colours: Record<string, string> }[] = [
  { key: "skinTone", colours: SKIN },
  { key: "hairColor", colours: HAIR },
  { key: "eyeColor", colours: EYES },
  { key: "glow", colours: GLOW },
];
/** Looks that only show in the 2D view. */
const SHAPE_PICKS = ["gender", "hairStyle", "build"] as const;

const NO_POINTS: Record<StatKey, number> = { HP: 0, MP: 0, STR: 0, VIT: 0, AGI: 0, DEX: 0, INT: 0 };
const STARTING_TOTAL = 10;

const fixedText = (id: ClassId) => {
  const parts = Object.entries(CLASSES[id].fixed).map(([k, v]) => `+${v} ${k}`);
  return parts.length ? parts.join(", ") : "10 free points";
};

export default function CreateCharacter() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [look, setLook] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [classId, setClassId] = useState<ClassId>("swordsman");
  const [stats, setStats] = useState<Record<StatKey, number>>(NO_POINTS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cls = CLASSES[classId];
  const fixed = (k: StatKey) => cls.fixed[k] ?? 0;
  const freeTotal = STARTING_TOTAL - STAT_KEYS.reduce((n, k) => n + fixed(k), 0);
  const spent = STAT_KEYS.reduce((n, k) => n + stats[k], 0);
  const left = freeTotal - spent;
  const bump = (k: StatKey, n: number) =>
    setStats((s) => ({ ...s, [k]: Math.max(0, Math.min(s[k] + n, s[k] + (n > 0 ? left : 0))) }));
  const allIn = (k: StatKey) => setStats({ ...NO_POINTS, [k]: freeTotal });
  const pickClass = (id: ClassId) => {
    setClassId(id);
    // a matching 3D body and glow colour; the player can still change them
    setLook((l) => ({ ...l, body: CLASS_BODY[id], glow: CLASS_GLOW[id] }));
    setStats(NO_POINTS); // free points differ between classes, so start the spend over
  };

  const hero = useMemo(() => lookFor(look, classId), [look, classId]);
  const bodyAt = Math.max(0, BODY_OPTIONS.indexOf((look.body ?? CLASS_BODY[classId]) as (typeof BODY_OPTIONS)[number]));
  const turnBody = (step: number) =>
    setLook((l) => ({ ...l, body: BODY_OPTIONS[(bodyAt + step + BODY_OPTIONS.length) % BODY_OPTIONS.length] }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/character", { name, classId, appearance: look, stats });
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
        <div>
          <label className="block space-y-1">
            <span className="label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="2 to 20 characters" required />
          </label>
        </div>
        <div>
          <div className="label mb-2">Your look</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <AvatarPreview look={hero} weapon={cls.weapon} />
              <div className="mt-2 flex items-center justify-center gap-3">
                <button type="button" className="btn px-3 py-1" onClick={() => turnBody(-1)} aria-label="Previous body">
                  ◀
                </button>
                <span className="w-28 text-center text-sm font-semibold" data-testid="body-name">
                  {BODY_OPTIONS[bodyAt]}
                </span>
                <button type="button" className="btn px-3 py-1" onClick={() => turnBody(1)} aria-label="Next body">
                  ▶
                </button>
              </div>
              <p className="mt-1 text-center text-xs text-muted">Drag your hero to turn it.</p>
            </div>
            <div className="space-y-3">
              {COLOUR_PICKS.map(({ key, colours }) => (
                <div key={key}>
                  <div className="mb-1 text-xs text-muted">
                    {APPEARANCE_OPTIONS[key].label}: <span className="text-text">{look[key]}</span>
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={APPEARANCE_OPTIONS[key].label}>
                    {APPEARANCE_OPTIONS[key].options.map((o) => (
                      <button
                        type="button"
                        key={o}
                        title={o}
                        aria-label={`${APPEARANCE_OPTIONS[key].label}: ${o}`}
                        aria-pressed={look[key] === o}
                        onClick={() => setLook((l) => ({ ...l, [key]: o }))}
                        className={`h-8 w-8 rounded-full border-2 transition ${look[key] === o ? "scale-110 border-gold ring-2 ring-gold/50" : "border-line hover:border-moss"}`}
                        style={{ background: colours[o] }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <details className="rounded-lg border border-line p-2">
                <summary className="cursor-pointer text-xs text-muted">More choices for the 2D view</summary>
                <div className="mt-2 space-y-2">
                  {SHAPE_PICKS.map((k) => (
                    <div key={k}>
                      <div className="mb-1 text-xs text-muted">{APPEARANCE_OPTIONS[k].label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {APPEARANCE_OPTIONS[k].options.map((o) => (
                          <button
                            type="button"
                            key={o}
                            aria-pressed={look[k] === o}
                            onClick={() => setLook((l) => ({ ...l, [k]: o }))}
                            className={`rounded-md border px-2 py-1 text-xs transition ${look[k] === o ? "border-gold bg-gold/10" : "border-line bg-panel-2 hover:border-moss"}`}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="panel space-y-3">
        <h2 className="title text-xl">2. Class</h2>
        <p className="text-sm text-muted">
          Your class sets your starting stat points and your Common wood weapon. It restricts nothing later: you can use any weapon and grow any
          mastery.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CLASS_IDS.map((id) => (
            <button
              type="button"
              key={id}
              onClick={() => pickClass(id)}
              aria-pressed={classId === id}
              className={`rounded-lg border p-3 text-left text-sm transition ${classId === id ? "border-gold bg-gold/10" : "border-line bg-panel-2 hover:border-moss"}`}
            >
              <div className="font-semibold">{CLASSES[id].name}</div>
              <div className="mt-1 font-mono text-xs text-gold/80">{fixedText(id)}</div>
              <div className="mt-1 text-xs text-muted">{CLASSES[id].weapon === "unarmed" ? "No weapon" : WEAPONS[CLASSES[id].weapon].name}</div>
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
          {cls.id === "free"
            ? "The Free Class has no fixed points: all 10 are yours."
            : `${cls.name} already has ${fixedText(cls.id)}. Spend your ${freeTotal} free points however you like.`}{" "}
          Putting every point into one stat is allowed. Points can&apos;t be refunded later.
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
              <div className="w-10 text-center font-mono">
                {stats[k] + fixed(k)}
                {fixed(k) > 0 && <span className="block text-[10px] text-gold/70">+{fixed(k)} class</span>}
              </div>
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
            Max HP <b className="text-blood">{BASE_HP + (stats.HP + fixed("HP")) * HP_PER_POINT}</b>
          </span>
          <span>
            Max MP <b className="text-mana">{BASE_MP + (stats.MP + fixed("MP")) * MP_PER_POINT}</b>
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
