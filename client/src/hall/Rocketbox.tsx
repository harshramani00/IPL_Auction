// The default auctioneer: "Business_Male_01" from Microsoft's Rocketbox
// avatar library (MIT licence, static/models/rocketbox/). It has no clips for
// an auctioneer, so its arm bones are posed procedurally: each frame the upper
// arm and forearm are aimed at target directions, which works whatever the
// rig's local axes are.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  Box3, CanvasTexture, CylinderGeometry, DoubleSide, Group, LatheGeometry, LoadingManager, Matrix4, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, RepeatWrapping, Vector2,
  SRGBColorSpace, Texture, TextureLoader, Vector3, type Bone, type Light, type Material, type Object3D,
  type SkinnedMesh,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { Pose } from "./Auctioneer";
import { GAVEL_BLOCK } from "./layout";

const DIR = "/models/rocketbox/";
const HEIGHT = 1.82;

export interface AvatarSource {
  /** Folder with the .fbx and its web textures (body_color.jpg, head_color.jpg, ...). */
  dir: string;
  file: string;
  /** Standing height in metres. */
  height: number;
  /** Physical materials with sheen for close-ups; plain PBR is cheaper for crowds. */
  physical?: boolean;
}

/** Loads a Rocketbox FBX and gives it proper PBR materials from our web textures. */
export async function loadAvatar({ dir, file, height, physical = false }: AvatarSource): Promise<Object3D> {
  const manager = new LoadingManager();
  // The FBX names .tga textures we don't ship; hand back blanks instead of 404s.
  manager.addHandler(/\.tga$/i, {
    load: () => new Texture(),
    setPath() { return this; },
    setCrossOrigin() { return this; },
    setResourcePath() { return this; },
  } as unknown as TextureLoader);
  const obj = await new FBXLoader(manager).loadAsync(dir + file);
  // Each file carries a grey ambient light from its 3ds Max scene; the hall does its own lighting.
  const lights: Object3D[] = [];
  obj.traverse((o) => { if ((o as Light).isLight) lights.push(o); });
  for (const l of lights) l.removeFromParent();

  const tex = new TextureLoader();
  const load = (name: string, color = false) => {
    const t = tex.load(dir + name);
    if (color) t.colorSpace = SRGBColorSpace;
    t.anisotropy = physical ? 8 : 4;
    return t;
  };
  // Wool suit: a soft sheen at grazing angles, like real fabric.
  const body = physical
    ? new MeshPhysicalMaterial({
      name: "body", map: load("body_color.jpg", true), normalMap: load("body_normal.jpg"),
      roughness: 0.8, metalness: 0, sheen: 0.25, sheenRoughness: 0.7, sheenColor: "#8a8aa0",
    })
    : new MeshStandardMaterial({
      name: "body", map: load("body_color.jpg", true), normalMap: load("body_normal.jpg"), roughness: 0.8,
    });
  // Skin and painted hair share this material, so no sheen here: a skin-toned
  // sheen lights up the hair's edges and gives every head a pink halo.
  const head = new MeshStandardMaterial({
    name: "head", map: load("head_color.jpg", true), normalMap: load("head_normal.jpg"), roughness: 0.62,
  });
  // Hair edges and eyelashes: alpha-tested cards.
  const opacity = new MeshStandardMaterial({
    name: "opacity", map: load("opacity.png", true), alphaTest: 0.45, transparent: false,
    roughness: 0.6, side: DoubleSide,
  });
  let glasses: MeshStandardMaterial | null = null;
  obj.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds don't follow posed limbs
    const swap = (m: Material) => {
      if (/glasses/i.test(m.name)) {
        glasses ??= new MeshStandardMaterial({
          name: "glasses", map: load("glasses.png", true), transparent: true, depthWrite: false, roughness: 0.2,
        });
        return glasses;
      }
      return /head/i.test(m.name) ? head : /opacity/i.test(m.name) ? opacity : body;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });

  // Centimetres to metres, feet on the floor.
  const size = new Box3().setFromObject(obj).getSize(new Vector3());
  obj.scale.setScalar(height / size.y);
  obj.updateMatrixWorld(true);
  obj.position.y -= new Box3().setFromObject(obj).min.y;
  return obj;
}

