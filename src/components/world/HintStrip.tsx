import type { Hint } from "@/lib/game/reveal";

/**
 * Hidden skills you're at least halfway to, under the HP / MP / EXP bars.
 * The name stays a secret: only how close you are and what's still missing.
 */
export function HintStrip({ hints, max = 2 }: { hints: Hint[]; max?: number }) {
  if (!hints.length) return null;
  const shown = [...hints].sort((a, b) => b.pct - a.pct).slice(0, max);
  const more = hints.length - shown.length;
  return (
    <div className="pointer-events-none mt-1 space-y-0.5 rounded-xl border-[3px] border-[#2f2a3b] bg-[#2f2a3b]/85 px-2 py-1 text-white shadow-[0_3px_0_#2f2a3b]">
      {shown.map((h, i) => (
        <div key={i} className="text-[9px] leading-tight sm:text-[10px]">
          <div className="flex items-center gap-1">
            <span className="font-black tracking-widest text-[#f0b429]">
              ??????
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full bg-[#f0b429]"
                style={{ width: `${Math.floor(h.pct * 100)}%` }}
              />
            </div>
            <span className="font-bold">{Math.floor(h.pct * 100)}%</span>
          </div>
          <div className="truncate text-white/85">
            {h.left[0]}
            {h.left.length > 1 ? ` (+${h.left.length - 1} more)` : ""}
          </div>
        </div>
      ))}
      {more > 0 && (
        <div className="text-[9px] italic text-white/70">
          +{more} more in the Menu
        </div>
      )}
    </div>
  );
}
