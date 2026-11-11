// Realistic people for the hall: team owners seated at the tables and the
// audience behind them. Six Rocketbox business avatars (MIT,
// static/models/rocketbox/people/) are cloned and sat down by aiming their
// leg and arm bones. The owner beside each paddle holds it, with their arm
// solved every frame; the audience is posed once and frozen into instanced
// static meshes, so a full house costs a handful of draw calls.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  BufferAttribute, BufferGeometry, Color, Euler, InstancedMesh, Matrix4, Quaternion, Vector3,
  type Material, type Object3D, type SkinnedMesh,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { renderQuality } from "./Effects";
import { AUCTIONEER, SCREEN } from "./layout";
import { aim, animateFace, bone, faceOf, loadAvatar, restFace } from "./Rocketbox";

const PEOPLE = [
  { name: "Business_Male_02", height: 1.8 },
  { name: "Business_Female_01", height: 1.68 },
  { name: "Business_Male_03", height: 1.84 },
  { name: "Business_Female_02", height: 1.7 },
  { name: "Business_Male_04", height: 1.78 },
  { name: "Business_Female_03", height: 1.66 },
];

let loading: Promise<Object3D[]> | null = null;
function loadPeople(): Promise<Object3D[]> {
  loading ??= Promise.all(PEOPLE.map((p) => loadAvatar({
    dir: `/models/rocketbox/people/${p.name}/`, file: `${p.name}.fbx`, height: p.height,
    physical: renderQuality() === "high",
  })));
  return loading;
}

/** The six avatars once loaded, or null while loading (or if they fail: callers keep their stand-ins). */
export function usePeople(): Object3D[] | null {
  const [people, setPeople] = useState<Object3D[] | null>(null);
  useEffect(() => {
    let live = true;
    loadPeople().then((p) => live && setPeople(p)).catch(() => {});
    return () => { live = false; };
  }, []);
  return people;
}

/** Seat top above the floor, and where the pelvis sits above it. */
export const SEAT_Y = 0.46;
const PELVIS_Y = SEAT_Y + 0.09;

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const _q = new Quaternion();
const _axis = new Vector3();

function curl(model: Object3D, side: "L" | "R", angle: number): void {
  for (const finger of [1, 2, 3, 4]) {
    for (const joint of ["", "1", "2"]) {
      const b = model.getObjectByName(`Bip01_${side}_Finger${finger}${joint}`);
      b?.quaternion.multiply(_q.setFromAxisAngle(_axis.set(0, 0, 1), angle));
    }
  }
}

export interface Sitting {
  /** "table": forearms forward on a table. "lap": hands in the lap. "thighs": hands resting on the thighs. */
  hands: "table" | "lap" | "thighs";
  /** How far the back leans forward (0 upright, 0.3 well over the table). */
  lean?: number;
  /** Forearms angled in towards each other (hands near together) or out (apart). */
  inward?: number;
  /** One arm dropped to the lap instead. */
  lapSide?: "L" | "R" | null;
  /** A fixed head turn and nod, for people who are never animated (radians; + is left / down). */
  head?: { yaw: number; pitch: number };
}

// Bone-local axes on this rig: the spine, neck and head run along x, so a
// turn (yaw) is about x and a nod (pitch, + is down) is about z.
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/**
 * A clone of `src` sitting on a chair, facing +z, with the pelvis over the
 * origin. `userData.lean` records the back's lean so the head can be levelled.
 */
