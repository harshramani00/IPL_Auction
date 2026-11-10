// The default auctioneer: "Business_Male_01" from Microsoft's Rocketbox
// avatar library (MIT licence, static/models/rocketbox/). It has no clips for
// an auctioneer, so its arm bones are posed procedurally: each frame the upper
// arm and forearm are aimed at target directions, which works whatever the
// rig's local axes are.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  Box3, CylinderGeometry, DoubleSide, Group, LoadingManager, Mesh, MeshPhysicalMaterial,
  MeshStandardMaterial, Quaternion,
  SRGBColorSpace, Texture, TextureLoader, Vector3, type Bone, type Material, type Object3D,
  type SkinnedMesh,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { Pose } from "./Auctioneer";

const DIR = "/models/rocketbox/";
const HEIGHT = 1.82;

/** Loads the FBX and gives it proper PBR materials from our web textures. */
export async function loadRocketbox(): Promise<Object3D> {
  const manager = new LoadingManager();
  // The FBX names .tga textures we don't ship; hand back blanks instead of 404s.
  manager.addHandler(/\.tga$/i, {
    load: () => new Texture(),
    setPath() { return this; },
    setCrossOrigin() { return this; },
    setResourcePath() { return this; },
  } as unknown as TextureLoader);
  const obj = await new FBXLoader(manager).loadAsync(`${DIR}Business_Male_01.fbx`);

  const tex = new TextureLoader();
  const load = (file: string, color = false) => {
    const t = tex.load(DIR + file);
    if (color) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  // Wool suit: a soft sheen at grazing angles, like real fabric.
  const body = new MeshPhysicalMaterial({
    name: "body", map: load("body_color.jpg", true), normalMap: load("body_normal.jpg"),
    roughness: 0.8, metalness: 0, sheen: 0.45, sheenRoughness: 0.7, sheenColor: "#8a8aa0",
  });
  // Skin: a warm sheen fakes the light that scatters under real skin, so it doesn't look plastic.
  const head = new MeshPhysicalMaterial({
    name: "head", map: load("head_color.jpg", true), normalMap: load("head_normal.jpg"),
    roughness: 0.5, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: "#ffb39a",
  });
  // Hair edges and eyelashes: alpha-tested cards.
  const opacity = new MeshStandardMaterial({
    name: "opacity", map: load("opacity.png", true), alphaTest: 0.45, transparent: false,
    roughness: 0.6, side: DoubleSide,
  });
  obj.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds don't follow posed arms
    const swap = (m: Material) => (/head/i.test(m.name) ? head : /opacity/i.test(m.name) ? opacity : body);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });

  // Centimetres to metres, feet on the stage.
  const size = new Box3().setFromObject(obj).getSize(new Vector3());
  obj.scale.setScalar(HEIGHT / size.y);
  obj.updateMatrixWorld(true);
  obj.position.y -= new Box3().setFromObject(obj).min.y;
  return obj;
}

