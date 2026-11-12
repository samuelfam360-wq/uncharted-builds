"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UnlockNotice, getState } from "@/lib/game/service";
import { api } from "@/lib/client";
import SideGame from "./side/SideGame";

// The 3D game loads only when it's used (it brings three.js with it).
const Game3D = dynamic(() => import("./three/Game3D"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-lg font-bold text-white">Loading 3D…</div>,
});

type View = "3d" | "2d";
const VIEW_KEY = "ub-view";
import { InputBus, useButtons, useKeyboard } from "./world/input";
import SoundControls from "./world/SoundControls";
import { setMusic, sfx } from "@/lib/sound";
import MenuPanels from "./world/MenuPanels";

type GameState = Awaited<ReturnType<typeof getState>>;

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
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Game() {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocks, setUnlocks] = useState<UnlockNotice[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const bus = useMemo(() => new InputBus(), []);
  useKeyboard(bus);
  const sync = useRef<{ flush: () => Promise<void>; adopt: () => void } | null>(null);
  // 3D is the main view; the 2D side view stays one tap away
  const [view, setView] = useState<View | null>(null);
  useEffect(() => {
    let v: View = "3d";
    try {
      if (localStorage.getItem(VIEW_KEY) === "2d") v = "2d";
    } catch {
      // storage may be blocked
    }
    setView(v);
  }, []);
  const switchView = useCallback(async (v: View) => {
    // send everything first, so the other view starts from the server's numbers
    await sync.current?.flush().catch(() => {});
    sync.current = null;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage may be blocked
    }
    setView(v);
  }, []);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  /** Menu and shop actions: the server's HP and MP win afterwards (eating, resting, new max HP). */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        await sync.current?.flush();
        const r = await fn();
        const u = (r as { unlocks?: UnlockNotice[] })?.unlocks;
        if (u?.length) setUnlocks((q) => [...q, ...u]);
        sync.current?.adopt();
        // the answer carries the new state (withState): no second trip
        const s = (r as { state?: GameState })?.state;
        if (s) setState(s);
        else await refresh();
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

  const onUnlocks = useCallback((u: UnlockNotice[]) => {
    if (u.length) sfx("unlock");
    setUnlocks((q) => [...q, ...u]);
  }, []);
  // the music stops when you leave the game
  useEffect(() => () => setMusic(null), []);
  const registerSync = useCallback((fns: { flush: () => Promise<void>; adopt: () => void }) => {
    sync.current = fns;
  }, []);

  if (!state || !view) {
    return <main className="flex min-h-screen items-center justify-center text-muted">{error ?? "Loading…"}</main>;
  }
  const { player } = state;

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      {view === "3d" ? (
        <Game3D
          key="3d"
          state={state}
          bus={bus}
          paused={menuOpen || shopOpen || unlocks.length > 0}
          refresh={refresh}
          onMenu={() => setMenuOpen(true)}
          onShop={() => setShopOpen(true)}
          onUnlocks={onUnlocks}
          onError={setError}
          registerSync={registerSync}
          onSwitchView={() => void switchView("2d")}
        />
      ) : (
        <>
          <SideGame
            key="2d"
            state={state}
            bus={bus}
            paused={menuOpen || shopOpen || unlocks.length > 0}
            refresh={refresh}
            onMenu={() => setMenuOpen(true)}
            onShop={() => setShopOpen(true)}
            onUnlocks={onUnlocks}
            onError={setError}
            registerSync={registerSync}
          />
          <button
            type="button"
            className="absolute right-2 top-[60px] z-10 flex h-11 items-center justify-center rounded-xl border-[3px] border-[#2f2a3b] bg-[#fdf6e3] px-3 text-xs font-black text-[#2f2a3b] shadow-[0_3px_0_#2f2a3b] active:translate-y-[2px]"
            onClick={() => void switchView("3d")}
            title="Switch to the 3D world"
          >
            3D
          </button>
        </>
      )}

      {error && (
        <div className="absolute left-1/2 top-24 z-50 w-[min(420px,90vw)] -translate-x-1/2 rounded-lg border border-blood/40 bg-[#2a1416]/95 px-3 py-2 text-sm text-blood" role="alert">
          {error}
        </div>
      )}

      {menuOpen && (
        <Sheet
          title="Menu"
          bus={bus}
          onClose={() => {
            setMenuOpen(false);
            sync.current?.adopt();
            void refresh();
          }}
        >
          <SoundControls />
          <MenuPanels state={state} busy={busy} inBattle={false} run={run} />
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
                    onClick={() => run(() => api("/api/town", { action: "weapon", weapon: w.type, withState: true }))}
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
            {unlocks[0].needsConfirmation && <p className="mt-3 text-sm text-blood">This power has a price. Decide whether to accept it in your MENU.</p>}
            {unlocks[0].earnedBy?.length ? (
              <div className="mt-4 rounded-lg border border-gold/30 p-3 text-left text-sm">
                <div className="label text-muted">How you earned it</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {unlocks[0].earnedBy.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <button className="btn-primary mt-5 w-full" onClick={() => setUnlocks((q) => q.slice(1))}>
              {unlocks.length > 1 ? `Continue (${unlocks.length - 1} more)` : "Continue"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
