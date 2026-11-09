"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UnlockNotice, getState } from "@/lib/game/service";
import { api } from "@/lib/client";
import { lookFor } from "./world/art";
import BattleScreen, { type Battle } from "./world/BattleScreen";
import Controls from "./world/Controls";
import { InputBus, useButtons, useKeyboard } from "./world/input";
import MenuPanels from "./world/MenuPanels";
import Overworld from "./world/Overworld";

type GameState = Awaited<ReturnType<typeof getState>>;

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-7 text-[10px] font-bold text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right font-mono text-[10px] text-muted">
        {Math.max(0, value)}/{max}
      </span>
    </div>
  );
}

/** A full-screen sheet over the game (menu, shop). B or the button closes it. */
function Sheet({ title, bus, onClose, children }: { title: string; bus: InputBus; onClose: () => void; children: React.ReactNode }) {
  useButtons(bus, (b) => {
    if (b === "b" || b === "menu") onClose();
    return true;
  });
  return (
    <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md self-start">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="title text-xl text-gold">{title}</h2>
          <button className="btn px-3 py-1" onClick={onClose}>
            Close (B)
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface BattleView {
  battle: Battle;
  next: Battle | null;
  resume: boolean;
}

export default function Game() {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocks, setUnlocks] = useState<UnlockNotice[]>([]);
  const [view, setView] = useState<BattleView | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [wakeAtInn, setWakeAtInn] = useState(0);
  const bus = useMemo(() => new InputBus(), []);
  useKeyboard(bus);

  const refresh = useCallback(async () => {
    try {
      const s = await api<GameState>("/api/state");
      setState(s);
      return s;
    } catch (e) {
      if ((e as { status?: number }).status === 401 || (e as { status?: number }).status === 404) router.replace("/");
      else setError((e as Error).message);
    }
  }, [router]);

  // first load: pick up a fight that was still going
  useEffect(() => {
    refresh().then((s) => {
      if (s?.battle) setView({ battle: s.battle, next: null, resume: true });
    });
  }, [refresh]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
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
    },
    [refresh],
  );

  // the unlock card sits above everything
  useButtons(
    bus,
    (b) => {
      if (b === "a" || b === "b") setUnlocks((q) => q.slice(1));
      return true;
    },
    unlocks.length > 0,
  );

  const look = useMemo(() => (state ? lookFor(state.player.appearance, state.player.classId) : null), [state]);

  if (!state || !look) {
    return <main className="flex min-h-screen items-center justify-center text-muted">{error ?? "Loading…"}</main>;
  }

  const { player, derived } = state;
  const offered = state.skills.filter((s) => s.status === "offered");
  const activeEquipped = state.skills.filter((s) => s.status === "owned" && s.kind === "active" && s.equipped);
  const inBattle = !!view;
  const hp = view ? view.battle.player.hp : player.currentHp;
  const mp = view ? view.battle.player.mp : player.currentMp;

  const onEncounter = async (zoneId: string, terrain: "grass" | "swamp" | null) => {
    const r = await run(() => api<{ battle: Battle }>("/api/battle/start", { zoneId, ...(terrain ? { terrain } : {}) }));
    if (!r) return false;
    bus.releaseAll();
    setView({ battle: r.battle, next: null, resume: false });
    return true;
  };

  const onAction = async (action: Record<string, unknown>) => {
    const r = await run(() => api<{ battle: Battle; nextBattle: Battle | null }>("/api/battle/action", { action }));
    if (r) setView((v) => (v ? { ...v, battle: r.battle, next: r.nextBattle, resume: false } : v));
  };

  const onContinue = () => {
    if (!view) return;
    if (view.next) return setView({ battle: view.next, next: null, resume: false });
    if (view.battle.result === "loss") setWakeAtInn((w) => w + 1);
    bus.releaseAll();
    setView(null);
    refresh();
  };

  const townCall = async (body: Record<string, unknown>) =>
    run(() => api<{ log?: string[]; rumors?: string[]; unlocks?: UnlockNotice[] }>("/api/town", body));

  return (
    <main className="mx-auto max-w-6xl px-2 py-2 sm:px-4 sm:py-4">
      {/* ---------- HUD ---------- */}
      <header className="panel mb-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 px-3 py-2">
        <div className="row-span-3 pr-1">
          <h1 className="title text-lg leading-tight text-gold">{player.name}</h1>
          <p className="text-[11px] text-muted">
            {state.className} · Lv {player.level}
          </p>
          <p className="text-[11px] text-muted">{player.gold} gold</p>
        </div>
        <Bar label="HP" value={hp} max={derived.maxHp} color="bg-blood" />
        <Bar label="MP" value={mp} max={derived.maxMp} color="bg-mana" />
        <Bar label="EXP" value={player.exp} max={state.expToNext} color="bg-gold" />
      </header>

      {error && (
        <div className="mb-2 rounded-lg border border-blood/40 bg-blood/10 px-3 py-2 text-sm text-blood" role="alert">
          {error}
        </div>
      )}

      <div className="gap-4 lg:grid lg:grid-cols-[1fr_340px]">
        <div className="mx-auto w-full max-w-3xl">
          {view && (
            <BattleScreen
              bus={bus}
              battle={view.battle}
              resume={view.resume}
              look={look}
              weapon={player.weapon}
              playerName={player.name}
              level={player.level}
              skills={activeEquipped}
              bag={state.inventory}
              busy={busy}
              onAction={onAction}
              onContinue={onContinue}
            />
          )}
          <div className={view ? "hidden" : ""}>
            <Overworld
              bus={bus}
              playerId={player.id}
              look={look}
              hp={player.currentHp}
              paused={inBattle || menuOpen || shopOpen || unlocks.length > 0}
              wakeAtInn={wakeAtInn}
              dungeonAttempts={player.dungeonAttempts}
              onEncounter={onEncounter}
              onRest={async () => (await townCall({ action: "rest" }))?.log ?? null}
              onRumors={async () => (await townCall({ action: "rumors" }))?.rumors ?? null}
              onShop={() => {
                bus.releaseAll();
                setShopOpen(true);
              }}
              onMenu={() => {
                bus.releaseAll();
                setMenuOpen(true);
              }}
            />
          </div>
          <Controls bus={bus} menuBadge={offered.length > 0 || player.freePoints > 0} />
          <p className="mt-2 hidden text-center text-xs text-muted sm:block">
            Keyboard: arrows or WASD to move · Z / Space / Enter = A · X / Esc = B · M = Menu
          </p>
        </div>

        <aside className="hidden lg:block">
          <MenuPanels state={state} busy={busy} inBattle={inBattle} run={run} />
        </aside>
      </div>

      {menuOpen && (
        <Sheet title="Menu" bus={bus} onClose={() => setMenuOpen(false)}>
          <MenuPanels state={state} busy={busy} inBattle={inBattle} run={run} />
        </Sheet>
      )}

      {shopOpen && (
        <Sheet title="Weapon shop" bus={bus} onClose={() => setShopOpen(false)}>
          <div className="panel space-y-2">
            <p className="text-sm text-muted">
              New weapons cost {state.weaponPrice} gold. You have {player.gold} gold. Weapons you own can be equipped for free.
            </p>
            {state.weapons.map((w) => {
              const equipped = player.weapon === w.type;
              return (
                <div key={w.type} className="flex items-center gap-2 rounded-lg bg-panel-2 p-2">
                  <div className="flex-1">
                    <div className="text-sm font-semibold">
                      {w.name}
                      {w.rarity && <span className="ml-1 text-[11px] font-normal text-muted">{w.rarity}</span>}
                    </div>
                    <div className="text-xs text-muted">{w.blurb}</div>
                  </div>
                  <button
                    className={`btn px-2 py-1 text-xs ${equipped ? "border-gold text-gold" : ""}`}
                    disabled={busy || equipped || (!w.owned && player.gold < state.weaponPrice)}
                    onClick={() => townCall({ action: "weapon", weapon: w.type })}
                  >
                    {equipped ? "Equipped" : w.owned ? "Equip" : `Buy · ${state.weaponPrice}g`}
                  </button>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}

      {/* ---------- Dramatic unlock notification ---------- */}
      {unlocks.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="unlock-card w-full max-w-md rounded-2xl border border-gold bg-panel p-6 text-center">
            <div className="label text-gold">{unlocks[0].evolvedFrom ? `${unlocks[0].evolvedFrom} evolves` : "Hidden skill unlocked"}</div>
            <h2 className="title mt-2 text-3xl text-gold">{unlocks[0].name}</h2>
            <p className="mt-3">{unlocks[0].description}</p>
            {unlocks[0].needsConfirmation && (
              <p className="mt-3 text-sm text-blood">This power has a price. Decide whether to accept it in your MENU.</p>
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
