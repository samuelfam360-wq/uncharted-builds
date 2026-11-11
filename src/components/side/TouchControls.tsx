"use client";

import { useEffect, useRef, useState } from "react";
import type { Engine, Press } from "./engine";

/**
 * Mobile-game controls drawn over the screen:
 * a floating joystick on the left, and Attack / Jump / Block / skills on the right.
 * They also work with a mouse.
 */

const DEAD = 16; // joystick dead zone (px)
const UPDOWN = 30; // how far up or down to push before it counts as climbing

export interface SkillButton {
  name: string;
  short: string;
  ready: boolean;
  cdPct: number; // 0..1 of the cooldown left
  enoughMp: boolean;
}

export default function TouchControls({
  engine,
  skills,
  context,
  onContext,
  disabled,
}: {
  engine: Engine | null;
  skills: (SkillButton | null)[];
  context: string | null; // "Talk", "Enter"... shown when something is nearby
  onContext: () => void;
  disabled: boolean;
}) {
  const [stick, setStick] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const stickId = useRef<number | null>(null);
  const zone = useRef<HTMLDivElement>(null);

  const setHeld = (k: "left" | "right" | "up" | "down" | "attack" | "block", v: boolean) => {
    if (engine) engine.held[k] = v;
  };
  const press = (k: Press) => engine?.press(k);

  // let go of everything when the controls are hidden or the window loses focus
  useEffect(() => {
    if (!disabled || !engine) return;
    Object.assign(engine.held, { left: false, right: false, up: false, down: false, attack: false, block: false });
    stickId.current = null;
    setStick(null);
  }, [disabled, engine]);

  const moveStick = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    const max = 56;
    const k = len > max ? max / len : 1;
    setHeld("left", dx < -DEAD);
    setHeld("right", dx > DEAD);
    setHeld("up", dy < -UPDOWN);
    setHeld("down", dy > UPDOWN);
    return { dx: dx * k, dy: dy * k };
  };

  const onStickDown = (e: React.PointerEvent) => {
    if (disabled || stickId.current !== null) return;
    e.preventDefault();
    stickId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const r = zone.current!.getBoundingClientRect();
    setStick({ ox: e.clientX - r.left, oy: e.clientY - r.top, dx: 0, dy: 0 });
  };
  const onStickMove = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current || !stick) return;
    const r = zone.current!.getBoundingClientRect();
    const d = moveStick(e.clientX - r.left - stick.ox, e.clientY - r.top - stick.oy);
    setStick({ ...stick, ...d });
  };
  const onStickUp = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current) return;
    stickId.current = null;
    moveStick(0, 0);
    setStick(null);
  };

  const hold = (k: "attack" | "block") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setHeld(k, true);
    },
    onPointerUp: () => setHeld(k, false),
    onPointerCancel: () => setHeld(k, false),
    onLostPointerCapture: () => setHeld(k, false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      fn();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const round = "absolute flex select-none items-center justify-center rounded-full border-4 border-[#2f2a3b] font-black text-white shadow-[0_4px_0_#2f2a3b] active:translate-y-[2px] active:shadow-[0_2px_0_#2f2a3b]";

  return (
    <div className={`pointer-events-none absolute inset-0 ${disabled ? "opacity-0" : ""}`} style={{ touchAction: "none" }}>
      {/* joystick: touch anywhere in the bottom-left area */}
      <div
        ref={zone}
        className="pointer-events-auto absolute bottom-0 left-0 h-[55%] w-[45%]"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Move"
      >
        {stick ? (
          <>
            <div className="absolute h-28 w-28 rounded-full border-4 border-white/40 bg-black/25" style={{ left: stick.ox - 56, top: stick.oy - 56 }} />
            <div
              className="absolute h-14 w-14 rounded-full border-4 border-[#2f2a3b] bg-white/85 shadow-md"
              style={{ left: stick.ox - 28 + stick.dx, top: stick.oy - 28 + stick.dy }}
            />
          </>
        ) : (
          <div className="absolute bottom-6 left-6 flex h-28 w-28 items-center justify-center rounded-full border-4 border-white/40 bg-black/20">
            <div className="h-14 w-14 rounded-full border-4 border-[#2f2a3b] bg-white/70" />
          </div>
        )}
      </div>

      {/* action buttons */}
      <div className="pointer-events-auto absolute bottom-3 right-3 h-[230px] w-[250px]">
        <button type="button" aria-label="Attack" className={`${round} bottom-2 right-2 h-24 w-24 bg-[#e0533d] text-lg`} {...hold("attack")}>
          ATK
        </button>
        <button type="button" aria-label="Jump" className={`${round} bottom-0 right-[118px] h-16 w-16 bg-[#3f8fd9] text-sm`} {...tap(() => press("jump"))}>
          JUMP
        </button>
        <button type="button" aria-label="Block" className={`${round} bottom-[78px] right-[112px] h-14 w-14 bg-[#5b6b84] text-[11px]`} {...hold("block")}>
          BLOCK
        </button>
        {skills.map((s, i) => {
          const pos = [
            { right: 6, bottom: 112 },
            { right: 64, bottom: 150 },
            { right: 128, bottom: 150 },
            { right: 182, bottom: 112 },
          ][i];
          if (!s) return null;
          return (
            <button
              type="button"
              key={i}
              aria-label={s.name}
              title={s.name}
              className={`${round} h-14 w-14 overflow-hidden bg-[#7a52c7] text-[11px] leading-tight ${!s.enoughMp ? "opacity-50" : ""}`}
              style={pos}
              {...tap(() => press(`skill${i}` as Press))}
            >
              <span className="relative z-10 px-1 text-center">{s.short}</span>
              {s.cdPct > 0 && <span className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${s.cdPct * 100}%` }} />}
              <span className="absolute right-1 top-0 z-10 text-[9px] text-white/80">{i + 1}</span>
            </button>
          );
        })}
        {context && (
          <button
            type="button"
            aria-label={context}
            className={`${round} bottom-[150px] right-[6px] h-14 w-[86px] rounded-2xl bg-[#f0b429] text-sm text-[#2f2a3b] ${skills.some(Boolean) ? "!bottom-[214px]" : ""}`}
            {...tap(onContext)}
          >
            {context}
          </button>
        )}
      </div>
    </div>
  );
}
