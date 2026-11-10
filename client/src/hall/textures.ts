// Textures drawn on 2D canvases: labels, the LED screen. No fonts or images
// are fetched from outside the app.
import { formatAmount, type Lot, type Snapshot } from "@auction/shared";
import { CanvasTexture, SRGBColorSpace, TextureLoader, type Texture } from "three";
import { team } from "../view";

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

/** Draws the big LED screen: player photo, name, role and the live price. */
export function drawScreen(g: CanvasRenderingContext2D, s: Snapshot, lot: Lot | null, redraw: () => void): void {
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.fillStyle = "#08071d";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#3a3488";
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  if (!lot) {
    g.fillStyle = "#f3c34f";
    g.font = "600 120px Teko, 'Arial Narrow', sans-serif";
    g.textAlign = "center";
    g.fillText("IPL AUCTION", W / 2, H / 2 + 40);
    return;
  }
  const pad = 48;
  const photoW = 340;
  const photoH = H - pad * 2;
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
    g.fillText(lot.name.split(" ").map((w) => w[0]).slice(0, 2).join(""), pad + photoW / 2, H / 2 + 50);
  }
  const x = pad + photoW + 48;
  g.textAlign = "left";
  g.fillStyle = "#f3c34f";
  g.font = "600 38px 'Barlow Condensed', sans-serif";
  g.fillText(`LOT ${s.lotIndex + 1} / ${s.lotCount} · ${lot.set.toUpperCase()}`, x, 110);
  g.fillStyle = "#ffffff";
  g.font = "600 128px Teko, 'Arial Narrow', sans-serif";
  g.fillText(lot.name.toUpperCase(), x, 230, W - x - pad);
  g.fillStyle = "#a6a2d6";
  g.font = "500 44px 'Barlow Condensed', sans-serif";
  g.fillText(`${lot.role} · ${lot.country}${lot.overseas ? " · Overseas" : ""}`, x, 290);

  let label = "OPENING BID";
  let amount = formatAmount(lot.base);
  if (s.lead) {
    label = s.phase === "sold" ? `SOLD TO ${s.lead.teamId}` : `CURRENT BID · ${team(s.lead.teamId).city.toUpperCase()}`;
    amount = formatAmount(s.lead.amount);
  } else if (s.phase === "sold") {
    label = "UNSOLD";
  }
  g.fillStyle = "#a6a2d6";
  g.font = "600 40px 'Barlow Condensed', sans-serif";
  g.fillText(label, x, 400);
  g.fillStyle = s.phase === "sold" && s.lead ? "#33d17a" : "#f3c34f";
  g.font = "600 170px Teko, 'Arial Narrow', sans-serif";
  g.fillText(amount, x, 540);
}
