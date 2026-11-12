"use client";

// Sound on/off and the two volume sliders, shown at the top of the MENU.

import { useEffect, useState } from "react";
import { getSound, onSoundChange, setSound, sfx } from "@/lib/sound";

export default function SoundControls() {
  const [s, setS] = useState(getSound);
  useEffect(() => onSoundChange(() => setS({ ...getSound() })), []);
  const pct = (v: number) => Math.round(v * 100);
  return (
    <div className="panel mb-2 space-y-2" data-testid="sound-controls">
      <div className="flex items-center justify-between">
        <span className="label">Sound</span>
        <button type="button" className={`btn px-3 py-1 text-xs ${s.muted ? "" : "border-gold text-gold"}`} aria-pressed={!s.muted} onClick={() => setSound({ muted: !s.muted })}>
          {s.muted ? "Off" : "On"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-16 text-muted">Music</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct(s.music)}
          disabled={s.muted}
          aria-label="Music volume"
          className="flex-1 accent-[#e0b84c]"
          onChange={(e) => setSound({ music: Number(e.target.value) / 100 })}
        />
        <span className="w-9 text-right text-xs text-muted">{pct(s.music)}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="w-16 text-muted">Effects</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct(s.sfx)}
          disabled={s.muted}
          aria-label="Effects volume"
          className="flex-1 accent-[#e0b84c]"
          onChange={(e) => {
            setSound({ sfx: Number(e.target.value) / 100 });
            sfx("pickup");
          }}
        />
        <span className="w-9 text-right text-xs text-muted">{pct(s.sfx)}</span>
      </label>
    </div>
  );
}
