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
  const skill = (skillId: string, action: string) => run(() => api("/api/skills", { skillId, action, withState: true }));
  const town = (body: Record<string, unknown>) => run(() => api("/api/town", { ...body, withState: true }));
  const pets = (body: Record<string, unknown>) => run(() => api("/api/pets", { ...body, withState: true }));
  const [mate, setMate] = useState<{ a: string; b: string }>({ a: "", b: "" });
  const [breedMsg, setBreedMsg] = useState<string[]>([]);
  const [breeds, setBreeds] = useState<{ id: string; name: string; firstBredBy: string | null; timesBred: number }[] | null>(null);
  const grown = state.pets.filter((p) => p.level >= state.breeding.level);
  const food = state.inventory.filter((i) => i.edible && i.qty > 0);
  const [petMsg, setPetMsg] = useState<{ id: string; text: string } | null>(null);
  const feed = async (petId: string, itemId: string) => {
    const r = await run(() => api<{ log: string[] }>("/api/pets", { action: "feed", petId, itemId, withState: true }));
    if (r) setPetMsg({ id: petId, text: r.log.join(" ") });
  };
  const breedNow = async () => {
    const r = await run(() => api<{ log: string[] }>("/api/pets", { action: "breed", a: mate.a, b: mate.b, withState: true }));
    if (r) {
      setBreedMsg(r.log);
      setMate({ a: "", b: "" });
    }
  };
  const showBreeds = async () => {
    const r = await run(() => api<{ breeds: { id: string; name: string; firstBredBy: string | null; timesBred: number }[] }>("/api/pets", { action: "breeds", withState: true }));
    if (r) setBreeds(r.breeds);
  };

  return (
    <div className="space-y-4">

    {state.hornWeapon && (
      <section className="panel border-gold/60" data-testid="horn-weapon">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="label text-gold">{state.hornWeapon.grade} grade weapon</div>
            <div className="text-sm font-semibold">{state.hornWeapon.name}</div>
            <div className="text-xs text-muted">
              Attack {state.hornWeapon.attack} · +{state.hornWeapon.str} STR while equipped · You can only ever have one.
            </div>
          </div>
          <button
            className={`btn px-2 py-1 text-xs ${state.hornWeapon.equipped ? "border-gold text-gold" : ""}`}
            disabled={busy || battle}
            onClick={() => town({ action: "weapon", horn: state.hornWeapon!.equipped ? "unequip" : "equip" })}
          >
            {state.hornWeapon.equipped ? "Unequip" : "Equip"}
          </button>
        </div>
      </section>
    )}
    {state.firstPetChoices.length > 0 && (
      <section className="panel border-gold/60">
        <div className="label text-gold">Tamer</div>
        <h3 className="title mt-1 text-lg text-gold">Choose your first pet</h3>
        <p className="mt-1 text-sm">Pick one of the Mirewood Fields monsters. It starts at level 1 and fights beside you.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {state.firstPetChoices.map((c) => (
            <button key={c.species} className="btn" disabled={busy || !!battle} onClick={() => pets({ action: "choose_first", species: c.species })}>
              {c.name}
            </button>
          ))}
        </div>
      </section>
    )}
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
              await run(() => api("/api/stats", { add: alloc, withState: true }));
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
          Active {state.slots.active.used}/{state.slots.active.max} · Passive {state.slots.passive.used}
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

    {state.pets.length > 0 && (
      <section className="panel">
        <h3 className="title text-lg">Pets</h3>
        <p className="mt-1 text-xs text-muted">
          Pets out: {state.pets.filter((p) => p.active).length}/{state.summonLimit}. A pet shares the EXP of every fight it&apos;s out for, and earns pet points from kills.
        </p>
        <ul className="mt-2 space-y-2">
          {state.pets.map((pet) => (
            <li key={pet.id} className={`rounded-lg bg-panel-2 p-2 ${pet.active ? "ring-1 ring-moss/70" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {pet.name} <span className="text-xs text-muted">Lv {pet.level}</span>
                </span>
                <button
                  className={`btn px-2 py-0.5 text-xs ${pet.active ? "border-moss text-moss" : ""}`}
                  disabled={busy || !!battle}
                  onClick={() => pets({ action: "set_active", petId: pet.id, out: !pet.active })}
                >
                  {pet.active ? "Out · call back" : "Send out"}
                </button>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/40">
                <div className="h-full bg-gold" style={{ width: `${pet.expToNext ? Math.min(100, (pet.exp / pet.expToNext) * 100) : 100}%` }} />
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs" title={`Bond grows from wins while it's out, meals, and time out with you. Each heart: +2% to all its stats.`}>
                <span className="tracking-tight text-[#ff7aa8]" aria-label={`${pet.hearts} of 5 hearts`}>
                  {"♥".repeat(pet.hearts)}
                  <span className="text-white/20">{"♥".repeat(5 - pet.hearts)}</span>
                </span>
                <span className="text-[10px] text-muted">Bond {pet.nextHeart ? `${pet.bond}/${pet.nextHeart}` : `${pet.bond} (full)`}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-muted">
                EXP {pet.expToNext ? `${pet.exp}/${pet.expToNext}` : "max level"} · Pet points {pet.petPoints} · Kills {pet.kills}
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
                {(Object.keys(pet.stats) as (keyof typeof pet.stats)[]).map((k) => (
                  <div key={k} className="flex items-center gap-1">
                    <span className="w-7 font-semibold">{k}</span>
                    <span>
                      {pet.stats[k]}
                      <span className="text-muted">/{pet.caps[k]}</span>
                    </span>
                    {pet.freePoints > 0 && pet.stats[k] < pet.caps[k] && (
                      <button className="btn ml-auto px-1.5 py-0 text-[10px]" disabled={busy || !!battle} onClick={() => pets({ action: "add_points", petId: pet.id, alloc: { [k]: 1 } })}>
                        +
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {pet.freePoints > 0 && <div className="mt-1 text-[10px] text-gold">{pet.freePoints} points to place</div>}
              {pet.parents && <div className="mt-1 text-[10px] text-muted">Bred from a {pet.parents[0]} and a {pet.parents[1]}</div>}
              <div className="mt-1 text-[10px]">
                <span className="text-muted">
                  Traits ({pet.traits.filter((t) => t.on).length}/{pet.slots} on):
                </span>{" "}
                {pet.traits.map((t) => {
                  const onList = pet.traits.filter((x) => x.on).map((x) => x.id);
                  const next = t.on ? onList.filter((x) => x !== t.id) : [...onList, t.id];
                  return (
                    <button
                      key={t.id}
                      className={`btn mr-1 px-1.5 py-0 text-[10px] ${t.on ? "border-moss text-moss" : "opacity-70"}`}
                      title={`${t.description} ${t.on ? "Click to switch off." : "Click to switch on."}`}
                      disabled={busy || !!battle || (!t.on && onList.length >= pet.slots)}
                      onClick={() => pets({ action: "set_traits", petId: pet.id, traits: next })}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
              {pet.learnable.length > 0 && pet.petPoints >= pet.learnable[0].cost && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                  <span className="text-muted">Learn ({pet.learnable[0].cost} pet points):</span>
                  {pet.learnable.map((t) => (
                    <button key={t.id} className="btn px-1.5 py-0 text-[10px]" disabled={busy || !!battle} onClick={() => pets({ action: "learn_trait", petId: pet.id, traitId: t.id })}>
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
              {food.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                  <span className="text-muted">Feed:</span>
                  {food.map((f) => (
                    <button key={f.itemId} className="btn px-1.5 py-0 text-[10px]" disabled={busy || !!battle} onClick={() => void feed(pet.id, f.itemId)}>
                      {f.name} ×{f.qty}
                    </button>
                  ))}
                </div>
              )}
              {petMsg?.id === pet.id && <div className="mt-1 text-[10px] text-moss">{petMsg.text}</div>}
            </li>
          ))}
        </ul>

        <div className="mt-3 rounded-lg bg-panel-2 p-2">
          <div className="text-sm font-semibold">Breeding</div>
          <p className="mt-1 text-xs text-muted">
            Two pets of level {state.breeding.level} or more make a baby: a new mixed monster that looks like both. Needs Taming mastery level {state.breeding.tamingLevel}.
          </p>
          {!state.breeding.tamingOk ? (
            <p className="mt-1 text-xs text-blood">Your Taming mastery isn&apos;t high enough yet.</p>
          ) : grown.length < 2 ? (
            <p className="mt-1 text-xs text-muted">You need two pets at level {state.breeding.level}.</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {(["a", "b"] as const).map((k) => (
                <select key={k} className="rounded bg-black/30 px-1 py-0.5" value={mate[k]} onChange={(ev) => setMate({ ...mate, [k]: ev.target.value })}>
                  <option value="">Pick a pet</option>
                  {grown
                    .filter((p) => p.id !== (k === "a" ? mate.b : mate.a))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} Lv {p.level}
                      </option>
                    ))}
                </select>
              ))}
              <button className="btn px-2 py-0.5 text-xs" disabled={busy || !!battle || !mate.a || !mate.b} onClick={() => void breedNow()}>
                Breed
              </button>
            </div>
          )}
          {breedMsg.map((l) => (
            <p key={l} className="mt-1 text-xs text-gold">
              {l}
            </p>
          ))}
          <button className="mt-2 text-[10px] underline text-muted" onClick={() => void showBreeds()}>
            Every breed in the world
          </button>
          {breeds && (
            <ul className="mt-1 space-y-0.5 text-[10px]">
              {breeds.length === 0 && <li className="text-muted">No one has bred a new monster yet.</li>}
              {breeds.map((b) => (
                <li key={b.id}>
                  <span className="font-semibold">{b.name}</span> · first bred by {b.firstBredBy ?? "someone"} · born {b.timesBred}×
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    )}

    {state.eggs.length > 0 && (
      <section className="panel border-gold/40">
        <h3 className="title text-lg">Eggs</h3>
        <ul className="mt-2 space-y-2">
          {state.eggs.map((egg) => (
            <li key={egg.boss} className="rounded-lg bg-panel-2 p-2 text-sm">
              <div className="font-semibold">{egg.name}</div>
              {egg.hatch ? (
                <>
                  <p className="mt-1 text-xs">{egg.hatch}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/40">
                    <div className="h-full bg-gold" style={{ width: `${Math.floor((egg.pct ?? 0) * 100)}%` }} />
                  </div>
                  {egg.needs && <p className="mt-1 text-xs text-blood">It also needs: {egg.needs}</p>}
                </>
              ) : (
                <p className="mt-1 text-xs text-muted">It won&apos;t hatch yet. Something has to happen first: <span className="tracking-widest text-gold">??????</span></p>
              )}
            </li>
          ))}
        </ul>
      </section>
    )}

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