/** The auctioneer. */
export const loadRocketbox = () => loadAvatar({ dir: DIR, file: "Business_Male_01.fbx", height: HEIGHT, physical: true });

export function bone(root: Object3D, name: string): Bone {
  const b = root.getObjectByName(name) as Bone | undefined;
  if (!b) throw new Error(`Rocketbox rig is missing ${name}`);
  return b;
}

const _from = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _delta = new Quaternion();
const _world = new Quaternion();
const _parent = new Quaternion();

/** Rotate `b` so the direction from it to `child` points along `dir` (world space), easing by `alpha`. */
export function aim(b: Bone, child: Object3D, dir: Vector3, alpha: number): void {
  b.updateWorldMatrix(true, true);
  _from.copy(child.getWorldPosition(_a)).sub(b.getWorldPosition(_b)).normalize();
  _delta.setFromUnitVectors(_from, _a.copy(dir).normalize());
  b.getWorldQuaternion(_world);
  b.parent!.getWorldQuaternion(_parent).invert();
  const target = _parent.multiply(_delta.multiply(_world));
  b.quaternion.slerp(target, alpha);
}

/**
 * The face bones every Rocketbox head has. Head-space axes: x runs up the
 * head and y out through the face. Eyelids slide down along x and forward
 * along y (over the eyeball, not through it); the jaw opens about +z.
 */
export interface Face {
  jaw: Bone | null;
  jawRest: Quaternion;
  lids: { bone: Bone; rest: Vector3; top: boolean }[];
  /** 0..1, different per person so a room never blinks in step. */
  seed: number;
}

export function faceOf(model: Object3D, seed: number): Face {
  const get = (name: string) => (model.getObjectByName(`Bip01_${name}`) as Bone | undefined) ?? null;
  const jaw = get("MJaw");
  const lids: Face["lids"] = [];
  for (const [name, top] of [["LEyeBlinkTop", true], ["REyeBlinkTop", true], ["LEyeBlinkBottom", false], ["REyeBlinkBottom", false]] as const) {
    const b = get(name);
    if (b) lids.push({ bone: b, rest: b.position.clone(), top });
  }
  return { jaw, jawRest: jaw ? jaw.quaternion.clone() : new Quaternion(), lids, seed };
}

/** How far the lids close: the rig rests wide-eyed, so "open" sits a little lower. */
const LID_RELAXED = 0.28;

function setLids(face: Face, shut: number): void {
  for (const lid of face.lids) {
    if (lid.top) {
      lid.bone.position.x = lid.rest.x - 1.12 * shut;
      lid.bone.position.y = lid.rest.y + 0.42 * shut;
    } else {
      lid.bone.position.x = lid.rest.x + 0.28 * shut;
    }
  }
}

/** Blinks every few seconds and opens the jaw by `open` (0 shut, 1 wide: speech stays under ~0.5). */
export function animateFace(face: Face, t: number, open: number): void {
  const period = 2.6 + face.seed * 3.4;
  const phase = (t + face.seed * 11) % period;
  const blink = phase < 0.15 ? Math.sin((phase / 0.15) * Math.PI) : 0;
  setLids(face, LID_RELAXED + (1 - LID_RELAXED) * blink);
  face.jaw?.quaternion.copy(face.jawRest).multiply(_delta.setFromAxisAngle(_a.set(0, 0, 1), open * 0.32));
}

/** A still face with relaxed eyes, for people who are never animated. */
export function restFace(model: Object3D): void {
  setLids(faceOf(model, 0), LID_RELAXED);
}

/**
 * An arm that holds something: shoulder to wrist by two-bone IK, with the
 * fist wrapped round a handle. Hand-space axes on this rig: x runs out along
 * the fingers, the palm faces -y, and z runs across the knuckles (towards the
 * index finger on a right hand, the little finger on a left).
 */
export interface Grip {
  upper: Bone; fore: Bone; hand: Bone;
  upperRest: Quaternion; foreRest: Quaternion; handRest: Quaternion;
  /** Bone lengths in metres. */
  a: number; b: number;
  /** +1 for a right hand, -1 for a left. */
  side: number;
  /** Rig units per metre (the avatars are modelled in centimetres). */
  units: number;
}

