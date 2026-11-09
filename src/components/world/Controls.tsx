"use client";

import type { InputBus, Dir } from "./input";

/** On-screen D-pad and A / B / Menu buttons, for phones (they work with a mouse too). */
export default function Controls({ bus, menuBadge }: { bus: InputBus; menuBadge?: boolean }) {
  const dirProps = (d: Dir) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      bus.hold(d);
    },
    onPointerUp: () => bus.release(d),
    onPointerCancel: () => bus.release(d),
    onLostPointerCapture: () => bus.release(d),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    "aria-label": d,
  });
  const btn = (b: "a" | "b" | "menu") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      bus.press(b);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const pad = "flex items-center justify-center bg-[#2b2f3a] text-[#9aa3b5] active:bg-[#3d4354] select-none";

  return (
    <div className="mt-3 flex select-none items-center justify-between gap-4 px-2" style={{ touchAction: "none", WebkitUserSelect: "none" }}>
      <div className="grid h-36 w-36 grid-cols-3 grid-rows-3">
        <span />
        <button type="button" className={`${pad} rounded-t-lg`} {...dirProps("up")}>
          ▲
        </button>
        <span />
        <button type="button" className={`${pad} rounded-l-lg`} {...dirProps("left")}>
          ◀
        </button>
        <span className="bg-[#2b2f3a]" />
        <button type="button" className={`${pad} rounded-r-lg`} {...dirProps("right")}>
          ▶
        </button>
        <span />
        <button type="button" className={`${pad} rounded-b-lg`} {...dirProps("down")}>
          ▼
        </button>
        <span />
      </div>

      <button
        type="button"
        className="relative self-end rounded-full bg-[#2b2f3a] px-4 py-1.5 text-xs font-bold tracking-widest text-[#c9d1e0] active:bg-[#3d4354]"
        {...btn("menu")}
        aria-label="Menu"
      >
        MENU
        {menuBadge && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-gold" />}
      </button>

      <div className="relative h-32 w-32">
        <button
          type="button"
          className="absolute bottom-2 left-0 flex h-14 w-14 items-center justify-center rounded-full bg-[#7a3b52] text-lg font-bold text-white shadow-md active:bg-[#5e2c3f]"
          {...btn("b")}
          aria-label="B"
        >
          B
        </button>
        <button
          type="button"
          className="absolute right-0 top-2 flex h-14 w-14 items-center justify-center rounded-full bg-[#a6324d] text-lg font-bold text-white shadow-md active:bg-[#82253b]"
          {...btn("a")}
          aria-label="A"
        >
          A
        </button>
      </div>
    </div>
  );
}
