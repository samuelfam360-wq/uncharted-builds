"use client";

import { useEffect, useRef, useState } from "react";
import type { SkillButton } from "../side/TouchControls";
import type { Engine3D, Press } from "./engine3d";

/**
 * Phone controls for the 3D game: a floating joystick on the left to walk,
 * drag anywhere else to turn the camera, and Attack / Block / Jump / skills on the right.
 */

const MAX = 56; // joystick reach (px)

export default function TouchControls3D({
  engine,
  stick,
  onLook,
  skills,
  context,
  onContext,
  disabled,
}: {
  engine: Engine3D | null;
  /** The joystick's push, -1..1 each way (y down = toward you). The page turns it into walking. */
  stick: React.MutableRefObject<{ x: number; y: number }>;
  /** Drag to look around: pixels moved. */
  onLook: (dx: number, dy: number) => void;
  skills: (SkillButton | null)[];
  context: string | null;
  onContext: () => void;
  disabled: boolean;
}) {
  const [pad, setPad] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const padId = useRef<number | null>(null);
  const lookId = useRef<{ id: number; x: number; y: number } | null>(null);
  const zone = useRef<HTMLDivElement>(null);

  const setHeld = (k: "attack" | "block", v: boolean) => {
    if (engine) engine.held[k] = v;
  };
  const press = (k: Press) => engine?.press(k);

  useEffect(() => {
    if (!disabled) return;
    if (engine) Object.assign(engine.held, { attack: false, block: false });
    stick.current = { x: 0, y: 0 };
    padId.current = null;
    lookId.current = null;
    setPad(null);
  }, [disabled, engine, stick]);

  const onPadDown = (e: React.PointerEvent) => {
    if (disabled || padId.current !== null) return;
    e.preventDefault();
    padId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const r = zone.current!.getBoundingClientRect();
    setPad({ ox: e.clientX - r.left, oy: e.clientY - r.top, dx: 0, dy: 0 });
  };
  const onPadMove = (e: React.PointerEvent) => {
    if (e.pointerId !== padId.current || !pad) return;
    const r = zone.current!.getBoundingClientRect();
    let dx = e.clientX - r.left - pad.ox;
    let dy = e.clientY - r.top - pad.oy;
    const len = Math.hypot(dx, dy);
    if (len > MAX) {
      dx = (dx / len) * MAX;
      dy = (dy / len) * MAX;
    }
    const dead = len < 10;
    stick.current = dead ? { x: 0, y: 0 } : { x: dx / MAX, y: dy / MAX };
    setPad({ ...pad, dx, dy });
  };
  const onPadUp = (e: React.PointerEvent) => {
    if (e.pointerId !== padId.current) return;
    padId.current = null;
    stick.current = { x: 0, y: 0 };
    setPad(null);
  };

  const onLookDown = (e: React.PointerEvent) => {
    if (disabled || lookId.current || e.pointerType === "mouse") return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    lookId.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onLookMove = (e: React.PointerEvent) => {
    const l = lookId.current;
    if (!l || e.pointerId !== l.id) return;
    onLook(e.clientX - l.x, e.clientY - l.y);
    lookId.current = { id: l.id, x: e.clientX, y: e.clientY };
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (lookId.current?.id === e.pointerId) lookId.current = null;
  };

  const hold = (k: "attack" | "block") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
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
      e.stopPropagation();
      fn();
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const round =
    "absolute flex select-none items-center justify-center rounded-full border-4 border-[#2f2a3b] font-black text-white shadow-[0_4px_0_#2f2a3b] active:translate-y-[2px] active:shadow-[0_2px_0_#2f2a3b]";

  return (
    <div className={`pointer-events-none absolute inset-0 [@media(pointer:fine)]:hidden ${disabled ? "opacity-0" : ""}`} style={{ touchAction: "none" }}>
      {/* drag anywhere on the right to look around */}
      <div
        className="pointer-events-auto absolute right-0 top-[60px] h-[calc(100%-60px)] w-[55%]"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
        aria-hidden
      />
      {/* joystick: touch anywhere in the bottom-left area */}
      <div
        ref={zone}
        className="pointer-events-auto absolute bottom-0 left-0 h-[60%] w-[45%]"
        onPointerDown={onPadDown}
        onPointerMove={onPadMove}
        onPointerUp={onPadUp}
        onPointerCancel={onPadUp}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Move"
      >
        {pad ? (
          <>
            <div className="absolute h-28 w-28 rounded-full border-4 border-white/50 bg-black/20" style={{ left: pad.ox - 56, top: pad.oy - 56 }} />
            <div className="absolute h-14 w-14 rounded-full border-4 border-[#2f2a3b] bg-white/85 shadow-md" style={{ left: pad.ox - 28 + pad.dx, top: pad.oy - 28 + pad.dy }} />
          </>
        ) : (
          <div className="absolute bottom-6 left-6 flex h-28 w-28 items-center justify-center rounded-full border-4 border-white/50 bg-black/15">
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
              className={`${round} h-14 w-14 overflow-hidden text-[11px] leading-tight ${s.gauge ? (s.gauge.charged ? "bg-[#c98a12] ring-2 ring-[#ffd34d]" : "bg-[#5a4a2a]") : "bg-[#7a52c7]"} ${!s.enoughMp ? "opacity-50" : ""}`}
              style={pos}
              {...tap(() => press(`skill${i}` as Press))}
            >
              <span className="relative z-10 px-1 text-center">{s.short}</span>
              {s.cdPct > 0 && <span className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${s.cdPct * 100}%` }} />}
              <span className="absolute right-1 top-0 z-10 text-[9px] text-white/80">{i + 1}</span>
              {s.gauge && <span className="absolute inset-x-0 bottom-0.5 z-10 text-center text-[10px] font-bold text-[#ffe9a8]">{s.gauge.value}</span>}
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
