"use client";

import { useEffect, useRef } from "react";

export type Dir = "up" | "down" | "left" | "right";
export type Button = "a" | "b" | "menu";

/**
 * One place for every way of playing: keyboard, the on-screen D-pad and buttons.
 * Directions are "held" (walking keeps going while held); buttons are presses.
 */
export class InputBus {
  private held: Dir[] = [];
  private listeners = new Set<(b: Button | Dir) => void>();

  private tap: Dir | null = null;

  hold(d: Dir) {
    const first = !this.held.includes(d);
    this.tap = d;
    this.held = [...this.held.filter((x) => x !== d), d];
    if (first) this.emit(d); // menus move one step per press
  }
  release(d: Dir) {
    this.held = this.held.filter((x) => x !== d);
  }
  releaseAll() {
    this.held = [];
    this.tap = null;
  }
  /** A direction pressed since the last call, even if already let go (a quick tap turns you). */
  takeTap(): Dir | null {
    const t = this.tap;
    this.tap = null;
    return t;
  }
  /** The most recently pressed direction that is still held. */
  current(): Dir | null {
    return this.held[this.held.length - 1] ?? null;
  }
  press(b: Button) {
    this.emit(b);
  }
  on(fn: (b: Button | Dir) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit(b: Button | Dir) {
    // newest listener first: an open dialog sits on top of the map
    const list = [...this.listeners].reverse();
    for (const l of list) {
      if ((l as ((b: Button | Dir) => boolean | void))(b) === true) return;
    }
  }
}

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};
const KEY_BTN: Record<string, Button> = {
  z: "a",
  Z: "a",
  " ": "a",
  Enter: "a",
  x: "b",
  X: "b",
  Escape: "b",
  Backspace: "b",
  m: "menu",
  M: "menu",
  Tab: "menu",
};

/** Keyboard support. Typing in a text box is left alone. */
export function useKeyboard(bus: InputBus) {
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const d = KEY_DIR[e.key];
      if (d) {
        e.preventDefault();
        bus.hold(d);
        return;
      }
      const b = KEY_BTN[e.key];
      if (b && !e.repeat) {
        // Enter/Space on a focused button already clicks it; don't press twice.
        const t = e.target as HTMLElement | null;
        if ((e.key === "Enter" || e.key === " ") && t && t.tagName === "BUTTON") return;
        e.preventDefault();
        bus.press(b);
      }
    };
    const up = (e: KeyboardEvent) => {
      const d = KEY_DIR[e.key];
      if (d) bus.release(d);
    };
    const blur = () => bus.releaseAll();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [bus]);
}

/** Subscribe to presses; return true from the handler to stop lower layers seeing it. */
export function useButtons(bus: InputBus, handler: (b: Button | Dir) => boolean | void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return bus.on(((b: Button | Dir) => ref.current(b)) as (b: Button | Dir) => void);
  }, [bus, active]);
}
