// The auctioneer. If static/models/auctioneer.glb exists (a realistic rigged
// character with Mixamo clips), it is loaded and animated; until then a
// neutral stand-in mannequin acts out the same poses.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimationMixer, Box3, CylinderGeometry, Group as ThreeGroup, LoopOnce, MathUtils, Mesh,
  MeshStandardMaterial, Vector3,
  type AnimationAction, type Bone, type Group, type Object3D,
} from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AUCTIONEER } from "./layout";

export type Pose = "idle" | "talk" | "point" | "raise" | "strike";

interface Props {
  pose: Pose;
  /** Changes each time the gavel should come down, replaying the strike. */
  strikeKey: number;
  /** World position he points at (the bidding table). */
  pointAt: Vector3 | null;
}

const MODEL_URL = "/models/auctioneer.glb";
const HEIGHT = 1.82;

/** Mixamo clip names vary; match each pose loosely. */
const CLIP_PATTERNS: Record<Pose, RegExp> = {
  idle: /idle|stand/i,
  talk: /talk|speak|explain/i,
  point: /point/i,
  raise: /raise|hand ?up|salute|cheer/i,
  strike: /hammer|strike|pound|knock/i,
};

export function Auctioneer(props: Props) {
  const [model, setModel] = useState<GLTF | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A missing file comes back as the app's HTML page, so check the type first.
    fetch(MODEL_URL, { method: "HEAD" })
      .then((res) => {
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || type.includes("html")) return;
        new GLTFLoader().load(MODEL_URL, (gltf) => !cancelled && setModel(gltf), undefined, () => {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <group position={AUCTIONEER}>
      {model ? <ModelAuctioneer gltf={model} {...props} /> : <StandIn {...props} />}
    </group>
  );
}

// ---------------------------------------------------------------- real model

function findBone(root: Object3D, pattern: RegExp): Bone | null {
  let found: Bone | null = null;
  root.traverse((o) => {
    if (!found && (o as Bone).isBone && pattern.test(o.name)) found = o as Bone;
  });
  return found;
}

function ModelAuctioneer({ gltf, pose, strikeKey, pointAt }: Props & { gltf: GLTF }) {
  const root = useRef<Group>(null);
  const { scene, mixer, actions } = useMemo(() => {
    const scene = gltf.scene;
    scene.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    // Normalise height and stand him on the stage.
    const box = new Box3().setFromObject(scene);
    const size = box.getSize(new Vector3());
    scene.scale.setScalar(HEIGHT / Math.max(size.y, 0.01));
    const scaled = new Box3().setFromObject(scene);
    scene.position.y -= scaled.min.y;
    const mixer = new AnimationMixer(scene);
    const actions = {} as Partial<Record<Pose, AnimationAction>>;
    for (const [pose, pattern] of Object.entries(CLIP_PATTERNS) as [Pose, RegExp][]) {
      const clip = gltf.animations.find((c) => pattern.test(c.name));
      if (clip) actions[pose] = mixer.clipAction(clip);
    }
    if (actions.strike) {
      actions.strike.setLoop(LoopOnce, 1);
      actions.strike.clampWhenFinished = true;
    }
    // Put a gavel in his right hand.
    const hand = findBone(scene, /right_?hand$|righthand$/i);
    if (hand) hand.add(makeGavel(1 / scene.scale.x));
    return { scene, mixer, actions };
  }, [gltf]);

  const current = useRef<AnimationAction | null>(null);
  useEffect(() => {
    const next = actions[pose] ?? actions.idle;
    if (!next) return;
    if (pose === "strike") next.reset();
    if (next !== current.current) {
      next.reset().fadeIn(0.3).play();
      current.current?.fadeOut(0.3);
      current.current = next;
    }
  }, [pose, strikeKey, actions]);

  useFrame((_, dt) => {
    mixer.update(dt);
    // Turn a little towards the table he's pointing at.
    const g = root.current;
    if (!g) return;
    const yaw = pose === "point" && pointAt
      ? Math.atan2(pointAt.x - AUCTIONEER.x, pointAt.z - AUCTIONEER.z) * 0.6 : 0;
    g.rotation.y = MathUtils.lerp(g.rotation.y, yaw, 1 - Math.exp(-dt * 6));
  });

  return <group ref={root}><primitive object={scene} /></group>;
}

/** A gavel for the model's hand bone, sized in metres (undoing the model's scale). */
function makeGavel(scale: number): Group {
  const g = new ThreeGroup();
  const wood = new MeshStandardMaterial({ color: "#4a2e17", roughness: 0.45 });
  const handle = new Mesh(new CylinderGeometry(0.012, 0.014, 0.28, 12), wood);
  handle.position.y = 0.1;
  const head = new Mesh(new CylinderGeometry(0.035, 0.035, 0.12, 20), wood);
  head.rotation.z = Math.PI / 2;
  head.position.y = 0.24;
  g.add(handle, head);
  g.scale.setScalar(scale);
  return g;
}

// ------------------------------------------------------------------ stand-in

const SUIT = "#1b1a2e";
const SKIN = "#9a9fb0"; // neutral mannequin grey, so nobody mistakes it for the final character

function StandIn({ pose, strikeKey, pointAt }: Props) {
  const head = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const rShoulder = useRef<Group>(null);
  const rElbow = useRef<Group>(null);
  const lShoulder = useRef<Group>(null);
  const lElbow = useRef<Group>(null);
  const strikeAt = useRef(-10);

  useEffect(() => {
    if (pose === "strike") strikeAt.current = performance.now() / 1000;
  }, [pose, strikeKey]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const now = performance.now() / 1000;
    const ease = (speed: number) => 1 - Math.exp(-dt * speed);

    // Right arm: [shoulder pitch, shoulder yaw, elbow]
    let r: [number, number, number] = [-0.55, 0, -1.05];
    let l: [number, number, number] = [-0.5, 0, -1];
    let lRoll = 0;
    let nod = Math.sin(t * 1.3) * 0.02;
    let speed = 9;

    if (pose === "talk") {
      l = [-0.95 + Math.sin(t * 3.2) * 0.18, 0, -0.75];
      lRoll = 0.35;
      nod = Math.sin(t * 5) * 0.06;
    } else if (pose === "point") {
      const yaw = pointAt ? Math.atan2(pointAt.x - AUCTIONEER.x, pointAt.z - AUCTIONEER.z) : 0;
      r = [-1.45, MathUtils.clamp(yaw, -1.1, 1.1), -0.12];
    } else if (pose === "raise") {
      r = [-2.75, 0.15, -0.55];
      nod = -0.06;
    } else if (pose === "strike") {
      const since = now - strikeAt.current;
      if (since < 0.12) {
        r = [-2.85, 0.15, -0.5];
        speed = 30;
      } else {
        r = [-0.75, 0.1, -1.25];
        speed = since < 0.3 ? 40 : 9;
      }
    }

    const rs = rShoulder.current!;
    rs.rotation.x = MathUtils.lerp(rs.rotation.x, r[0], ease(speed));
    rs.rotation.y = MathUtils.lerp(rs.rotation.y, r[1], ease(speed));
    rElbow.current!.rotation.x = MathUtils.lerp(rElbow.current!.rotation.x, r[2], ease(speed));
    const ls = lShoulder.current!;
    ls.rotation.x = MathUtils.lerp(ls.rotation.x, l[0], ease(8));
    ls.rotation.z = MathUtils.lerp(ls.rotation.z, lRoll, ease(8));
    lElbow.current!.rotation.x = MathUtils.lerp(lElbow.current!.rotation.x, l[2], ease(8));
    head.current!.rotation.x = MathUtils.lerp(head.current!.rotation.x, nod, ease(6));
    head.current!.rotation.y = MathUtils.lerp(head.current!.rotation.y, pose === "point" ? r[1] * 0.5 : 0, ease(6));
    torso.current!.scale.y = 1 + Math.sin(t * 1.6) * 0.008; // breathing
  });

  return (
    <group>
      <group ref={torso}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.13, 1.1, 16]} />
          <meshStandardMaterial color={SUIT} roughness={0.7} />
        </mesh>
        <mesh position={[0, 1.42, 0]} castShadow>
          <capsuleGeometry args={[0.21, 0.42, 6, 16]} />
          <meshStandardMaterial color={SUIT} roughness={0.65} />
        </mesh>
        <mesh position={[0, 1.79, 0]} castShadow>
          <boxGeometry args={[0.56, 0.12, 0.26]} />
          <meshStandardMaterial color={SUIT} roughness={0.65} />
        </mesh>
        <mesh position={[0, 1.6, 0.2]}>
          <boxGeometry args={[0.12, 0.34, 0.02]} />
          <meshStandardMaterial color="#e9e6f2" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.58, 0.212]}>
          <boxGeometry args={[0.045, 0.3, 0.01]} />
          <meshStandardMaterial color="#7a1022" roughness={0.5} />
        </mesh>
        <mesh position={[0, 1.9, 0]}>
          <cylinderGeometry args={[0.055, 0.06, 0.1, 16]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
      </group>
      <group ref={head} position={[0, 1.95, 0]}>
        <mesh position={[0, 0.13, 0.01]} scale={[0.105, 0.13, 0.115]} castShadow>
          <sphereGeometry args={[1, 32, 24]} />
          <meshStandardMaterial color={SKIN} roughness={0.5} />
        </mesh>
      </group>
      <Arm side={1} shoulder={rShoulder} elbow={rElbow} gavel />
      <Arm side={-1} shoulder={lShoulder} elbow={lElbow} />
    </group>
  );
}

