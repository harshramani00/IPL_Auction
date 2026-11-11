// The ten franchise tables, each with its owners and a paddle that shoots up
// when the team bids and stays raised while it leads.
import type { Snapshot } from "@auction/shared";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LatheGeometry, MathUtils, Vector2,
  type Group, type MeshStandardMaterial, type Object3D, type Vector3,
} from "three";
import { seatColor, seatName, team } from "../view";
import { renderQuality } from "./Effects";
import { TABLES, tableOf, type TableSpot } from "./layout";
import { Chair, seated, usePaddleHold, usePeople, useSeatedLife, type Sitting } from "./People";
import { wood } from "./Rocketbox";
import { imageTexture, labelTexture } from "./textures";

/** Owners sit back from the table so their knees clear it; the right-hand one holds the paddle. */
const SEATS = [-0.42, 0.36];
const SEAT_Z = -0.95;
/**
 * Where the paddle's grip is (table space) and how far it tips forward
 * (radians about x; 0 is upright facing the stage).
 */
interface PaddlePose { x: number; y: number; z: number; tip: number }
/** Lying forward over the table, in a loose hand. */
const PADDLE_DOWN: PaddlePose = { x: 0.62, y: 0.83, z: -0.5, tip: 1.45 };
/** Stood upright on the table edge: this team holds the bid. */
const PADDLE_SHOWN: PaddlePose = { x: 0.62, y: 0.94, z: -0.5, tip: 0.1 };
/** Thrust up above the shoulder: a bid. */
const PADDLE_UP: PaddlePose = { x: 0.64, y: 1.52, z: -0.7, tip: -0.14 };
/** How long a bid keeps the paddle in the air (seconds). */
const PADDLE_HOLD = 1.3;
const POSE_KEYS = ["x", "y", "z", "tip"] as const;

const turned = (profile: [number, number][], segments = 24) =>
  new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);
/** The paddle's turned handle: origin in the fist, up +y to the neck. */
const paddleHandle = () => turned([
  [0, -0.085], [0.012, -0.085], [0.0155, -0.076], [0.014, -0.04], [0.0125, 0], [0.0135, 0.05],
  [0.011, 0.1], [0.0095, 0.14], [0, 0.14],
]);
const DISC_Y = 0.3;
const DISC_R = 0.165;

const PARTNER_POSES: Sitting[] = [
  { hands: "table", lean: 0.24, inward: 0.45 }, // hands together, leaning in
  { hands: "table", lean: 0.1, inward: 0.1, lapSide: "L" }, // one arm on the table
  { hands: "thighs", lean: 0.02 }, // sitting back
  { hands: "table", lean: 0.16, inward: 0.25, lapSide: "R" },
];

export function Tables({ s }: { s: Snapshot }) {
  const lobby = s.phase === "lobby";
  const people = usePeople();
  // Two owners per table, never the same pair at neighbouring tables.
  const owners = useMemo(() => {
    if (!people) return null;
    const shadows = renderQuality() === "high";
    return TABLES.map((_, i) => SEATS.map((_, j) => {
      // The paddle holder keeps both arms forward; their partner sits one of a few ways.
      const m = seated(people[(i * 2 + j + (i % 3)) % people.length]!, j === 1 ? { hands: "table", lean: 0.2 } : PARTNER_POSES[i % PARTNER_POSES.length]!);
      m.traverse((o) => { o.castShadow = shadows; });
      return m;
    }) as [Object3D, Object3D]);
  }, [people]);
  // For a moment after each bid, the other tables turn to see who it was.
  const [bidder, setBidder] = useState<Vector3 | null>(null);
  const leadId = lobby ? null : s.lead?.teamId ?? null;
  useEffect(() => {
    if (!leadId) return;
    setBidder(tableOf(leadId).position);
    const t = setTimeout(() => setBidder(null), 2200);
    return () => clearTimeout(t);
  }, [leadId, s.bidSeq]);
  return (
    <group>
      {TABLES.map((spot, i) => {
        const owner = s.owners[spot.id];
        const label = owner ? `P${owner} · ${seatName(s, owner)}` : lobby ? "Free" : "AI";
        const leading = !lobby && s.lead?.teamId === spot.id;
        return (
          <Table key={spot.id} spot={spot} label={label} owners={owners?.[i] ?? null} index={i}
            focus={leading ? null : bidder}
            labelColor={owner ? seatColor(owner) : lobby ? "#f3c34f" : "#8c89b8"}
            leading={leading} bump={leading ? s.bidSeq : 0} />
        );
      })}
    </group>
  );
}

