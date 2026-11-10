// Textures drawn on 2D canvases: labels, the LED screen. No fonts or images
// are fetched from outside the app.
import { formatAmount, type Lot, type Snapshot } from "@auction/shared";
import { CanvasTexture, SRGBColorSpace, TextureLoader, type Texture } from "three";
import { stats, statsByName } from "@auction/shared/data";
import { statRows, statValue, team } from "../view";

export function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A rounded label, e.g. "P1 · Harsh" over a table. */
export function labelTexture(text: string, color: string): CanvasTexture {
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = "rgba(10, 9, 32, 0.85)";
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(6, 14, 500, 100, 50);
    g.fill();
    g.stroke();
    g.fillStyle = color;
    g.font = "600 56px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text.toUpperCase(), 256, 66);
  });
}

const loader = new TextureLoader();
const cache = new Map<string, Texture>();
export function imageTexture(url: string): Texture {
  let tex = cache.get(url);
  if (!tex) {
    tex = loader.load(url);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    cache.set(url, tex);
  }
  return tex;
}

const photos = new Map<string, HTMLImageElement>();
function photo(url: string, onLoad: () => void): HTMLImageElement | null {
  const cached = photos.get(url);
  if (cached) return cached.complete ? cached : null;
  const img = new Image();
  img.onload = onLoad;
  img.src = url;
  photos.set(url, img);
  return null;
}

/** The screen's layout units; the canvas can be any 16:9 size. */
const SW = 1280;
const SH = 720;