function Arm({ side, shoulder, elbow, gavel = false }: {
  side: 1 | -1;
  shoulder: React.RefObject<Group>;
  elbow: React.RefObject<Group>;
  gavel?: boolean;
}) {
  return (
    <group ref={shoulder} position={[0.27 * side, 1.78, 0]} rotation-order="YXZ">
      <mesh position={[0, -0.16, 0]} castShadow>
        <capsuleGeometry args={[0.058, 0.22, 4, 12]} />
        <meshStandardMaterial color={SUIT} roughness={0.65} />
      </mesh>
      <group ref={elbow} position={[0, -0.32, 0]}>
        <mesh position={[0, -0.14, 0]} castShadow>
          <capsuleGeometry args={[0.05, 0.2, 4, 12]} />
          <meshStandardMaterial color={SUIT} roughness={0.65} />
        </mesh>
        <mesh position={[0, -0.3, 0]} castShadow>
          <sphereGeometry args={[0.052, 16, 12]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
        {gavel && (
          <group position={[0, -0.31, 0.02]} rotation-x={Math.PI / 2}>
            <mesh position={[0, 0.1, 0]} castShadow>
              <cylinderGeometry args={[0.012, 0.014, 0.28, 12]} />
              <meshStandardMaterial color="#4a2e17" roughness={0.45} />
            </mesh>
            <mesh position={[0, 0.24, 0]} rotation-z={Math.PI / 2} castShadow>
              <cylinderGeometry args={[0.036, 0.036, 0.12, 20]} />
              <meshStandardMaterial color="#4a2e17" roughness={0.45} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}
