"use client";

import { useState } from "react";
import { useButtons, type InputBus } from "./input";

export interface Choice {
  label: string;
  run: () => void;
}

export interface Dialog {
  lines: string[];
  choices?: Choice[]; // shown with the last line; the last choice is also what B picks
  onDone?: () => void; // after the last line when there are no choices
}

/** FireRed-style text box: A (or a tap) moves on, choices are picked with the D-pad or a tap. */
export default function TextBox({ dialog, bus, close }: { dialog: Dialog; bus: InputBus; close: () => void }) {
  const [i, setI] = useState(0);
  const [cursor, setCursor] = useState(0);
  const last = i >= dialog.lines.length - 1;
  const choices = last ? dialog.choices : undefined;

  const pick = (k: number) => {
    close();
    dialog.choices![k].run();
  };
  const next = () => {
    if (!last) return setI(i + 1);
    if (choices) return pick(cursor);
    close();
    dialog.onDone?.();
  };

  useButtons(bus, (b) => {
    if (b === "a") next();
    else if (b === "b") {
      if (choices) pick(choices.length - 1);
      else next();
    } else if (choices && (b === "up" || b === "down")) {
      setCursor((c) => (c + (b === "down" ? 1 : choices.length - 1)) % choices.length);
    }
    return true; // the map underneath doesn't react while talking
  });

  return (
    <div className="pointer-events-auto absolute inset-x-1 bottom-1 flex items-end gap-1" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="pixel-box min-h-[3.75rem] flex-1 px-3 py-2 text-left text-[15px] leading-snug"
        onClick={next}
        aria-live="polite"
      >
        {dialog.lines[i]}
        {!choices && <span className="ml-1 inline-block animate-bounce text-[#c0392b]">▼</span>}
      </button>
      {choices && (
        <div className="pixel-box flex flex-col py-1" role="menu">
          {choices.map((c, k) => (
            <button
              type="button"
              key={c.label}
              role="menuitem"
              className="flex items-center gap-1 px-3 py-1 text-left text-[15px]"
              onPointerEnter={() => setCursor(k)}
              onClick={() => pick(k)}
            >
              <span className={k === cursor ? "text-[#1b1a22]" : "text-transparent"}>▶</span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