/** A handle doesn't cross the palm square: it lies diagonally, tipped towards the fingers. */
const GRIP_TILT = 0.44;
const GRIP_S = Math.sin(GRIP_TILT);
const GRIP_C = Math.cos(GRIP_TILT);
/** The middle of a closed fist, from the wrist, in centimetres (z flips for a left hand). */
const FIST = new Vector3(8, -1.5, -1);

/** Captures the arm as it is now; `holdAt` solves from this pose every frame. */
export function makeGrip(model: Object3D, side: "L" | "R"): Grip {
  const upper = bone(model, `Bip01_${side}_UpperArm`);
  const fore = bone(model, `Bip01_${side}_Forearm`);
  const hand = bone(model, `Bip01_${side}_Hand`);
  model.updateMatrixWorld(true);
  const p = [upper, fore, hand].map((x) => x.getWorldPosition(new Vector3()));
  return {
    upper, fore, hand,
    upperRest: upper.quaternion.clone(), foreRest: fore.quaternion.clone(), handRest: hand.quaternion.clone(),
    a: p[0]!.distanceTo(p[1]!), b: p[1]!.distanceTo(p[2]!),
    side: side === "R" ? 1 : -1,
    units: 1 / hand.getWorldScale(new Vector3()).x,
  };
}

/** How a held object sits in the hand: its +y runs up the handle from the fist. */
export function seatInHand(object: Object3D, grip: Grip): void {
  object.scale.setScalar(grip.units);
  object.position.set(FIST.x, FIST.y, FIST.z * grip.side);
  // Object y -> hand z (across the knuckles), then tipped towards the fingers.
  object.quaternion.setFromAxisAngle(_a.set(0, 1, 0), GRIP_TILT * grip.side)
    .multiply(_delta.setFromAxisAngle(_b.set(1, 0, 0), (Math.PI / 2) * grip.side));
  grip.hand.add(object);
}

const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _perp = new Vector3();
const _wrist = new Vector3();
const _elbow = new Vector3();
const _shoulder = new Vector3();
const _pole = new Vector3();
const _basis = new Matrix4();
const _handQ = new Quaternion();
const _foreQ = new Quaternion();
const _twist = new Quaternion();
const _identity = new Quaternion();

/**
 * Puts the fist at `point` with the handle running along `axis` (towards the
 * index-finger side) and the palm facing `palm`, bending the elbow towards
 * `pole`. All in world space. The forearm takes most of the roll, like a real
 * one, so the wrist only has to bend.
 */
export function holdAt(g: Grip, point: Vector3, axis: Vector3, palm: Vector3, pole: Vector3): void {
  // The hand's world orientation: palm = -y, handle = the tipped knuckle line in the x-z plane.
  _z.copy(axis).normalize();
  _y.copy(palm).multiplyScalar(-1).addScaledVector(_z, palm.dot(_z)).normalize();
  _perp.crossVectors(_y, _z);
  const cs = GRIP_C * g.side;
  _x.copy(_z).multiplyScalar(GRIP_S).addScaledVector(_perp, cs);
  _z.multiplyScalar(cs).addScaledVector(_perp, -GRIP_S);
  _handQ.setFromRotationMatrix(_basis.makeBasis(_x, _y, _z));

  // Wrist: back from the fist's centre.
  _wrist.set(FIST.x, FIST.y, FIST.z * g.side).divideScalar(g.units).applyQuaternion(_handQ).multiplyScalar(-1).add(point);

  // Shoulder to wrist with the elbow on the pole side.
  g.upper.quaternion.copy(g.upperRest);
  g.fore.quaternion.copy(g.foreRest);
  g.upper.updateWorldMatrix(true, true);
  g.upper.getWorldPosition(_shoulder);
  _b.copy(_wrist).sub(_shoulder);
  const d = Math.min(Math.max(_b.length(), Math.abs(g.a - g.b) + 1e-3), g.a + g.b - 1e-3);
  _b.normalize();
  _pole.copy(pole).addScaledVector(_b, -pole.dot(_b)).normalize();
  const along = (g.a * g.a - g.b * g.b + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, g.a * g.a - along * along));
  _elbow.copy(_shoulder).addScaledVector(_b, along).addScaledVector(_pole, out);
  aim(g.upper, g.fore, _pole.copy(_elbow).sub(_shoulder), 1);
  aim(g.fore, g.hand, _pole.copy(_wrist).sub(g.fore.getWorldPosition(_elbow)), 1);

  // Roll the forearm towards the hand's twist about its own length...
  g.fore.updateWorldMatrix(true, false);
  g.fore.getWorldQuaternion(_foreQ);
  _b.copy(_wrist).sub(_elbow).normalize();
  _twist.copy(_foreQ).multiply(g.handRest).invert().premultiply(_handQ); // hand target relative to its rest
  const proj = _twist.x * _b.x + _twist.y * _b.y + _twist.z * _b.z;
  _twist.set(_b.x * proj, _b.y * proj, _b.z * proj, _twist.w).normalize();
  _twist.slerp(_identity, 0.3);
  _foreQ.premultiply(_twist);
  g.fore.parent!.getWorldQuaternion(_parent).invert();
  g.fore.quaternion.copy(_parent.multiply(_foreQ));
  // ...and the wrist takes what's left.
  g.hand.quaternion.copy(_foreQ.invert().multiply(_handQ));
}

