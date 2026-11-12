// Drawing the side-view game onto a canvas. Static parts of each map (ground,
// ladders, buildings, decorations) are painted once into an offscreen canvas.

import { MONSTERS } from "@/lib/game/data/world";
import { SIDE_MAPS, TILE, isLadder, isPlatform, isSolid, isSwamp, mapSize, tileAt, type BuildingDef, type SideMap, type SideMapId } from "@/lib/game/data/sidemaps";
import { PLAYER_H, WEAPON_FEEL, type Engine, type Monster } from "./engine";
import { drawHero, type Look, type Pose } from "./hero";
import { MONSTER_LOOKS, OUTLINE, drawMonster, drawPet, petLookOf, ellipse, frame, makeCanvas, outlined, poly, roundRect, shade, tintedFrame } from "./sprites";

type Ctx = CanvasRenderingContext2D;

const SWAMP_TINT = { hue: -95, sat: 0.55, light: 0.62 };

// ---------- the static map layers ----------

interface Layers {
  back: HTMLCanvasElement; // buildings, ground, ladders, decorations
  front: HTMLCanvasElement; // swamp water and front decorations (over the player)
}
const layerCache = new Map<SideMapId, Layers>();

export function mapLayers(id: SideMapId): Layers {
  let l = layerCache.get(id);
  if (l) return l;
  const m = SIDE_MAPS[id];
  const { w, h } = mapSize(m);
  const back = makeCanvas(w, h);
  const front = makeCanvas(w, h);
  const b = back.getContext("2d")!;
  const f = front.getContext("2d")!;
  const ground = groundRow(m);
  for (const bd of m.buildings) drawBuilding(b, bd, ground * TILE);
  for (const d of m.decor.filter((d) => !d.front && !d.frame.startsWith("torch"))) drawDecor(b, d.frame, d.x, d.row, d.scale ?? 1);
  for (const s of m.signs) drawDecor(b, "sign", s.x, s.row, 1);
  const T = m.terrain;
  const cave = m.backdrop === "cave";
  const solid = (x: number, y: number) => (y < 0 ? cave : isSolid(tileAt(m, x, y)));
  const redrawPlatform = (x: number, y: number) => {
    const l2 = isPlatform(tileAt(m, x - 1, y));
    const r2 = isPlatform(tileAt(m, x + 1, y));
    const name = l2 && r2 ? "horizontal_middle" : r2 ? "horizontal_left" : l2 ? "horizontal_right" : "cloud";
    b.drawImage(frame(`terrain_${T}_${name}`), x * TILE, y * TILE);
  };
  for (let y = 0; y < m.tiles.length; y++) {
    for (let x = 0; x < m.tiles[0].length; x++) {
      const c = m.tiles[y][x];
      if (isSolid(c)) {
        const up = solid(x, y - 1);
        const down = solid(x, y + 1);
        const left = solid(x - 1, y);
        const right = solid(x + 1, y);
        let suffix: string;
        if (!up) suffix = left && right ? "top" : right ? "top_left" : left ? "top_right" : "";
        else if (!down) suffix = left && right ? "bottom" : right ? "bottom_left" : left ? "bottom_right" : "center";
        else suffix = !left ? "left" : !right ? "right" : "center";
        b.drawImage(frame(`terrain_${T}_block${suffix ? `_${suffix}` : ""}`), x * TILE, y * TILE);
      } else if (isPlatform(c)) {
        redrawPlatform(x, y);
      } else if (isLadder(c)) {
        // the ladder pokes up through the platform it leads to
        const top = !isLadder(tileAt(m, x, y - 1));
        const bottom = !isLadder(tileAt(m, x, y + 1));
        b.drawImage(frame(bottom ? "ladder_bottom" : "ladder_middle"), x * TILE, y * TILE);
        if (top) {
          b.drawImage(frame("ladder_top"), x * TILE, (y - 1) * TILE);
          if (isPlatform(tileAt(m, x, y - 1))) redrawPlatform(x, y - 1);
        }
      } else if (isSwamp(c)) {
        f.globalAlpha = 0.86;
        f.drawImage(tintedFrame(isSwamp(tileAt(m, x, y - 1)) ? "water" : "water_top", SWAMP_TINT), x * TILE, y * TILE);
        f.globalAlpha = 1;
      }
    }
  }
  for (const d of m.decor.filter((d) => d.front)) drawDecor(f, d.frame, d.x, d.row, d.scale ?? 1);
  l = { back, front };
  layerCache.set(id, l);
  return l;
}

