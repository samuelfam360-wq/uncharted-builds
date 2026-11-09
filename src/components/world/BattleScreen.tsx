"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { publicBattle } from "@/lib/game/service";
import type { WeaponType } from "@/lib/game/types";
import { MONSTERS } from "@/lib/game/data/world";
import { battleBack, battleBackdrop, monsterArt, type Backdrop, type Look } from "./art";
import { useButtons, type InputBus } from "./input";

export type Battle = ReturnType<typeof publicBattle>;

export interface BattleSkill {
  id: string;
  name: string;
  description: string;
  mpCost: number;
  usesPerBattle: number | null;
}
export interface BagItem {
  itemId: string;
  name: string;
  qty: number;
  edible: boolean;
}

interface Props {
  bus: InputBus;
  battle: Battle;
  resume: boolean; // reopened after a page reload: skip the replay
  look: Look;
  weapon: WeaponType;
  playerName: string;
  level: number;
  skills: BattleSkill[];
  bag: BagItem[];
  busy: boolean;
  onAction: (action: Record<string, unknown>) => void;
  onContinue: () => void;
}

const W = 240;
const H = 160;
const LINE_MS = 1300; // a line moves on by itself after this long; A/tap skips

type Phase = "text" | "menu" | "skills" | "bag";

/** Read the server's battle log to animate HP bars and hits as each line appears. */
function effectOf(line: string, enemyName: string) {
  let m = line.match(/deals (\d+) damage to /);
  if (m) return { enemy: -+m[1], hitEnemy: true };
  m = line.match(/hits you for (\d+)/);
  if (m) return { player: -+m[1], hitPlayer: true };
  m = line.match(/burns your skin for (\d+)/);
  if (m) return { player: -+m[1], hitPlayer: true };
  m = line.match(/reflect (\d+) damage back/);
  if (m) return { enemy: -+m[1], hitEnemy: true };
  m = line.match(/^(.+) takes (\d+) \w+ damage/);
  if (m) return m[1] === enemyName ? { enemy: -+m[2], hitEnemy: true } : { player: -+m[2], hitPlayer: true };
  m = line.match(/recover (\d+) HP/);
  if (m) return { player: +m[1] };
  if (line === `${enemyName} is defeated!`) return { faintEnemy: true };
  if (line.startsWith("You have been defeated")) return { faintPlayer: true };
  return {};
}