/** Varnished wood with a little grain along the length of a turned piece. */
let woodMaterial: MeshPhysicalMaterial | null = null;
export function wood(): MeshPhysicalMaterial {
  if (woodMaterial) return woodMaterial;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#7b4a27";
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 256;
    c.strokeStyle = Math.random() < 0.6 ? `rgba(48, 24, 10, ${0.08 + Math.random() * 0.22})` : `rgba(190, 130, 80, ${0.06 + Math.random() * 0.12})`;
    c.lineWidth = 0.6 + Math.random() * 2.2;
    c.beginPath();
    c.moveTo(x, 0);
    c.bezierCurveTo(x + (Math.random() - 0.5) * 14, 85, x + (Math.random() - 0.5) * 14, 170, x + (Math.random() - 0.5) * 8, 256);
    c.stroke();
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  woodMaterial = new MeshPhysicalMaterial({ map, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.22 });
  return woodMaterial;
}

const turned = (profile: [radius: number, y: number][], segments = 28) =>
  new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);

/** Where the gavel's head sits up the handle from the fist, and how thick it is. */
export const GAVEL_REACH = 0.17;
export const GAVEL_HEAD_RADIUS = 0.032;

/** A turned wooden gavel. Origin in the fist, handle up +y, the head's two faces along x. */
function gavel(): Group {
  const g = new Group();
  const handle = new Mesh(turned([
    [0, -0.1], [0.012, -0.1], [0.0152, -0.092], [0.0152, -0.08], [0.011, -0.068], [0.0125, -0.03],
    [0.0135, 0], [0.012, 0.04], [0.0095, 0.09], [0.009, 0.135], [0.011, 0.142], [0, 0.142],
  ]), wood());
  const head = new Mesh(turned([
    [0, -0.058], [0.024, -0.058], [0.028, -0.054], [0.028, -0.04], [0.0255, -0.036], [0.0255, -0.032],
    [0.031, -0.02], [GAVEL_HEAD_RADIUS, 0], [0.031, 0.02], [0.0255, 0.032], [0.0255, 0.036], [0.028, 0.04],
    [0.028, 0.054], [0.024, 0.058], [0, 0.058],
  ], 36), wood());
  head.rotation.z = Math.PI / 2;
  head.position.y = GAVEL_REACH;
  const band = new Mesh(
    new CylinderGeometry(GAVEL_HEAD_RADIUS + 0.0008, GAVEL_HEAD_RADIUS + 0.0008, 0.012, 36),
    new MeshStandardMaterial({ color: "#d9b25a", metalness: 0.9, roughness: 0.25 }),
  );
  band.rotation.z = Math.PI / 2;
  band.position.y = GAVEL_REACH;
  for (const m of [handle, head, band]) m.castShadow = true;
  g.add(handle, head, band);
  return g;
}