function bone(root: Object3D, name: string): Bone {
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
function aim(b: Bone, child: Object3D, dir: Vector3, alpha: number): void {
  b.updateWorldMatrix(true, true);
  _from.copy(child.getWorldPosition(_a)).sub(b.getWorldPosition(_b)).normalize();
  _delta.setFromUnitVectors(_from, _a.copy(dir).normalize());
  b.getWorldQuaternion(_world);
  b.parent!.getWorldQuaternion(_parent).invert();
  const target = _parent.multiply(_delta.multiply(_world));
  b.quaternion.slerp(target, alpha);
}

/** A gavel to put in his right hand. */
function gavel(): Group {
  const g = new Group();
  const wood = new MeshStandardMaterial({ color: "#4a2e17", roughness: 0.4 });
  const handle = new Mesh(new CylinderGeometry(0.011, 0.013, 0.27, 12), wood);
  handle.position.y = 0.06;
  const head = new Mesh(new CylinderGeometry(0.034, 0.034, 0.12, 24), wood);
  head.rotation.z = Math.PI / 2;
  head.position.y = 0.19;
  const band = new Mesh(new CylinderGeometry(0.036, 0.036, 0.02, 24), new MeshStandardMaterial({ color: "#c9a86a", metalness: 0.8, roughness: 0.3 }));
  band.rotation.z = Math.PI / 2;
  band.position.y = 0.19;
  g.add(handle, head, band);
  return g;
}

interface Props {
  model: Object3D;
  pose: Pose;
  strikeKey: number;
  pointAt: Vector3 | null;
}

export function RocketboxAuctioneer({ model, pose, strikeKey, pointAt }: Props) {
  const rig = useMemo(() => {
    const r = {
      root: model,
      rUpper: bone(model, "Bip01_R_UpperArm"), rFore: bone(model, "Bip01_R_Forearm"), rHand: bone(model, "Bip01_R_Hand"),
      lUpper: bone(model, "Bip01_L_UpperArm"), lFore: bone(model, "Bip01_L_Forearm"), lHand: bone(model, "Bip01_L_Hand"),
      head: bone(model, "Bip01_Head"),
      headRest: new Quaternion(),
      gavel: gavel(),
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
    curl("R", 1.2);
    curl("L", 0.5);
    // Gavel in metres (undoing the model's centimetre scale), handle across
    // the palm through the fist, head out past the thumb.
    r.gavel.scale.setScalar(1 / model.scale.x);
    r.gavel.position.set(8, -1.5, -3);
    r.gavel.rotation.set(Math.PI / 2, 0, 0);
    r.rHand.add(r.gavel);
    if (import.meta.env.DEV) (window as unknown as { __rig: unknown }).__rig = r;
    return r;
  }, [model]);

  const strikeAt = useRef(-10);
  const lastStrike = useRef(strikeKey);
  if (strikeKey !== lastStrike.current) {
    lastStrike.current = strikeKey;
    strikeAt.current = performance.now() / 1000;
  }
  const dirs = useMemo(() => ({ ru: new Vector3(), rf: new Vector3(), lu: new Vector3(), lf: new Vector3(), tmp: new Vector3() }), []);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const since = performance.now() / 1000 - strikeAt.current;
    const { ru, rf, lu, lf } = dirs;
    // He faces +z; his right side is -x.
    ru.set(-0.22, -1, 0.42); rf.set(-0.05, -0.12, 1);
    lu.set(0.22, -1, 0.42); lf.set(0.05, -0.12, 1);
    let speed = 7;

    if (pose === "talk") {
      const s = Math.sin(t * 3.1);
      lu.set(0.6, -0.55 + s * 0.12, 0.62);
      lf.set(0.35, 0.3 + s * 0.2, 1);
    } else if (pose === "point" && pointAt) {
      const shoulder = rig.rUpper.getWorldPosition(dirs.tmp);
      ru.copy(pointAt).setY(pointAt.y + 1.1).sub(shoulder).normalize();
      ru.y = Math.max(ru.y, -0.35);
      rf.copy(ru);
      speed = 10;
    } else if (pose === "raise") {
      ru.set(-0.4, 0.75, 0.45);
      rf.set(-0.05, 0.85, 0.5);
      speed = 8;
    } else if (pose === "strike") {
      if (since < 0.14) {
        ru.set(-0.4, 0.8, 0.45); rf.set(-0.05, 0.9, 0.45);
        speed = 30;
      } else {
        ru.set(-0.3, -0.45, 0.85); rf.set(-0.08, -0.9, 0.45);
        speed = since < 0.35 ? 40 : 8;
      }
    }

    const k = 1 - Math.exp(-dt * speed);
    const kl = 1 - Math.exp(-dt * 6);
    aim(rig.rUpper, rig.rFore, ru, k);
    aim(rig.rFore, rig.rHand, rf, k);
    aim(rig.lUpper, rig.lFore, lu, kl);
    aim(rig.lFore, rig.lHand, lf, kl);

    // Small head motion: nods while talking, a slight tilt otherwise.
    const nod = pose === "talk" ? Math.sin(t * 5) * 0.05 : Math.sin(t * 1.2) * 0.015;
    rig.head.quaternion.copy(rig.headRest).multiply(_delta.setFromAxisAngle(_a.set(0, 0, 1), nod));
  });

  return <primitive object={model} />;
}