function groundRow(m: SideMap) {
  // the first solid row under open air, in the middle of the map (caves have a ceiling above)
  const x = Math.floor(m.tiles[0].length / 2);
  for (let y = 1; y < m.tiles.length; y++) if (isSolid(tileAt(m, x, y)) && !isSolid(tileAt(m, x, y - 1))) return y;
  return m.tiles.length - 1;
}

function drawDecor(ctx: Ctx, name: string, x: number, row: number, scale: number) {
  const img = frame(name);
  ctx.drawImage(img, x * TILE - (img.width * scale) / 2, row * TILE - img.height * scale, img.width * scale, img.height * scale);
}

const BUILDING_STYLE: Record<BuildingDef["kind"], { wall: string; roof: string; trim: string }> = {
  inn: { wall: "#f3e1c0", roof: "#c9504b", trim: "#8a5a32" },
  shop: { wall: "#e7c48f", roof: "#4a7bbf", trim: "#6d4a2c" },
  house: { wall: "#e9dcc2", roof: "#7c9a52", trim: "#8a5a32" },
};

function drawBuilding(ctx: Ctx, b: BuildingDef, groundY: number) {
  const st = BUILDING_STYLE[b.kind];
  const x = b.x * TILE + 8;
  const w = b.w * TILE - 16;
  const wallH = (b.h - 1.2) * TILE;
  const top = groundY - wallH;
  // chimney
  if (b.kind === "house") outlined(ctx, roundRect(x + w * 0.68, top - 0.9 * TILE, 26, 0.9 * TILE, 4), "#9a8c86", 5);
  // walls with beams
  outlined(ctx, roundRect(x, top, w, wallH + 4, 6), st.wall, 5);
  ctx.fillStyle = shade(st.wall, -0.08);
  ctx.fillRect(x + 4, top + wallH - 18, w - 8, 18);
  ctx.fillStyle = st.trim;
  for (const bx of [x + 10, x + w - 20]) ctx.fillRect(bx, top + 6, 10, wallH - 6);
  // roof
  outlined(ctx, poly([x - 22, top + 6, x + w + 22, top + 6, x + w - 18, top - 1.15 * TILE, x + 18, top - 1.15 * TILE]), st.roof, 5);
  ctx.fillStyle = shade(st.roof, -0.15);
  for (let i = 1; i < 4; i++) ctx.fillRect(x - 10 + i * 4, top + 6 - i * 0.29 * TILE, w + 20 - i * 8, 4);
  // door
  const dx = b.doorX * TILE + TILE / 2;
  const doorW = 44;
  const doorH = 74;
  const dp = new Path2D();
  dp.moveTo(dx - doorW / 2, groundY);
  dp.lineTo(dx - doorW / 2, groundY - doorH + doorW / 2);
  dp.arc(dx, groundY - doorH + doorW / 2, doorW / 2, Math.PI, 0);
  dp.lineTo(dx + doorW / 2, groundY);
  dp.closePath();
  outlined(ctx, dp, st.trim, 5);
  ctx.fillStyle = shade(st.trim, 0.25);
  ctx.fillRect(dx - 2, groundY - doorH + 10, 4, doorH - 12);
  ctx.fillStyle = "#f5c542";
  ctx.beginPath();
  ctx.arc(dx + 12, groundY - 34, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // windows (skip the door's spot)
  const winY = top + wallH * 0.28;
  for (let i = 0; i < b.w; i++) {
    const cx = b.x * TILE + i * TILE + TILE / 2;
    if (Math.abs(cx - dx) < TILE * 0.9 || i === 0 || i === b.w - 1) continue;
    outlined(ctx, roundRect(cx - 18, winY, 36, 30, 5), "#9fd6ff", 4);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(cx - 1.5, winY, 3, 30);
    ctx.fillRect(cx - 18, winY + 13.5, 36, 3);
  }
  // hanging signs
  if (b.kind !== "house") {
    const sx = dx;
    const sy = groundY - doorH - 44;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - 20, sy - 14);
    ctx.lineTo(sx - 20, sy);
    ctx.moveTo(sx + 20, sy - 14);
    ctx.lineTo(sx + 20, sy);
    ctx.stroke();
    outlined(ctx, roundRect(sx - 40, sy, 80, 32, 6), "#fbe7b5", 4);
    ctx.fillStyle = OUTLINE;
    ctx.font = "900 17px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.kind === "inn" ? "INN" : "WEAPONS", sx, sy + 17);
  }
}