/** The sound block's shape: a turned disc, 4 cm tall. */
export const soundBlockGeometry = () => turned([
  [0, 0], [0.086, 0], [0.09, 0.006], [0.09, 0.024], [0.083, 0.034], [0.06, SOUND_BLOCK_HEIGHT], [0, SOUND_BLOCK_HEIGHT],
], 40);
export const SOUND_BLOCK_HEIGHT = 0.04;

interface Props {
  model: Object3D;
  pose: Pose;
  strikeKey: number;
  pointAt: Vector3 | null;
}

/**
 * The gavel's height through a SOLD: up, down hard, a short bounce, a second
 * rap, and settle. Seconds since the call -> 0 (on the block) .. 1 (cocked).
 * The two impacts (0.2 s and 0.4 s) are where the sound puts its two knocks.
 */
export const STRIKE_AT = [0.2, 0.4] as const;
function strikeLift(s: number): number {
  if (s < 0.11) return 1;
  if (s < 0.2) return 1 - ((s - 0.11) / 0.09) ** 2;
  if (s < 0.31) return 0.42 * Math.sin(((s - 0.2) / 0.11) * (Math.PI / 2));
  if (s < 0.4) return 0.42 * (1 - ((s - 0.31) / 0.09) ** 2);
  if (s < 0.54) return 0.07 * Math.sin(((s - 0.4) / 0.14) * Math.PI);
  return 0;
}