interface TableProps {
  spot: TableSpot;
  label: string;
  labelColor: string;
  leading: boolean;
  /** Changes on every bid by this team: replays the paddle raise. */
  bump: number;
  /** The seated owners, or null while they load (stand-ins show instead). */
  owners: [Object3D, Object3D] | null;
  index: number;
  /** A table that has just bid, for the owners to look at. */
  focus: Vector3 | null;
}

function Table({ spot, label, labelColor, leading, bump, owners, index, focus }: TableProps) {
  const t = team(spot.id);
  const logo = imageTexture(`/logos/${spot.id}.png`);
  const tag = useMemo(() => labelTexture(label, labelColor), [label, labelColor]);
  useEffect(() => () => tag.dispose(), [tag]);
  const paddle = useRef<Group>(null);
  const disc = useRef<MeshStandardMaterial>(null);
  const bumpAt = useRef(-10);

  useEffect(() => {
    if (bump) bumpAt.current = performance.now() / 1000;
  }, [bump]);

  // The paddle swings between its poses on springs, so it arrives with a little overshoot.
  const motion = useRef({ ...PADDLE_DOWN, vx: 0, vy: 0, vz: 0, vtip: 0 });
  const handle = useMemo(paddleHandle, []);
  useFrame((state, dt) => {
    const g = paddle.current;
    if (!g) return;
    const sinceBump = performance.now() / 1000 - bumpAt.current;
    // Development only: window.__paddle = { DC: "up" } holds a table's paddle in a pose for tuning.
    const forced = import.meta.env.DEV ? (window as unknown as { __paddle?: Record<string, string> }).__paddle?.[spot.id] : undefined;
    const target = forced === "up" || (!forced && sinceBump < PADDLE_HOLD) ? PADDLE_UP
      : forced === "shown" || (!forced && leading) ? PADDLE_SHOWN : PADDLE_DOWN;
    const m = motion.current;
    const step = Math.min(dt, 1 / 30);
    // Quick and springy going up, slower and softer coming down.
    const stiff = target === PADDLE_UP ? 190 : 70;
    const damp = target === PADDLE_UP ? 17 : 13;
    for (const key of POSE_KEYS) {
      const vk = `v${key}` as "vx" | "vy" | "vz" | "vtip";
      m[vk] += ((target[key] - m[key]) * stiff - m[vk] * damp) * step;
      m[key] += m[vk] * step;
    }
    g.position.set(m.x, m.y, m.z);
    // A small shake of the wrist while it's in the air.
    const wave = sinceBump < PADDLE_HOLD ? Math.sin(sinceBump * 15) * 0.07 * Math.sin((sinceBump / PADDLE_HOLD) * Math.PI) : 0;
    g.rotation.set(m.tip, 0, wave);
    if (disc.current) {
      const glow = leading ? 0.35 + Math.sin(state.clock.elapsedTime * 4) * 0.08 : 0;
      disc.current.emissiveIntensity = MathUtils.lerp(disc.current.emissiveIntensity, glow, 1 - Math.exp(-dt * 12));
    }
  });

  return (
    <group position={spot.position} rotation-y={spot.rotation}>
      {/* Table, cloth in team colours */}
      <mesh position={[0, 0.77, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.72, 0.05, 0.86]} />
        <meshStandardMaterial color="#2a2033" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.375, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.74, 0.75, 0.88]} />
        <meshStandardMaterial color={t.color} roughness={0.75} />
      </mesh>
      {/* Logo panel on the camera side (local -z faces away from the podium) */}
      <group position={[0, 0.42, -0.445]} rotation-y={Math.PI}>
        <mesh>
          <circleGeometry args={[0.25, 48]} />
          <meshStandardMaterial color="#ffffff" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, 0.002]}>
          <planeGeometry args={[0.38, 0.38]} />
          <meshStandardMaterial map={logo} transparent roughness={0.5} />
        </mesh>
      </group>
      {/* Two owners seated behind the table */}
      {SEATS.map((x) => <Chair key={x} position={[x, 0, SEAT_Z]} />)}
      {owners ? (
        <>
          <Owner model={owners[0]} seed={(index * 0.37 + 0.11) % 1} focus={focus} />
          <PaddleHolder model={owners[1]} seed={(index * 0.61 + 0.53) % 1} focus={focus} grip={paddle} />
        </>
      ) : SEATS.map((x) => <StandIn key={x} x={x} />)}
      {/* Paddle, held in the right-hand owner's left hand. Its origin is the grip. */}
      <group ref={paddle} position={[PADDLE_DOWN.x, PADDLE_DOWN.y, PADDLE_DOWN.z]} rotation-x={PADDLE_DOWN.tip}>
        <mesh geometry={handle} material={wood()} castShadow />
        {/* Neck: the handle flattens into the board */}
        <mesh position={[0, 0.145, 0]} material={wood()} castShadow>
          <boxGeometry args={[0.034, 0.05, 0.012]} />
        </mesh>
        <group position={[0, DISC_Y, 0]}>
          {/* Board edge in the team's colour, with a printed face each side */}
          <mesh rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[DISC_R, DISC_R, 0.012, 56]} />
            <meshStandardMaterial ref={disc} color={t.color} emissive={t.color} emissiveIntensity={0} roughness={0.45} />
          </mesh>
          <mesh>
            <torusGeometry args={[DISC_R, 0.0045, 10, 56]} />
            <meshStandardMaterial color="#d9b25a" metalness={0.85} roughness={0.3} />
          </mesh>
          {[1, -1].map((face) => (
            <group key={face} rotation-y={face === 1 ? 0 : Math.PI}>
              <mesh position={[0, 0, 0.0065]}>
                <circleGeometry args={[DISC_R - 0.012, 56]} />
                <meshPhysicalMaterial color="#ffffff" roughness={0.35} clearcoat={0.6} clearcoatRoughness={0.25} />
              </mesh>
              <mesh position={[0, 0, 0.0075]}>
                <planeGeometry args={[0.235, 0.235]} />
                <meshStandardMaterial map={logo} transparent roughness={0.4} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
      {/* Owner tag floating above, facing the camera side */}
      <mesh position={[0, 2.15, -0.2]} rotation-y={Math.PI}>
        <planeGeometry args={[1, 0.25]} />
        <meshBasicMaterial map={tag} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

interface OwnerProps {
  model: Object3D;
  /** 0..1: keeps each owner's blinking and glances out of step with the rest. */
  seed: number;
  focus: Vector3 | null;
}

function Owner({ model, seed, focus }: OwnerProps) {
  useSeatedLife(model, seed, focus);
  return <group position={[SEATS[0]!, 0, SEAT_Z]}><primitive object={model} /></group>;
}

function PaddleHolder({ model, seed, focus, grip }: OwnerProps & { grip: React.RefObject<Object3D | null> }) {
  // Life first: breathing moves the shoulder the arm is then solved from.
  useSeatedLife(model, seed, focus);
  usePaddleHold(model, grip);
  return <group position={[SEATS[1]!, 0, SEAT_Z]}><primitive object={model} /></group>;
}

/** A plain seated figure while the real people load. */
function StandIn({ x }: { x: number }) {
  return (
    <group position={[x, 0, SEAT_Z]}>
      <mesh position={[0, 0.98, 0]} castShadow>
        <capsuleGeometry args={[0.19, 0.42, 4, 12]} />
        <meshStandardMaterial color="#25214a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.47, 0]} castShadow>
        <sphereGeometry args={[0.125, 20, 16]} />
        <meshStandardMaterial color="#2e2a58" roughness={0.8} />
      </mesh>
    </group>
  );
}