/** Draws the big LED screen: player photo, name, role, stats and the live price. */
export function drawScreen(g: CanvasRenderingContext2D, s: Snapshot, lot: Lot | null, redraw: () => void): void {
  g.setTransform(g.canvas.width / SW, 0, 0, g.canvas.height / SH, 0, 0);
  g.fillStyle = "#08071d";
  g.fillRect(0, 0, SW, SH);
  g.strokeStyle = "#3a3488";
  g.lineWidth = 10;
  g.strokeRect(5, 5, SW - 10, SH - 10);
  if (!lot) {
    g.fillStyle = "#f3c34f";
    g.font = "600 120px Teko, 'Arial Narrow', sans-serif";
    g.textAlign = "center";
    g.fillText("IPL AUCTION", SW / 2, SH / 2 + 40);
    return;
  }
  const pad = 40;
  const photoW = 320;
  const photoH = SH - pad * 2;
  g.fillStyle = "#1b1846";
  g.fillRect(pad, pad, photoW, photoH);
  const img = lot.photo ? photo(lot.photo, redraw) : null;
  if (img) {
    // Cover-fit, anchored near the top so faces stay in frame.
    const scale = Math.max(photoW / img.width, photoH / img.height);
    const sw = photoW / scale;
    const sh = photoH / scale;
    g.drawImage(img, (img.width - sw) / 2, (img.height - sh) * 0.15, sw, sh, pad, pad, photoW, photoH);
  } else {
    g.fillStyle = "#f3c34f";
    g.font = "600 150px Teko, sans-serif";
    g.textAlign = "center";
    g.fillText(lot.name.split(" ").map((w) => w[0]).slice(0, 2).join(""), pad + photoW / 2, SH / 2 + 50);
  }
  const x = pad + photoW + 40;
  const w = SW - x - pad;
  g.textAlign = "left";
  g.fillStyle = "#f3c34f";
  g.font = "600 30px 'Barlow Condensed', sans-serif";
  const lotNo = s.phase === "lobby" ? "UP FIRST" : `LOT ${s.lotIndex + 1} / ${s.lotCount}`;
  g.fillText(`${lotNo} · ${lot.set.toUpperCase()}`, x, 80, w);
  g.fillStyle = "#ffffff";
  g.font = "600 100px Teko, 'Arial Narrow', sans-serif";
  g.fillText(lot.name.toUpperCase(), x, 166, w);
  g.fillStyle = "#a6a2d6";
  g.font = "500 34px 'Barlow Condensed', sans-serif";
  g.fillText(`${lot.role} · ${lot.country}${lot.overseas ? " · Overseas" : ""}${lot.capped ? "" : " · Uncapped"}`, x, 210, w);

  drawStats(g, lot, x - 14, 236, w + 14, 318);
  g.textAlign = "left";

  let label = "OPENING BID";
  let amount = formatAmount(lot.base);
  if (s.lead) {
    label = s.phase === "sold" ? `SOLD TO ${s.lead.teamId}` : `CURRENT BID · ${team(s.lead.teamId).city.toUpperCase()}`;
    amount = formatAmount(s.lead.amount);
  } else if (s.phase === "sold") {
    label = "UNSOLD";
  }
  g.fillStyle = "#a6a2d6";
  g.font = "600 30px 'Barlow Condensed', sans-serif";
  g.fillText(label, x, 598);
  g.fillStyle = s.phase === "sold" && s.lead ? "#33d17a" : "#f3c34f";
  g.font = "600 124px Teko, 'Arial Narrow', sans-serif";
  g.fillText(amount, x, 690);
  if (stats.statsAsOf) {
    const asOf = new Date(stats.statsAsOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    g.textAlign = "right";
    g.fillStyle = "#6c68a6";
    g.font = "500 22px 'Barlow Condensed', sans-serif";
    g.fillText(`STATS TO ${asOf.toUpperCase()} · ${stats.source.split(" ")[0]!.toUpperCase()}`, SW - pad, 598);
  }
}

/** The stats table on the screen: last season, IPL career and T20 career. */
function drawStats(g: CanvasRenderingContext2D, lot: Lot, x: number, y: number, w: number, h: number): void {
  const st = statsByName.get(lot.name);
  g.fillStyle = "#120f35";
  g.beginPath();
  g.roundRect(x, y, w, h, 14);
  g.fill();
  if (!st) {
    g.fillStyle = "#a6a2d6";
    g.font = "500 32px 'Barlow Condensed', sans-serif";
    g.textAlign = "center";
    g.fillText("No T20 record on file for this player", x + w / 2, y + h / 2 + 10);
    return;
  }
  const rows: [string, (string | null | undefined)[]][] = statRows(lot.cat).map((r) => [
    r[0], [st.last, st.ipl, st.t20].map((b) => statValue(b, r)),
  ]);
  const best = lot.cat === "BOWL" ? st.ipl?.bb
    : lot.cat === "AR" ? [st.ipl?.hs, st.ipl?.bb].filter(Boolean).join(" · ")
      : st.ipl?.hs;
  // Only the IPL column has a best; the row leaves the others blank.
  if (best) rows.push(["IPL best", [undefined, best, undefined]]);

  const labelW = 190;
  const colW = (w - labelW - 24) / 3;
  const colRight = (i: number) => x + labelW + colW * (i + 1);
  const head = [`${stats.season}${st.last?.team ? ` · ${st.last.team}` : ""}`, "IPL CAREER", "T20 CAREER"];
  g.font = "600 24px 'Barlow Condensed', sans-serif";
  g.textAlign = "right";
  head.forEach((t, i) => {
    g.fillStyle = i === 0 ? "#f3c34f" : "#8f8bc8";
    g.fillText(t.toUpperCase(), colRight(i), y + 38);
  });
  g.fillStyle = "#2a2566";
  g.fillRect(x + 16, y + 52, w - 32, 2);

  const step = Math.min(44, (h - 70) / rows.length);
  rows.forEach(([label, vals], r) => {
    const by = y + 58 + step * (r + 0.5) + 11;
    g.textAlign = "left";
    g.fillStyle = "#a6a2d6";
    g.font = "500 30px 'Barlow Condensed', sans-serif";
    g.fillText(label, x + 20, by);
    g.textAlign = "right";
    g.font = "600 38px Teko, 'Arial Narrow', sans-serif";
    vals.forEach((v, i) => {
      if ((i === 0 && !st.last) || v === undefined) return;
      g.fillStyle = v === null ? "#4a4686" : i === 0 ? "#ffffff" : "#d9d7f2";
      g.fillText(v ?? "—", colRight(i), by);
    });
  });
  if (!st.last) {
    g.textAlign = "right";
    g.fillStyle = "#6c68a6";
    g.font = "500 28px 'Barlow Condensed', sans-serif";
    g.fillText("Didn't play", colRight(0), y + 58 + (h - 58) / 2 + 10);
  }
}