export function RocketboxAuctioneer({ model, pose, strikeKey, pointAt }: Props) {
  const rig = useMemo(() => {
    const r = {
      root: model,
      rUpper: bone(model, "Bip01_R_UpperArm"), rFore: bone(model, "Bip01_R_Forearm"), rHand: bone(model, "Bip01_R_Hand"),
      lUpper: bone(model, "Bip01_L_UpperArm"), lFore: bone(model, "Bip01_L_Forearm"), lHand: bone(model, "Bip01_L_Hand"),
      head: bone(model, "Bip01_Head"),
      headRest: new Quaternion(),
      face: faceOf(model, 0.37),
      gavel: gavel(),
      grip: makeGrip(model, "R"),
    };
    r.headRest.copy(r.head.quaternion);
    // The rig rests with flat open hands. Biped finger bones run along +x and
    // bend about +z: close the right hand round the gavel, relax the left.
    const curl = (side: "R" | "L", angle: number) => {
      for (const finger of [1, 2, 3, 4]) {
        for (const joint of ["", "1", "2"]) {
          const b = model.getObjectByName(`Bip01_${side}_Finger${finger}${joint}`);
          b?.quaternion.multiply(_delta.setFromAxisAngle(_a.set(0, 0, 1), angle));
        }
      }
    };
    curl("R", 1.25);
    curl("L", 0.5);
    // The thumb wraps over the fingers.
    for (const joint of ["", "1", "2"]) {
      model.getObjectByName(`Bip01_R_Finger0${joint}`)?.quaternion.multiply(_delta.setFromAxisAngle(_a.set(0, 0, 1), 0.35));
    }
    seatInHand(r.gavel, r.grip);
    if (import.meta.env.DEV) (window as unknown as { __rig: unknown }).__rig = r;
    return r;
  }, [model]);

  const strikeAt = useRef(-10);
  const lastStrike = useRef(strikeKey);
  if (strikeKey !== lastStrike.current) {
    lastStrike.current = strikeKey;
    strikeAt.current = performance.now() / 1000;
  }
  const dirs = useMemo(() => ({ lu: new Vector3(), lf: new Vector3(), tmp: new Vector3() }), []);
  const hammer = useRef({
    lift: 0, head: new Vector3(), axis: new Vector3(), fist: new Vector3(),
    palm: new Vector3(1, 0, 0), // faces in towards his chest
    pole: new Vector3(-0.75, -1, -0.3), // elbow down and out to his right
  });
  // When the pose last changed (he speaks for a moment at each), and his smoothed head turn and mouth.
  const voice = useRef({ pose, at: -10, yaw: 0, open: 0 });
  if (voice.current.pose !== pose) {
    voice.current.pose = pose;
    voice.current.at = performance.now() / 1000;
  }

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const since = performance.now() / 1000 - strikeAt.current;
    const { lu, lf } = dirs;
    // He faces +z; his right side is -x. The left arm rests, gestures and points.
    lu.set(0.22, -1, 0.42); lf.set(0.05, -0.12, 1);
    let left = 6;
    if (pose === "talk") {
      const s = Math.sin(t * 3.1);
      lu.set(0.6, -0.55 + s * 0.12, 0.62);
      lf.set(0.35, 0.3 + s * 0.2, 1);
    } else if (pose === "point" && pointAt) {
      const shoulder = rig.lUpper.getWorldPosition(dirs.tmp);
      lu.copy(pointAt).setY(pointAt.y + 1.1).sub(shoulder).normalize();
      lu.y = Math.max(lu.y, -0.35);
      lf.copy(lu);
      left = 10;
    }
    const kl = 1 - Math.exp(-dt * left);
    aim(rig.lUpper, rig.lFore, lu, kl);
    aim(rig.lFore, rig.lHand, lf, kl);

    // The right hand holds the gavel. `lift` is how far the head is off the
    // block: 0 resting on it, 1 cocked back beside his ear.
    const h = hammer.current;
    let lift = 0;
    let speed = 9;
    if (pose === "raise") {
      lift = 0.82 + Math.sin(t * 2.3) * 0.02;
    } else if (pose === "strike" && since < 0.6) {
      lift = strikeLift(since);
      speed = 70;
    }
    h.lift += (lift - h.lift) * (1 - Math.exp(-dt * speed));
    // The head swings on an arc from the block up and back; the handle leads with the wrist cocked.
    const u = h.lift;
    const ease = u * u * (3 - 2 * u);
    h.head.copy(GAVEL_BLOCK).setY(GAVEL_BLOCK.y + GAVEL_HEAD_RADIUS + 0.002);
    h.head.x -= 0.1 * ease;
    h.head.y += 0.62 * ease + 0.06 * Math.sin(u * Math.PI);
    h.head.z -= 0.2 * ease + 0.1 * Math.sin(u * Math.PI);
    // Handle: sloping down to the block at rest, upright and tipped back when raised.
    const tip = -0.36 + 2.05 * Math.pow(u, 0.85); // radians from "forward", towards "up and back"
    h.axis.set(0.06 * ease, Math.sin(tip), Math.cos(tip));
    h.fist.copy(h.head).addScaledVector(h.axis, -GAVEL_REACH);
    holdAt(rig.grip, h.fist, h.axis, h.palm, h.pole);

    // Head: nods while talking, turns to the table he's pointing at, a slight tilt otherwise.
    const v = voice.current;
    const nod = pose === "talk" ? Math.sin(t * 5) * 0.05 : Math.sin(t * 1.2) * 0.015;
    let yaw = Math.sin(t * 0.31) * 0.12; // idly scanning the room
    if (pose === "point" && pointAt) {
      const head = rig.head.getWorldPosition(dirs.tmp);
      yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(pointAt.x - head.x, pointAt.z - head.z)));
    }
    v.yaw += (yaw - v.yaw) * (1 - Math.exp(-dt * 6));
    rig.head.quaternion.copy(rig.headRest)
      .multiply(_delta.setFromAxisAngle(_a.set(1, 0, 0), v.yaw * 0.8))
      .multiply(_delta.setFromAxisAngle(_a.set(0, 0, 1), nod));

    // Mouth: he speaks through an announcement, and for a moment at each call.
    const sincePose = performance.now() / 1000 - v.at;
    const speaking = pose === "talk" || ((pose === "point" || pose === "raise" || pose === "strike") && sincePose < 1.5);
    const syllable = (0.5 + 0.5 * Math.sin(t * 13)) * (0.45 + 0.55 * Math.abs(Math.sin(t * 4.1 + 1)));
    v.open += ((speaking ? syllable * 0.5 : 0) - v.open) * (1 - Math.exp(-dt * 22));
    animateFace(rig.face, t, v.open);
  });

  return <primitive object={model} />;
}
