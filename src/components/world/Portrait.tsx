/* eslint-disable @next/next/no-img-element */
import { CLASSES, classPortrait } from "@/lib/game/data/classes";
import type { ClassId } from "@/lib/game/types";

/** A class portrait. "face" crops in on the head for small round spots; "card" shows the hero down to the knees. */
export default function Portrait({ classId, variant = "card", className = "" }: { classId: ClassId; variant?: "face" | "card" | "full"; className?: string }) {
  const name = CLASSES[classId]?.name ?? "Free Class";
  const crop =
    variant === "face"
      ? { objectPosition: "50% 22%", transform: "scale(1.9)", transformOrigin: "50% 26%" }
      : variant === "card"
        ? { objectPosition: "50% 15%" }
        : undefined;
  return (
    <div className={`overflow-hidden bg-[#b79cf0] ${className}`}>
      <img src={classPortrait(classId)} alt={`${name} portrait`} draggable={false} className="h-full w-full object-cover" style={crop} loading="lazy" />
    </div>
  );
}
