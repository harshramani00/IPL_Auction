// Where everything sits in the hall, in metres. The stage is at the back
// (negative z), the camera starts behind the tables (positive z).
import { TEAM_IDS, type TeamId } from "@auction/shared";
import { Vector3 } from "three";

export const STAGE = { x: 0, z: -4.2, radius: 3.6, height: 0.4 };
export const PODIUM = new Vector3(0, STAGE.height, -3.55);
/** The podium's top surface, and the gavel's sound block on it by his right hand (top centre). */
export const PODIUM_TOP = STAGE.height + 1.085;
export const GAVEL_BLOCK = new Vector3(-0.3, PODIUM_TOP + 0.04, -3.8);
/** Where the auctioneer stands (his feet). */
export const AUCTIONEER = new Vector3(0, STAGE.height, -4.25);
export const SCREEN = { center: new Vector3(0, 3.7, -6.9), width: 6.4, height: 3.6 };

/** Tables on an arc facing the podium. */
const ARC_CENTER = new Vector3(0, 0, -3.6);
const ARC_RADIUS = 7.2;
const ARC_SPAN = (65 * Math.PI) / 180;

export interface TableSpot {
  id: TeamId;
  position: Vector3;
  /** Y rotation so the table faces the podium. */
  rotation: number;
  /** Unit vector from the podium out towards this table (and the camera side). */
  outward: Vector3;
}

export const TABLES: TableSpot[] = TEAM_IDS.map((id, i) => {
  const a = -ARC_SPAN + (2 * ARC_SPAN * i) / (TEAM_IDS.length - 1);
  const outward = new Vector3(Math.sin(a), 0, Math.cos(a));
  return {
    id,
    position: ARC_CENTER.clone().addScaledVector(outward, ARC_RADIUS),
    rotation: a + Math.PI,
    outward,
  };
});

export const tableOf = (id: TeamId) => TABLES.find((t) => t.id === id)!;

export interface Shot {
  position: Vector3;
  target: Vector3;
  /** Horizontal field of view (degrees) the shot must always show, whatever the canvas shape. */
  hfov?: number;
}

/** The lens on a 16:9 canvas. Narrower canvases widen it so a shot keeps its sides. */
export const BASE_VFOV = 38;
const rad = Math.PI / 180;
/** ~63°: what BASE_VFOV covers across at 16:9, the default each shot keeps. */
export const DEFAULT_HFOV = (2 * Math.atan(Math.tan((BASE_VFOV / 2) * rad) * (16 / 9))) / rad;

/** The vertical field of view that shows at least `hfov` across at this aspect ratio. */
export function vfovFor(aspect: number, hfov = DEFAULT_HFOV): number {
  const fit = (2 * Math.atan(Math.tan((hfov / 2) * rad) / aspect)) / rad;
  return Math.max(BASE_VFOV, fit);
}

/** Camera framings the director cuts between. */
export const SHOTS = {
  /** The whole room: wide enough for the end tables of the arc (about ±7.3 m) on any screen. */
  wide: (): Shot => ({ position: new Vector3(0, 4.4, 11), target: new Vector3(0, 1.7, -3.4), hfov: 74 }),
  /** Head and shoulders on the auctioneer, over the podium, for "going twice". */
  auctioneer: (): Shot => ({ position: new Vector3(0.75, 2.2, -2.15), target: new Vector3(0, 2.02, -4.2) }),
  /** From his gavel side: the whole swing, from beside his ear down to the block. */
  gavel: (): Shot => ({ position: new Vector3(-1.45, 2.05, -2.2), target: new Vector3(-0.5, 1.66, -4) }),
  /** The bidding table from the stage side: the owners' faces and the paddle going up, the audience behind. */
  table: (id: TeamId): Shot => {
    const t = tableOf(id);
    const side = new Vector3(-t.outward.z, 0, t.outward.x);
    return {
      position: t.position.clone().addScaledVector(t.outward, -2.7).addScaledVector(side, 0.5).setY(1.55),
      target: t.position.clone().addScaledVector(t.outward, 0.85).setY(1.3),
    };
  },
  /** The winners, a little wider, with room above for the confetti. */
  winner: (id: TeamId): Shot => {
    const t = tableOf(id);
    const side = new Vector3(-t.outward.z, 0, t.outward.x);
    return {
      position: t.position.clone().addScaledVector(t.outward, -3.9).addScaledVector(side, -0.9).setY(1.9),
      target: t.position.clone().addScaledVector(t.outward, 0.7).setY(1.55),
    };
  },
};
