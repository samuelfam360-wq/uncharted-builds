// The class's 2D look (the Canva chibi art) in its three poses, so the
// create page shows the same hero in both 2D and 3D.

import type { ClassId } from "@/lib/game/types";

const POSES = [
  { pose: "idle", label: "Stand" },
  { pose: "walk", label: "Walk" },
  { pose: "attack", label: "Attack" },
] as const;

export default function HeroArt2D({ classId }: { classId: ClassId }) {
  return (
    <div className="rounded-lg border border-line bg-gradient-to-b from-[#4a3f9e] to-[#2e2a6e] p-2" data-testid="hero-2d">
      <div className="mb-1 text-center text-xs font-semibold text-[#e9e4ff]">In 2D</div>
      <div className="grid grid-cols-3 items-end gap-1">
        {POSES.map(({ pose, label }) => (
          <figure key={pose} className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/art/canva/hero-${classId}-${pose}.webp`} alt={`${label} pose`} className="h-28 w-full object-contain object-bottom sm:h-32" />
            <figcaption className="mt-1 text-[10px] text-[#c9c3f2]">{label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
