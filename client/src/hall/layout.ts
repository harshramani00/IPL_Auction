// Where everything sits in the hall, in metres. The stage is at the back
// (negative z), the camera starts behind the tables (positive z).
import { TEAM_IDS, type TeamId } from "@auction/shared";
import { Vector3 } from "three";

export const STAGE = { x: 0, z: -4.2, radius: 3.6, height: 0.4 };
export const PODIUM = new Vector3(0, STAGE.height, -3.55);
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
}

/** Camera framings the director cuts between. */
export const SHOTS = {
  wide: (): Shot => ({ position: new Vector3(0, 4.4, 11), target: new Vector3(0, 1.7, -3.4) }),
  /** Mid shot on the auctioneer: close enough to feel tense, not so close a real-time face looks uncanny. */
  auctioneer: (): Shot => ({ position: new Vector3(0.6, 2.25, -0.2), target: new Vector3(0, 1.75, -4.25) }),
  table: (id: TeamId): Shot => {
    const t = tableOf(id);
    return {
      position: t.position.clone().addScaledVector(t.outward, 3.6).add(new Vector3(0.4, 1.9, 0)),
      target: t.position.clone().add(new Vector3(0, 1.3, 0)),
    };
  },
  winner: (id: TeamId): Shot => {
    const t = tableOf(id);
    return {
      position: t.position.clone().addScaledVector(t.outward, 5).add(new Vector3(0, 3, 0)),
      target: t.position.clone().lerp(PODIUM, 0.25).add(new Vector3(0, 1, 0)),
    };
  },
};