export function seated(src: Object3D, { hands, lean = hands === "table" ? 0.2 : 0.06, inward = 0.3, lapSide = null, head }: Sitting): Object3D {
  const m = cloneSkinned(src);
  m.updateMatrixWorld(true);
  const b = (name: string) => bone(m, `Bip01_${name}`);
  aim(b("Spine"), b("Neck"), v(0, 1, lean), 1);
  // Their left is +x.
  for (const [side, sx] of [["L", 1], ["R", -1]] as const) {
    aim(b(`${side}_Thigh`), b(`${side}_Calf`), v(sx * 0.12, -0.06, 1), 1);
    aim(b(`${side}_Calf`), b(`${side}_Foot`), v(sx * 0.02, -1, 0.14), 1);
    const pose = lapSide === side ? "lap" : hands;
    if (pose === "table") {
      aim(b(`${side}_UpperArm`), b(`${side}_Forearm`), v(sx * 0.14, -0.78, 0.6), 1);
      aim(b(`${side}_Forearm`), b(`${side}_Hand`), v(-sx * inward, -0.06, 1), 1);
    } else if (pose === "thighs") {
      aim(b(`${side}_UpperArm`), b(`${side}_Forearm`), v(sx * 0.1, -1, 0.3), 1);
      aim(b(`${side}_Forearm`), b(`${side}_Hand`), v(sx * 0.02, -0.42, 1), 1);
    } else {
      aim(b(`${side}_UpperArm`), b(`${side}_Forearm`), v(sx * 0.06, -1, 0.22), 1);
      aim(b(`${side}_Forearm`), b(`${side}_Hand`), v(-sx * 0.22, -0.5, 1), 1);
    }
    curl(m, side, 0.45);
  }
  m.userData.lean = Math.atan(lean);
  if (head) {
    // Level the head against the lean, then the fixed turn.
    const pitch = head.pitch - m.userData.lean;
    b("Neck").quaternion.multiply(_q.setFromAxisAngle(X, head.yaw * 0.35)).multiply(_q.setFromAxisAngle(Z, pitch * 0.4));
    b("Head").quaternion.multiply(_q.setFromAxisAngle(X, head.yaw * 0.65)).multiply(_q.setFromAxisAngle(Z, pitch * 0.6));
    restFace(m);
  }
  m.updateMatrixWorld(true);
  const pelvis = b("Pelvis").getWorldPosition(new Vector3());
  m.position.x -= pelvis.x;
  m.position.y += PELVIS_Y - pelvis.y;
  m.position.z -= pelvis.z;
  m.updateMatrixWorld(true);
  return m;
}

const _head = new Vector3();
const _to = new Vector3();
const _frame = new Quaternion();
const STAGE_EYES = new Vector3(AUCTIONEER.x, AUCTIONEER.y + 1.7, AUCTIONEER.z);

/**
 * Brings a seated person to life: they breathe, blink, watch the auctioneer,
 * glance at the screen, their notes or a neighbour, and turn to `focus` (a
 * table that has just bid) when there is one. `seed` (0..1) keeps a room of
 * them out of step.
 */
export function useSeatedLife(model: Object3D, seed: number, focus: Vector3 | null): void {
  const rig = useMemo(() => {
    const spine = bone(model, "Bip01_Spine1");
    const neck = bone(model, "Bip01_Neck");
    const head = bone(model, "Bip01_Head");
    return {
      spine, neck, head,
      spineRest: spine.quaternion.clone(), neckRest: neck.quaternion.clone(), headRest: head.quaternion.clone(),
      face: faceOf(model, seed),
      lean: (model.userData.lean as number | undefined) ?? 0,
      yaw: 0, pitch: 0, mode: "stage" as "stage" | "screen" | "notes" | "side", sideYaw: 0, until: seed * 4,
    };
  }, [model, seed]);
  const look = useRef(focus);
  look.current = focus;

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const r = rig;
    if (t > r.until) {
      const pick = Math.random();
      r.mode = pick < 0.55 ? "stage" : pick < 0.75 ? "screen" : pick < 0.88 ? "notes" : "side";
      r.sideYaw = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.4);
      r.until = t + 2.5 + Math.random() * 5;
    }
    let yaw = r.sideYaw;
    let pitch = 0.05;
    const target = look.current ?? (r.mode === "stage" ? STAGE_EYES : r.mode === "screen" ? SCREEN.center : null);
    if (target) {
      // The direction to the target in this person's own frame (they face +z, left is +x).
      r.head.getWorldPosition(_head);
      _to.copy(target).sub(_head);
      if (look.current) _to.y += 1.25; // a table's centre is on the floor: look at its owners
      model.parent!.getWorldQuaternion(_frame).invert();
      _to.applyQuaternion(_frame);
      yaw = Math.atan2(_to.x, _to.z);
      pitch = -Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
      // A table behind or beside them: no owl necks, they keep watching the stage.
      if (Math.abs(yaw) > 1.25) { yaw = 0; pitch = -0.08; }
    } else if (r.mode === "notes") {
      yaw = r.sideYaw * 0.15;
      pitch = 0.5;
    }
    yaw = Math.max(-1, Math.min(1, yaw)) + Math.sin(t * 0.7 + seed * 40) * 0.03;
    pitch = Math.max(-0.45, Math.min(0.55, pitch));
    const k = 1 - Math.exp(-dt * (look.current ? 5 : 2.6));
    r.yaw += (yaw - r.yaw) * k;
    r.pitch += (pitch - r.pitch) * k;

    const breath = Math.sin(t * 1.5 + seed * 30) * 0.012;
    const nod = r.pitch - r.lean; // level the head against the lean of the back
    r.spine.quaternion.copy(r.spineRest).multiply(_q.setFromAxisAngle(Z, breath));
    r.neck.quaternion.copy(r.neckRest).multiply(_q.setFromAxisAngle(X, r.yaw * 0.35)).multiply(_q.setFromAxisAngle(Z, nod * 0.4));
    r.head.quaternion.copy(r.headRest).multiply(_q.setFromAxisAngle(X, r.yaw * 0.65)).multiply(_q.setFromAxisAngle(Z, nod * 0.6));
    animateFace(r.face, t, 0);
  });
}