// ---------- backgrounds ----------

function drawBackdrop(ctx: Ctx, m: SideMap, camX: number, camY: number, vw: number, vh: number, now: number) {
  if (m.backdrop === "cave") {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, "#241d33");
    g.addColorStop(1, "#3b2f4f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    // far stone shapes
    const img = frame("terrain_stone_cloud_background");
    ctx.globalAlpha = 0.25;
    for (let i = -1; i < vw / 160 + 2; i++) {
      const x = i * 160 - ((camX * 0.3) % 160);
      ctx.drawImage(img, x, vh * 0.55 + Math.sin(i * 1.7) * 30 - camY * 0.1, 160, 160);
    }
    ctx.globalAlpha = 1;
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, vh);
  g.addColorStop(0, "#9fd2ff");
  g.addColorStop(1, "#e2f4ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, vw, vh);
  // clouds drift slowly
  const clouds = frame("background_clouds");
  const cs = 2.2;
  const cw = clouds.width * cs;
  const cOff = (camX * 0.08 + now * 0.006) % cw;
  for (let x = -cOff; x < vw; x += cw) ctx.drawImage(clouds, x, -40 - camY * 0.05, cw, clouds.height * cs);
  // hills or trees, lined up with the ground
  const far = frame(m.backdrop === "trees" ? "background_fade_trees" : "background_fade_hills");
  const fs = 2.4;
  const fw = far.width * fs;
  const fh = far.height * fs;
  const { h: mh } = mapSize(m);
  const groundY = groundRow(m) * TILE;
  const baseY = groundY - camY * 0.85 - mh * 0.15 - fh * 0.62;
  const off = (camX * 0.3) % fw;
  for (let x = -off; x < vw; x += fw) ctx.drawImage(far, x, baseY, fw, fh);
  ctx.fillStyle = "#c4e3f5";
  ctx.fillRect(0, baseY + fh - 2, vw, vh);
  void mh;
}

// ---------- the frame ----------

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export function updateCamera(cam: Camera, e: Engine, vwPx: number, vhPx: number, snap = false) {
  const { w, h } = mapSize(e.map);
  const vw = vwPx / cam.scale;
  const vh = vhPx / cam.scale;
  const p = e.player;
  let tx = p.x - vw / 2;
  let ty = p.y + 150 - vh; // feet a little above the bottom, like MapleStory
  tx = vw >= w ? (w - vw) / 2 : Math.max(0, Math.min(w - vw, tx));
  ty = vh >= h ? h - vh : Math.max(0, Math.min(h - vh, ty));
  if (snap) {
    cam.x = tx;
    cam.y = ty;
  } else {
    cam.x += (tx - cam.x) * 0.15;
    cam.y += (ty - cam.y) * 0.1;
  }
}

export interface DrawInfo {
  look: Look;
  name: string;
  npcLooks: Record<string, Look>;
}

export function drawFrame(ctx: Ctx, e: Engine, cam: Camera, vwPx: number, vhPx: number, info: DrawInfo) {
  const now = e.now;
  const m = e.map;
  const s = cam.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const vw = vwPx / s;
  const vh = vhPx / s;
  ctx.save();
  ctx.scale(s, s);
  drawBackdrop(ctx, m, cam.x, cam.y, vw, vh, now);
  ctx.translate(-Math.round(cam.x * s) / s, -Math.round(cam.y * s) / s);

  const layers = mapLayers(m.id);
  ctx.drawImage(layers.back, 0, 0);
  // below the map (when the screen is taller than the map)
  const { w: mw, h: mh } = mapSize(m);
  if (cam.y + vh > mh) {
    ctx.fillStyle = m.backdrop === "cave" ? "#2a2236" : "#c9855a";
    ctx.fillRect(cam.x - 10, mh, vw + 20, cam.y + vh - mh + 10);
  }

  // torches flicker
  for (const d of m.decor) if (d.frame.startsWith("torch")) {
    const img = frame(Math.floor(now / 180) % 2 ? "torch_on_a" : "torch_on_b");
    ctx.drawImage(img, d.x * TILE - img.width / 2, d.row * TILE - img.height);
  }

  // dungeon gates
  if (e.run) {
    for (const [i, r] of m.rooms.entries()) {
      if (r.gateX === null || i < e.run.room) continue;
      for (let y = m.gateTop; y < groundRow(m); y++) ctx.drawImage(frame("bricks_grey"), r.gateX * TILE, y * TILE);
    }
  }

  // portals
  for (const p of m.portals) {
    if (p.kind === "dungeon_exit" && !e.run?.cleared) continue;
    drawPortal(ctx, p.x * TILE, p.row * TILE, now, p.kind === "cave");
  }

  // villagers
  for (const n of m.npcs) {
    ctx.save();
    ctx.translate(n.x * TILE, n.row * TILE);
    ctx.scale(-1, 1);
    drawHero(ctx, info.npcLooks[n.id], { pose: "idle", t: now + n.x * 100, progress: 0, weapon: "unarmed" });
    ctx.restore();
  }

  // monsters
  for (const mo of e.monsters) drawMonsterAt(ctx, mo, now);

  // your pet
  for (const pt of e.pets) {
    const look = petLookOf(pt.species);
    // a boss pet (or one bred from a boss) is a baby: much smaller than the real thing
    // Primal Bond: it grows giant for a moment, then shrinks back
    const gl = (pt.giantUntil ?? 0) - now;
    const grow = gl > 0 ? Math.min(1, (1200 - gl) / 150, gl / 200) : 0;
    const ps = (pt.species.split("+").some((s) => MONSTERS[s]?.isBoss) ? 0.4 : 0.8) * (1 + 2 * grow);
    ctx.save();
    ctx.translate(pt.x, pt.y);
    if (!look.flying) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(0, 0, look.body.w * 0.45 * ps, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.scale(pt.facing * ps, ps);
    const pose = now - pt.struckAt < 240 ? "attack" : pt.moving ? (Math.floor(pt.walkT / 180) % 2 ? "walk1" : "walk0") : "rest";
    drawPet(ctx, pt.species, pose, now);
    ctx.restore();
    // a small heart: this one is yours
    const top = -look.body.h * ps - (look.flying ? 30 : 10);
    ctx.fillStyle = "#ff7aa8";
    ctx.beginPath();
    ctx.moveTo(0, top + 6);
    ctx.bezierCurveTo(-9, top - 2, -5, top - 9, 0, top - 4);
    ctx.bezierCurveTo(5, top - 9, 9, top - 2, 0, top + 6);
    ctx.fill();
    ctx.restore();
  }

  // Phantom Legion shadow clones, then the player
  for (const c of e.clones) {
    const left = (c.until - now) / 1000;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.globalAlpha = Math.max(0.15, Math.min(0.5, left));
    ctx.fillStyle = "rgba(90,70,200,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, -PLAYER_H / 2, 26, 46, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(c.facing, 1);
    const since = now - (c.nextAt - WEAPON_FEEL[e.weapon].interval);
    drawHero(ctx, info.look, { pose: since < 300 ? "attack" : "idle", t: now, progress: Math.min(1, Math.max(0, since / 300)), weapon: e.weapon });
    ctx.restore();
  }
  drawPlayer(ctx, e, info);

  // projectiles
  for (const pr of e.projectiles) drawProjectile(ctx, pr.x, pr.y, pr.vx, pr.vy, pr.kind, now);

  ctx.drawImage(layers.front, 0, 0);

  // effects
  for (const f of e.fx) {
    const t = (now - f.born) / f.life;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.strokeStyle = f.color;
    ctx.fillStyle = f.color;
    if (f.kind === "slash") {
      ctx.lineWidth = 7 * (1 - t) + 2;
      ctx.beginPath();
      const a0 = f.facing > 0 ? -1.3 : Math.PI - 0.3;
      ctx.arc(f.x - f.facing * f.r * 0.3, f.y, f.r * 0.7, a0 + t * 0.6, a0 + 1.6 + t * 0.6);
      ctx.stroke();
    } else if (f.kind === "burst" || f.kind === "area") {
      ctx.lineWidth = f.kind === "area" ? 10 : 6;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (0.3 + t * 0.9), 0, Math.PI * 2);
      ctx.stroke();
      if (f.kind === "area") {
        ctx.globalAlpha *= 0.25;
        ctx.fill();
      }
    } else if (f.kind === "parry" || f.kind === "spark") {
      ctx.lineWidth = f.kind === "parry" ? 6 : 4;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r0 = f.r * 0.3 * (1 + t);
        const r1 = f.r * (0.7 + t);
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0);
        ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1);
        ctx.stroke();
      }
    } else if (f.kind === "heal") {
      ctx.font = "900 26px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "center";
      for (let i = 0; i < 3; i++) ctx.fillText("+", f.x + (i - 1) * 22, f.y - t * 50 - i * 8);
    }
    ctx.restore();
  }

  // floating numbers
  for (const tx of e.texts) {
    const t = (now - tx.born) / tx.life;
    ctx.save();
    ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
    ctx.font = `900 ${tx.size}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const y = tx.y - t * 46;
    const pop = t < 0.12 ? 1 + (0.12 - t) * 3 : 1;
    ctx.translate(tx.x, y);
    ctx.scale(pop, pop);
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(tx.text, 0, 0);
    ctx.fillStyle = tx.color;
    ctx.fillText(tx.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  void mw;
}

function drawPortal(ctx: Ctx, x: number, y: number, now: number, cave: boolean) {
  if (cave) {
    const p = new Path2D();
    p.moveTo(x - 56, y);
    p.lineTo(x - 56, y - 80);
    p.arc(x, y - 80, 56, Math.PI, 0);
    p.lineTo(x + 56, y);
    p.closePath();
    outlined(ctx, p, "#6f6a78", 6);
    const inner = new Path2D();
    inner.moveTo(x - 40, y);
    inner.lineTo(x - 40, y - 74);
    inner.arc(x, y - 74, 40, Math.PI, 0);
    inner.lineTo(x + 40, y);
    inner.closePath();
    ctx.fillStyle = "#1c1626";
    ctx.fill(inner);
  }
  ctx.save();
  ctx.translate(x, y - 56);
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = ["#7fc8ff", "#b28cff", "#e0f4ff"][i];
    ctx.globalAlpha = 0.8 - i * 0.2;
    ctx.lineWidth = 6 - i;
    ctx.beginPath();
    const a = now / (300 + i * 120) + i * 2;
    ctx.ellipse(0, 0, 26 - i * 6, 46 - i * 10, 0, a, a + Math.PI * 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMonsterAt(ctx: Ctx, m: Monster, now: number) {
  const look = MONSTER_LOOKS[m.id];
  ctx.save();
  if (m.state === "dead") {
    const t = (now - m.diedAt) / 600;
    if (t >= 1) return void ctx.restore();
    ctx.globalAlpha = 1 - t;
  }
  let x = m.x;
  if (m.state === "windup") x += Math.sin(now / 30) * 2.5;
  ctx.translate(x, m.y);
  // shadow
  if (!look.flying) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(0, 0, look.body.w * 0.45, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.scale(m.facing, 1);
  const moving = m.state === "chase" || (m.state === "patrol" && m.patrolDir !== 0);
  const pose =
    m.state === "dead"
      ? "dead"
      : m.state === "windup"
        ? "windup"
        : m.state === "recover" && now - m.struckAt < 240
          ? "attack"
          : moving
            ? Math.floor(m.walkT / 180) % 2
              ? "walk1"
              : "walk0"
            : "rest";
  drawMonster(ctx, m.id, pose, now);
  ctx.restore();
  if (now < m.flashUntil) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(0, -look.body.h / 2, look.body.w * 0.55, look.body.h * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const top = -look.body.h - (look.flying ? 34 : 6);
  // wind-up warning
  if (m.state === "windup") {
    const r = 13;
    outlined(ctx, ellipse(0, top - 22, r, r), MONSTERS[m.id].attacks[0].name === m.attack?.name ? "#ff6b5e" : "#ffcf3d", 4);
    ctx.fillStyle = "#fff";
    ctx.font = "900 20px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", 0, top - 21);
  }
  if (m.state === "stunned") {
    for (let i = 0; i < 3; i++) {
      const a = now / 200 + (i * Math.PI * 2) / 3;
      outlined(ctx, ellipse(Math.cos(a) * 22, top - 10 + Math.sin(a) * 6, 5, 5), "#ffe066", 2);
    }
  }
  // HP bar after it's been hit
  if (m.state !== "dead" && now < m.showHpUntil && !MONSTERS[m.id].isBoss) {
    const w = Math.max(50, look.body.w);
    outlined(ctx, roundRect(-w / 2, top - 4, w, 9, 3), "#3a3446", 3);
    ctx.fillStyle = "#ff5a5a";
    ctx.fillRect(-w / 2 + 1.5, top - 2.5, (w - 3) * Math.max(0, m.hp / m.maxHp), 6);
  }
  // status marks
  const marks = Object.keys(m.statuses);
  marks.forEach((k, i) => {
    ctx.fillStyle = k === "poison" ? "#a45cff" : k === "burn" ? "#ff8a3d" : k === "slow" ? "#5fb3ff" : "#ffd34d";
    ctx.beginPath();
    ctx.arc(-((marks.length - 1) * 7) + i * 14, top - 16, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawPlayer(ctx: Ctx, e: Engine, info: DrawInfo) {
  const p = e.player;
  const now = e.now;
  let pose: Pose = "idle";
  let progress = 0;
  if (p.dead) pose = "dead";
  else if (p.onLadder) pose = "climb";
  else if (now < p.hurtUntil) pose = "hurt";
  else if (now < p.castUntil) {
    pose = "cast";
    progress = (now - p.castStart) / (p.castUntil - p.castStart);
  } else if (now < p.attackUntil) {
    pose = "attack";
    progress = (now - p.attackStart) / (p.attackUntil - p.attackStart);
  } else if (p.blocking) pose = "block";
  else if (!p.onGround) pose = p.vy < 0 ? "jump" : "fall";
  else if (Math.abs(p.vx) > 1) pose = "walk";
  ctx.save();
  ctx.translate(p.x, p.y);
  // shadow
  if (p.onGround) {
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Wolf's Scars: a faint ring shows how far the aura reaches
  const scars = e.combat.passive.scar_aura;
  if (scars && !p.dead) {
    ctx.save();
    ctx.strokeStyle = "rgba(190,60,60,0.35)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -now / 40;
    ctx.beginPath();
    ctx.ellipse(0, -PLAYER_H / 2, scars.radius, scars.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (now < p.invulnUntil && Math.floor(now / 90) % 2 === 0) ctx.globalAlpha = 0.45;
  if (now < p.invisibleUntil) ctx.globalAlpha = 0.35;
  if (now < p.counterUntil) {
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(now / 80) * 0.15;
    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    ctx.ellipse(0, -PLAYER_H / 2, 36, 52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.scale(p.facing, 1);
  drawHero(ctx, info.look, { pose, t: p.onLadder ? p.walkT : pose === "walk" ? p.walkT : now, progress, weapon: e.weapon });
  ctx.restore();
  // Green Slime's Mercy: a wobbly coat of green slime over the whole body
  if (e.combat.passive.slime_mercy && !p.dead) {
    ctx.save();
    const wob = Math.sin(now / 160) * 2;
    ctx.globalAlpha *= 0.32;
    ctx.fillStyle = "#5fd36a";
    ctx.beginPath();
    ctx.ellipse(0, -PLAYER_H / 2 + 2, 24 + wob, PLAYER_H / 2 + 6 - wob, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha *= 1.8;
    ctx.strokeStyle = "#2f9c45";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(-9, -PLAYER_H + 14, 4, 7, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // status marks above the head
  const sts = Object.keys(p.statuses);
  sts.forEach((k, i) => {
    ctx.fillStyle = k === "poison" ? "#a45cff" : k === "burn" ? "#ff8a3d" : k === "slow" ? "#5fb3ff" : k === "silence" ? "#9aa3b5" : "#ffd34d";
    ctx.beginPath();
    ctx.arc(-((sts.length - 1) * 8) + i * 16, -PLAYER_H - 22, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  // name tag
  ctx.font = "700 14px ui-rounded, system-ui, sans-serif";
  const tw = ctx.measureText(info.name).width + 14;
  ctx.fillStyle = "rgba(30,26,40,0.75)";
  ctx.beginPath();
  ctx.roundRect?.(-tw / 2, 6, tw, 20, 6);
  if (!ctx.roundRect) ctx.rect(-tw / 2, 6, tw, 20);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(info.name, 0, 16.5);
  ctx.restore();
}

function drawProjectile(ctx: Ctx, x: number, y: number, vx: number, vy: number, kind: string, now: number) {
  const dir = vx >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  // tilt to match the flight path (aimed shots can fly up or down)
  if (vy) ctx.rotate(Math.atan2(vy, Math.abs(vx)));
  switch (kind) {
    case "arrow":
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.strokeStyle = "#c8925a";
      ctx.lineWidth = 3;
      ctx.stroke();
      outlined(ctx, poly([8, -6, 20, 0, 8, 6]), "#d9dde3", 2);
      break;
    case "bullet":
      outlined(ctx, ellipse(0, 0, 8, 5), "#ffd34d", 3);
      break;
    case "magic":
    case "holy":
    case "star":
    case "venom": {
      const col = kind === "magic" ? "#6fd3a3" : kind === "holy" ? "#fff2b0" : kind === "star" ? "#ffd35c" : "#8fe36f";
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(-10, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (kind === "star") {
        ctx.rotate(now / 80);
        outlined(ctx, poly([0, -12, 4, -4, 12, -4, 6, 2, 8, 11, 0, 6, -8, 11, -6, 2, -12, -4, -4, -4]), col, 3);
      } else outlined(ctx, ellipse(0, 0, 10, 10), col, 3);
      break;
    }
  }
  ctx.restore();
}

/** Monster name for the boss bar. */
export const bossOf = (e: Engine) => e.monsters.find((m) => MONSTERS[m.id].isBoss && m.state !== "dead") ?? null;

export { shade };
