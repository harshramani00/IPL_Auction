// Realistic people for the hall: team owners seated at the tables and the
// audience behind them. Six Rocketbox business avatars (MIT,
// static/models/rocketbox/people/) are cloned and sat down by aiming their
// leg and arm bones. The owner beside each paddle holds it, with their arm
// solved every frame; the audience is posed once and frozen into instanced
// static meshes, so a full house costs a handful of draw calls.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  BufferAttribute, BufferGeometry, Euler, InstancedMesh, Matrix4, Quaternion, Vector3,
  type Material, type Object3D, type SkinnedMesh,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { aim, bone, loadAvatar } from "./Rocketbox";

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

export type Hands = "table" | "lap";

/**
 * A clone of `src` sitting on a chair, facing +z, with the pelvis over the
 * origin. "table": forearms resting forward on a table; "lap": hands in the lap.
 */
export function seated(src: Object3D, hands: Hands): Object3D {
  const m = cloneSkinned(src);
  m.updateMatrixWorld(true);
  const b = (name: string) => bone(m, `Bip01_${name}`);
  // Lean in a little over the table; sit back in the audience.
  aim(b("Spine"), b("Neck"), hands === "table" ? v(0, 1, 0.22) : v(0, 1, 0.06), 1);
  // Their left is +x.
  for (const [side, sx] of [["L", 1], ["R", -1]] as const) {
    aim(b(`${side}_Thigh`), b(`${side}_Calf`), v(sx * 0.12, -0.06, 1), 1);
    aim(b(`${side}_Calf`), b(`${side}_Foot`), v(sx * 0.02, -1, 0.14), 1);
    if (hands === "table") {
      aim(b(`${side}_UpperArm`), b(`${side}_Forearm`), v(sx * 0.14, -0.78, 0.6), 1);
      aim(b(`${side}_Forearm`), b(`${side}_Hand`), v(-sx * 0.3, -0.06, 1), 1);
    } else {
      aim(b(`${side}_UpperArm`), b(`${side}_Forearm`), v(sx * 0.06, -1, 0.22), 1);
      aim(b(`${side}_Forearm`), b(`${side}_Hand`), v(-sx * 0.22, -0.5, 1), 1);
    }
    curl(m, side, 0.45);
  }
  m.updateMatrixWorld(true);
  const pelvis = b("Pelvis").getWorldPosition(new Vector3());
  m.position.x -= pelvis.x;
  m.position.y += PELVIS_Y - pelvis.y;
  m.position.z -= pelvis.z;
  m.updateMatrixWorld(true);
  return m;
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

/** The audience: every seat filled by one of the six avatars, frozen in a seated pose. */
export function CrowdPeople({ people, seats }: { people: Object3D[]; seats: CrowdSeat[] }) {
  const meshes = useMemo(() => {
    const result: InstancedMesh[] = [];
    const m = new Matrix4();
    const rot = new Quaternion();
    const one = new Vector3(1, 1, 1);
    people.forEach((src, variant) => {
      const mine = seats.filter((_, i) => (i * 7 + Math.floor(i / 5)) % people.length === variant);
      if (!mine.length) return;
      for (const part of bake(seated(src, "lap"))) {
        const inst = new InstancedMesh(part.geometry, part.material, mine.length);
        mine.forEach((seat, i) => {
          rot.setFromEuler(new Euler(0, seat.yaw, 0));
          inst.setMatrixAt(i, m.compose(seat.position, rot, one));
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.receiveShadow = true;
        result.push(inst);
      }
    });
    return result;
  }, [people, seats]);
  useEffect(() => () => meshes.forEach((mesh) => { mesh.geometry.dispose(); mesh.dispose(); }), [meshes]);
  return <group>{meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}</group>;
}