/** A plain chair: pedestal, seat and a low back. Seat centred under the thighs. */
export function Chair({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, SEAT_Y - 0.03, 0.12]} castShadow receiveShadow>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
        <meshStandardMaterial color="#1a1730" roughness={0.6} />
      </mesh>
      <mesh position={[0, SEAT_Y + 0.25, -0.16]} castShadow receiveShadow>
        <boxGeometry args={[0.48, 0.48, 0.05]} />
        <meshStandardMaterial color="#1a1730" roughness={0.6} />
      </mesh>
      <mesh position={[0, SEAT_Y / 2, 0.08]}>
        <cylinderGeometry args={[0.03, 0.03, SEAT_Y - 0.06, 10]} />
        <meshStandardMaterial color="#3a3650" metalness={0.6} roughness={0.35} />
      </mesh>
    </group>
  );
}

const _s = new Vector3();
const _g = new Vector3();
const _u = new Vector3();
const _p = new Vector3();
const _e = new Vector3();
const _dir = new Vector3();

/**
 * Keeps an owner's left hand on the paddle handle (`grip`), wherever the
 * paddle is: a two-bone arm solve with the elbow dropping down and out.
 */
export function usePaddleHold(model: Object3D, grip: RefObject<Object3D | null>): void {
  const arm = useMemo(() => {
    const upper = bone(model, "Bip01_L_UpperArm");
    const fore = bone(model, "Bip01_L_Forearm");
    const hand = bone(model, "Bip01_L_Hand");
    model.updateMatrixWorld(true);
    const a = upper.getWorldPosition(new Vector3()).distanceTo(fore.getWorldPosition(new Vector3()));
    const b = fore.getWorldPosition(new Vector3()).distanceTo(hand.getWorldPosition(new Vector3()));
    curl(model, "L", 0.8); // closes round the handle on top of the seated relax
    return { upper, fore, hand, a, b };
  }, [model]);

  useFrame(() => {
    const g = grip.current;
    if (!g) return;
    const { upper, fore, hand, a, b } = arm;
    upper.getWorldPosition(_s);
    g.getWorldPosition(_g);
    _u.copy(_g).sub(_s);
    const d = Math.min(Math.max(_u.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
    _u.normalize();
    // Pole: down and out to their left, so the elbow bends naturally.
    _p.set(1, 0, 0).applyQuaternion(model.getWorldQuaternion(_q)).multiplyScalar(0.6).add(_axis.set(0, -1, 0));
    _p.addScaledVector(_u, -_p.dot(_u)).normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    _e.copy(_s).addScaledVector(_u, x).addScaledVector(_p, h);
    aim(upper, fore, _dir.copy(_e).sub(_s), 1);
    aim(fore, hand, _dir.copy(_g).sub(fore.getWorldPosition(_e)), 1);
  });
}

/** Freezes a posed avatar into static geometry (one per skinned mesh), in the avatar's own space. */
function bake(posed: Object3D): { geometry: BufferGeometry; material: Material | Material[] }[] {
  posed.updateMatrixWorld(true);
  const out: { geometry: BufferGeometry; material: Material | Material[] }[] = [];
  const p = new Vector3();
  const q = new Vector3();
  posed.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const src = mesh.geometry;
    const pos = src.getAttribute("position");
    const nor = src.getAttribute("normal");
    const positions = new Float32Array(pos.count * 3);
    const normals = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      // A point a little way along the normal, skinned the same way, gives the posed normal.
      q.fromBufferAttribute(nor, i).multiplyScalar(0.5).add(p);
      mesh.applyBoneTransform(i, p).applyMatrix4(mesh.matrixWorld);
      mesh.applyBoneTransform(i, q).applyMatrix4(mesh.matrixWorld);
      positions.set([p.x, p.y, p.z], i * 3);
      q.sub(p).normalize();
      normals.set([q.x, q.y, q.z], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setAttribute("normal", new BufferAttribute(normals, 3));
    for (const name of ["uv", "tangent"]) {
      const attr = src.getAttribute(name);
      if (attr) g.setAttribute(name, attr);
    }
    if (src.index) g.setIndex(src.index);
    for (const grp of src.groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
    g.computeBoundingSphere();
    out.push({ geometry: g, material: mesh.material });
  });
  return out;
}

export interface CrowdSeat {
  position: Vector3;
  /** Rotation about y; 0 faces +z. */
  yaw: number;
}

/** How the audience sits: a few poses, each with its own turn of the head. */
const CROWD_POSES: Sitting[] = [
  { hands: "lap", lean: 0.05, head: { yaw: 0, pitch: -0.04 } },
  { hands: "thighs", lean: 0.16, head: { yaw: 0.22, pitch: 0 } },
  { hands: "lap", lean: -0.04, lapSide: null, head: { yaw: -0.28, pitch: -0.06 } },
];

/**
 * The audience: every seat filled by one of the avatars in one of a few
 * poses, frozen into instanced meshes. Each person gets their own height and
 * a slightly different shade, so the repeats don't read as clones.
 */
export function CrowdPeople({ people, seats }: { people: Object3D[]; seats: CrowdSeat[] }) {
  const meshes = useMemo(() => {
    const result: InstancedMesh[] = [];
    const m = new Matrix4();
    const rot = new Quaternion();
    const scale = new Vector3();
    const shade = new Color();
    const kinds = people.length * CROWD_POSES.length;
    // A cheap hash keeps neighbours different without any visible pattern.
    const hash = (i: number, salt: number) => {
      const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    people.forEach((src, variant) => CROWD_POSES.forEach((pose, p) => {
      const kind = variant * CROWD_POSES.length + p;
      const mine = seats.map((seat, i) => ({ seat, i })).filter(({ i }) => Math.floor(hash(i, 1) * kinds) === kind);
      if (!mine.length) return;
      for (const part of bake(seated(src, pose))) {
        const inst = new InstancedMesh(part.geometry, part.material, mine.length);
        mine.forEach(({ seat, i }, n) => {
          rot.setFromEuler(new Euler(0, seat.yaw + (hash(i, 2) - 0.5) * 0.3, 0));
          const size = 0.95 + hash(i, 3) * 0.09;
          inst.setMatrixAt(n, m.compose(seat.position, rot, scale.set(size, size, size)));
          inst.setColorAt(n, shade.setScalar(0.72 + hash(i, 4) * 0.28));
        });
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.receiveShadow = true;
        result.push(inst);
      }
    }));
    return result;
  }, [people, seats]);
  useEffect(() => () => meshes.forEach((mesh) => { mesh.geometry.dispose(); mesh.dispose(); }), [meshes]);
  return <group>{meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}</group>;
}