function HpBox({ name, hp, maxHp, statuses, sub, align }: { name: string; hp: number; maxHp: number; statuses: { type: string }[]; sub?: string; align: "left" | "right" }) {
  const pct = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  const color = pct > 0.5 ? "#4cc35a" : pct > 0.2 ? "#e8b42f" : "#e0484a";
  return (
    <div className={`pixel-box absolute w-[46%] px-2 py-1 ${align === "left" ? "left-[3%] top-[5%]" : "bottom-[4%] right-[3%]"}`}>
      <div className="flex items-baseline justify-between gap-1 text-[13px] font-bold leading-tight">
        <span className="truncate">{name}</span>
        {sub && <span className="shrink-0 text-[11px]">{sub}</span>}
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <span className="text-[9px] font-bold text-[#c06a1c]">HP</span>
        <div className="h-[6px] flex-1 rounded-sm border border-[#1b1a22] bg-[#3a3a3a]">
          <div className="h-full transition-[width] duration-300" style={{ width: `${pct * 100}%`, background: color }} />
        </div>
      </div>
      {align === "right" && (
        <div className="text-right font-mono text-[11px] leading-tight">
          {Math.max(0, Math.round(hp))}/{maxHp}
        </div>
      )}
      {statuses.length > 0 && (
        <div className="flex flex-wrap gap-0.5">
          {statuses.map((s) => (
            <span key={s.type} className="rounded bg-[#7b3fc4] px-1 text-[9px] font-bold uppercase text-white">
              {s.type.slice(0, 3)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BattleScreen(p: Props) {
  const { battle } = p;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const monsterId = useMemo(() => Object.values(MONSTERS).find((m) => m.name === battle.enemy.name)?.id ?? "?", [battle.enemy.name]);
  const backdrop: Backdrop = battle.kind === "dungeon" ? "cave" : battle.hazard ? "swamp" : "grass";

  // ---- message queue
  const [queue, setQueue] = useState<{ id: number; text: string }[]>([]);
  const lineId = useRef(0);
  const [menu, setMenu] = useState<Phase>("menu"); // which menu shows once the text is done
  const [cursor, setCursor] = useState(0);
  const seen = useRef<{ id: string; upTo: number } | null>(null);
  const [shownHp, setShownHp] = useState({ enemy: battle.enemy.hp, player: battle.player.hp });
  const fx = useRef({ enemyHit: 0, playerHit: 0, enemyFaint: 0, playerFaint: 0, start: 0 });
  const battleRef = useRef(battle);
  useEffect(() => {
    battleRef.current = battle;
  });

  // new battle -> its intro lines; same battle with more log -> just the new lines
  useEffect(() => {
    const total = battle.logStart + battle.log.length;
    const clean = (lines: string[]) => lines.filter((l) => !l.startsWith("—")).map((text) => ({ id: ++lineId.current, text }));
    if (!seen.current || seen.current.id !== battle.id) {
      const from = p.resume ? Math.max(battle.logStart, total - 1) : battle.logStart;
      seen.current = { id: battle.id, upTo: total };
      fx.current = { enemyHit: 0, playerHit: 0, enemyFaint: 0, playerFaint: 0, start: performance.now() };
      setShownHp({ enemy: battle.enemy.hp, player: battle.player.hp });
      setQueue(clean(battle.log.slice(from - battle.logStart)));
      setMenu("menu");
      setCursor(0);
      return;
    }
    if (total > seen.current.upTo) {
      const fresh = clean(battle.log.slice(Math.max(0, seen.current.upTo - battle.logStart)));
      seen.current.upTo = total;
      setQueue((q) => [...q, ...fresh]);
    }
  }, [battle, p.resume]);

  // show a line: animate what it did, then move on by itself after a moment
  const current = queue[0];
  const currentId = current?.id;
  useEffect(() => {
    if (!current) return;
    const b = battleRef.current;
    const e = effectOf(current.text, b.enemy.name);
    const now = performance.now();
    if (e.hitEnemy) fx.current.enemyHit = now;
    if (e.hitPlayer) fx.current.playerHit = now;
    if (e.faintEnemy) fx.current.enemyFaint = now;
    if (e.faintPlayer) fx.current.playerFaint = now;
    if (e.enemy || e.player)
      setShownHp((h) => ({
        enemy: Math.max(0, Math.min(b.enemy.maxHp, h.enemy + (e.enemy ?? 0))),
        player: Math.max(0, Math.min(b.player.maxHp, h.player + (e.player ?? 0))),
      }));
    const t = setTimeout(() => setQueue((q) => (q[0]?.id === current.id ? q.slice(1) : q)), LINE_MS);
    return () => clearTimeout(t);
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // all lines shown: make sure the bars match the server's numbers exactly
  useEffect(() => {
    if (queue.length > 0) return;
    const b = battleRef.current;
    setShownHp({ enemy: b.enemy.hp, player: b.player.hp });
    if (b.enemy.hp <= 0 && !fx.current.enemyFaint) fx.current.enemyFaint = performance.now();
  }, [queue.length, battle.id]);

  const advance = () => setQueue((q) => q.slice(1));
  const done = queue.length === 0;
  const finished = done && battle.over;
  const phase: Phase | "text" = !done || finished || p.busy ? "text" : menu;
  const setPhase = setMenu;

  // ---- menus
  const usable = (s: BattleSkill) =>
    battle.player.mp >= s.mpCost && (s.usesPerBattle === null || (battle.skillUses[s.id] ?? 0) < s.usesPerBattle);
  const mainMenu = [
    { label: "ATTACK", run: () => act({ type: "attack" }) },
    { label: "SKILL", run: () => (setPhase("skills"), setCursor(0)) },
    { label: "DEFEND", run: () => act({ type: "defend" }) },
    { label: "BAG", run: () => (setPhase("bag"), setCursor(0)) },
    { label: "WAIT", run: () => act({ type: "wait" }) },
    { label: "RUN", run: () => act({ type: "flee" }) },
  ];
  const list =
    phase === "skills"
      ? p.skills.map((s) => ({ label: `${s.name}`, note: `${s.mpCost} MP`, disabled: !usable(s), run: () => act({ type: "skill", skillId: s.id }) }))
      : phase === "bag"
        ? p.bag.map((i) => ({ label: i.name, note: `×${i.qty}`, disabled: false, run: () => act({ type: "eat", itemId: i.itemId }) }))
        : [];

  function act(a: Record<string, unknown>) {
    if (p.busy || !done || battle.over) return;
    setMenu("menu");
    p.onAction(a);
  }

  useButtons(p.bus, (b) => {
    if (!done) {
      if (b === "a" || b === "b") advance();
      return true;
    }
    if (finished) {
      if (b === "a" || b === "b") p.onContinue();
      return true;
    }
    if (p.busy) return true;
    if (phase === "menu") {
      const cols = 2;
      if (b === "right") setCursor((c) => (c % cols === 0 ? c + 1 : c));
      if (b === "left") setCursor((c) => (c % cols === 1 ? c - 1 : c));
      if (b === "down") setCursor((c) => Math.min(mainMenu.length - 1, c + cols));
      if (b === "up") setCursor((c) => Math.max(0, c - cols));
      if (b === "a") mainMenu[cursor]?.run();
    } else if (phase === "skills" || phase === "bag") {
      if (b === "down") setCursor((c) => Math.min(list.length - 1, c + 1));
      if (b === "up") setCursor((c) => Math.max(0, c - 1));
      if (b === "a" && list[cursor] && !list[cursor].disabled) list[cursor].run();
      if (b === "b") {
        setPhase("menu");
        setCursor(phase === "skills" ? 1 : 3);
      }
    }
    return true;
  });

  // ---- art & animation
  const art = useRef<{ bg: HTMLCanvasElement; mon: HTMLCanvasElement; me: HTMLCanvasElement } | null>(null);
  useEffect(() => {
    art.current = { bg: battleBackdrop(backdrop, W, H), mon: monsterArt(monsterId), me: battleBack(p.look, p.weapon) };
  }, [backdrop, monsterId, p.look, p.weapon]);

  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      const a = art.current;
      if (!c || !a) return;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(a.bg, 0, 0);
      const f = fx.current;
      const intro = Math.min(1, (now - f.start) / 500);
      const ease = 1 - Math.pow(1 - intro, 3);

      // enemy on the far platform, sliding in from the left
      const mw = a.mon.width;
      const mh = a.mon.height;
      let ex = Math.round(W * 0.72 - mw / 2 - (1 - ease) * 180);
      const ey = Math.round(H * 0.45 - mh + 4);
      const sinceHit = now - f.enemyHit;
      const blinkOff = f.enemyHit && sinceHit < 400 && Math.floor(sinceHit / 70) % 2 === 0;
      if (f.enemyHit && sinceHit < 200) ex += Math.round(Math.sin(sinceHit / 20) * 3);
      if (f.enemyFaint) {
        const k = Math.min(1, (now - f.enemyFaint) / 450);
        if (k < 1) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, W, H * 0.45 + 4);
          ctx.clip();
          ctx.drawImage(a.mon, ex, ey + k * mh);
          ctx.restore();
        }
      } else if (!blinkOff) ctx.drawImage(a.mon, ex, ey);

      // you, on the near platform, sliding in from the right
      let px = Math.round(W * 0.27 - a.me.width / 2 + (1 - ease) * 180);
      const py = Math.round(H * 0.84 - a.me.height + 6);
      const sincePH = now - f.playerHit;
      if (f.playerHit && sincePH < 300) px += Math.round(Math.sin(sincePH / 25) * 4);
      if (f.playerFaint) {
        const k = Math.min(1, (now - f.playerFaint) / 450);
        if (k < 1) ctx.drawImage(a.me, px, py + k * 50);
      } else ctx.drawImage(a.me, px, py);
      if (f.playerHit && sincePH < 120) {
        ctx.fillStyle = "rgba(224,72,74,0.25)";
        ctx.fillRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const title = battle.run ? `Room ${battle.run.room} of ${battle.run.totalRooms}` : battle.hazard ?? undefined;
  const prompt = finished
    ? battle.result === "win"
      ? battle.run && battle.run.room < battle.run.totalRooms
        ? "Room cleared! Press A to go deeper."
        : "You won! Press A to continue."
      : battle.result === "loss"
        ? "You blacked out... Press A."
        : "Got away safely! Press A."
    : null;

  return (
    <div className="w-full select-none">
      <div className="relative overflow-hidden rounded-lg border-4 border-[#1b1a22]">
        <canvas ref={canvasRef} width={W} height={H} className="block w-full" style={{ imageRendering: "pixelated", aspectRatio: "3 / 2" }} />
        <HpBox
          name={battle.enemy.name}
          hp={shownHp.enemy}
          maxHp={battle.enemy.maxHp}
          statuses={battle.enemy.statuses}
          sub={battle.enemy.isBoss ? "BOSS" : undefined}
          align="left"
        />
        <HpBox name={p.playerName} hp={shownHp.player} maxHp={battle.player.maxHp} statuses={battle.player.statuses} sub={`Lv${p.level}`} align="right" />
        {title && <div className="pixel-box absolute right-[3%] top-[5%] hidden px-2 text-[11px] font-bold sm:block">{title}</div>}
      </div>

      {/* text / menu panel */}
      <div className="mt-2 flex min-h-[7.5rem] gap-2">
        {phase === "text" ? (
          <button
            type="button"
            className="pixel-box flex-1 px-3 py-2 text-left text-[16px] leading-snug"
            onClick={() => (!done ? advance() : finished ? p.onContinue() : undefined)}
            aria-live="polite"
          >
            {!done ? queue[0].text : finished ? prompt : p.busy ? "…" : ""}
            {(!done || finished) && <span className="ml-1 inline-block animate-bounce text-[#c0392b]">▼</span>}
          </button>
        ) : phase === "menu" ? (
          <>
            <div className="pixel-box hidden flex-1 px-3 py-2 text-[16px] leading-snug sm:block">
              What will
              <br />
              {p.playerName} do?
            </div>
            <div className="pixel-box grid flex-1 grid-cols-2 gap-x-1 px-2 py-1" role="menu">
              {mainMenu.map((m, k) => (
                <button
                  type="button"
                  key={m.label}
                  role="menuitem"
                  disabled={p.busy || (m.label === "SKILL" && p.skills.length === 0) || (m.label === "BAG" && p.bag.length === 0)}
                  className="flex items-center gap-1 py-1.5 text-left text-[15px] font-bold disabled:opacity-35"
                  onPointerEnter={() => setCursor(k)}
                  onClick={() => m.run()}
                >
                  <span className={k === cursor ? "" : "text-transparent"}>▶</span>
                  {m.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="pixel-box flex max-h-48 flex-1 flex-col overflow-y-auto px-2 py-1" role="menu">
            {list.map((it, k) => (
              <button
                type="button"
                key={it.label + k}
                role="menuitem"
                disabled={it.disabled || p.busy}
                className="flex items-center gap-1 py-1.5 text-left text-[15px] font-bold disabled:opacity-35"
                onPointerEnter={() => setCursor(k)}
                onClick={() => it.run()}
              >
                <span className={k === cursor ? "" : "text-transparent"}>▶</span>
                <span className="flex-1">{it.label}</span>
                <span className="text-[12px] font-normal">{it.note}</span>
              </button>
            ))}
            <button
              type="button"
              className="mt-1 self-start py-1 text-[13px] underline"
              onClick={() => {
                setPhase("menu");
                setCursor(phase === "skills" ? 1 : 3);
              }}
            >
              Back (B)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
