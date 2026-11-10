// The 3D auction hall. Loaded on demand (it carries three.js), driven by the
// same auction moments as the sounds: a director turns each moment into a
// camera shot, an auctioneer pose, lighting and confetti.
import type { Snapshot, TeamId } from "@auction/shared";
import { gameData } from "@auction/shared/data";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ACESFilmicToneMapping, Color, DoubleSide, InstancedMesh, MathUtils, Object3D, PMREMGenerator,
  type PerspectiveCamera, type SpotLight, Vector3,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { lotsById, team } from "../view";
import type { AuctionEvent } from "../room/events";
import { useAuctionEvents } from "../room/useAuctionEvents";
import { Auctioneer, type Pose } from "./Auctioneer";
import { AUCTIONEER, SHOTS, tableOf, type Shot } from "./layout";
import { Room } from "./Room";
import { Tables } from "./Tables";
import { canvasTexture, drawScreen } from "./textures";

interface Props {
  s: Snapshot;
  mySeat: number | null;
  serverNow: () => number;
  reducedMotion: boolean;
}

type Mood = "normal" | "tense";

export default function Hall3D({ s, mySeat, serverNow, reducedMotion }: Props) {
  const shot = useRef<Shot & { cut: boolean }>({ ...SHOTS.wide(), cut: true });
  const [pose, setPose] = useState<Pose>("idle");
  const [strikeKey, setStrikeKey] = useState(0);
  const [pointAt, setPointAt] = useState<Vector3 | null>(null);
  const [mood, setMood] = useState<Mood>("normal");
  const [burst, setBurst] = useState<{ team: TeamId; key: number } | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const clearLater = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearLater, []);

  const go = (next: Shot, cut = false) => {
    shot.current = reducedMotion ? { ...SHOTS.wide(), cut: false } : { ...next, cut };
  };

  useAuctionEvents(s, mySeat, serverNow, (e: AuctionEvent) => {
    setCaption(e.line);
    switch (e.type) {
      case "start":
      case "lot":
        clearLater();
        setMood("normal");
        go(SHOTS.wide());
        setPose("talk");
        later(3200, () => setPose("idle"));
        break;
      case "bid":
        clearLater();
        setMood("normal");
        setPointAt(tableOf(e.teamId).position);
        setPose("point");
        go(SHOTS.table(e.teamId), true); // a hard cut, like a TV director
        later(1500, () => { setPose("idle"); go(SHOTS.wide()); });
        break;
      case "once":
        setPose("raise");
        break;
      case "twice":
        setPose("raise");
        setMood("tense");
        go(SHOTS.auctioneer());
        break;
      case "sold":
        clearLater();
        setMood("normal");
        setPose("strike");
        setStrikeKey((k) => k + 1);
        later(650, () => {
          go(SHOTS.winner(e.teamId));
          if (!reducedMotion) setBurst({ team: e.teamId, key: Date.now() });
        });
        later(1400, () => setPose("idle"));
        break;
      case "unsold":
        clearLater();
        setMood("normal");
        setPose("strike");
        setStrikeKey((k) => k + 1);
        go(SHOTS.wide());
        later(1200, () => setPose("idle"));
        break;
      case "pause":
        setPose("idle");
        break;
      case "resume":
      case "done":
        setMood("normal");
        go(SHOTS.wide());
        setPose(e.type === "done" ? "talk" : "idle");
        if (e.type === "done") later(3500, () => setPose("idle"));
        break;
    }
  });

  // Captions fade after a few seconds.
  useEffect(() => {
    if (!caption) return;
    const t = setTimeout(() => setCaption(null), 4200);
    return () => clearTimeout(t);
  }, [caption]);

  // The LED screen is a canvas texture redrawn whenever the lot or price changes.
  const lot = s.lot ?? (s.phase === "lobby" ? lotsById.get(gameData.presets[s.settings.preset].lots[0]!) ?? null : null);
  const screen = useMemo(() => canvasTexture(1280, 720, () => {}), []);
  useEffect(() => {
    const g = (screen.image as HTMLCanvasElement).getContext("2d")!;
    const redraw = () => {
      drawScreen(g, s, lot, redraw);
      screen.needsUpdate = true;
    };
    redraw();
  }, [screen, s, lot]);
  useEffect(() => () => screen.dispose(), [screen]);

  const lead = s.phase !== "lobby" ? s.lead?.teamId ?? null : null;

  return (
    <div className="hall">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        // near 0.3 m (nothing comes closer) keeps depth precision fine enough that thin layers don't flicker.
        camera={{ fov: 38, near: 0.3, far: 80, position: SHOTS.wide().position.toArray() }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#0a0920"]} />
        <fog attach="fog" args={["#0a0920", 16, 34]} />
        <Environment />
        <Lights mood={mood} lead={lead} />
        <Room screen={screen} />
        <Tables s={s} />
        <Auctioneer pose={pose} strikeKey={strikeKey} pointAt={pointAt} />
        {burst && <Confetti key={burst.key} team={burst.team} />}
        <CameraRig shot={shot} drift={!reducedMotion} />
      </Canvas>
      {caption && (
        <div className="hall-caption" aria-live="polite">
          <span>Auctioneer</span>
          {caption}
        </div>
      )}
    </div>
  );
}

/** Image-based lighting from three's procedural studio room: realistic reflections, nothing downloaded. */
function Environment() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.32;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Lights({ mood, lead }: { mood: Mood; lead: TeamId | null }) {
  const key = useRef<SpotLight>(null);
  const leadSpot = useRef<SpotLight>(null);
  const keyTarget = useMemo(() => {
    const o = new Object3D();
    o.position.set(AUCTIONEER.x, 1.6, AUCTIONEER.z);
    return o;
  }, []);
  const leadTarget = useMemo(() => new Object3D(), []);
  const warm = useMemo(() => new Color("#ffe2b0"), []);
  const hot = useMemo(() => new Color("#ff7a52"), []);

  useEffect(() => {
    key.current!.target = keyTarget;
    leadSpot.current!.target = leadTarget;
  }, [keyTarget, leadTarget]);

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 3);
    key.current!.color.lerp(mood === "tense" ? hot : warm, k);
    const spot = leadSpot.current!;
    if (lead) {
      const p = tableOf(lead).position;
      leadTarget.position.lerp(new Vector3(p.x, 0.9, p.z), 1 - Math.exp(-dt * 8));
      spot.position.set(leadTarget.position.x * 0.8, 7, leadTarget.position.z * 0.8 + 1);
      spot.color.lerp(new Color(team(lead).ring === "#111111" ? team(lead).color : "#ffe6a8"), k);
    }
    spot.intensity = MathUtils.lerp(spot.intensity, lead ? 160 : 0, k);
  });

  return (
    <>
      <primitive object={keyTarget} />
      <primitive object={leadTarget} />
      <hemisphereLight args={["#8f86ff", "#0a0920", 0.5]} />
      <directionalLight position={[-6, 9, 8]} intensity={0.55} color="#c9c4ff" castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12}
        shadow-camera-top={12} shadow-camera-bottom={-12} />
      <spotLight ref={key} position={[0.4, 7.8, 1.2]} angle={0.33} penumbra={0.55} intensity={260}
        castShadow shadow-mapSize={[1024, 1024]} />
      <spotLight ref={leadSpot} angle={0.28} penumbra={0.6} intensity={0} />
      {/* Glow off the LED screen and the gold stage ring */}
      <pointLight position={[0, 3.6, -5.6]} color="#7d70ff" intensity={14} distance={10} />
      <pointLight position={[0, 0.8, -1]} color="#f3c34f" intensity={4} distance={6} />
    </>
  );
}

/** Eases the camera towards the director's shot, or cuts straight to it. */
function CameraRig({ shot, drift }: { shot: React.MutableRefObject<Shot & { cut: boolean }>; drift: boolean }) {
  const camera = useThree((st) => st.camera) as PerspectiveCamera;
  const look = useRef(SHOTS.wide().target.clone());
  const offset = useMemo(() => new Vector3(), []);
  useFrame((state, dt) => {
    const sh = shot.current;
    if (sh.cut) {
      camera.position.copy(sh.position);
      look.current.copy(sh.target);
      sh.cut = false;
    } else {
      const k = 1 - Math.exp(-dt * 1.8);
      camera.position.lerp(sh.position, k);
      look.current.lerp(sh.target, k);
    }
    // A slow handheld drift keeps the room alive between moments.
    const t = state.clock.elapsedTime;
    offset.set(drift ? Math.sin(t * 0.21) * 0.12 : 0, drift ? Math.sin(t * 0.17) * 0.06 : 0, 0);
    camera.lookAt(look.current.clone().add(offset));
  });
  return null;
}

/** Confetti in the winning team's colours, bursting over their table. */
function Confetti({ team: winner }: { team: TeamId }) {
  const COUNT = 220;
  const mesh = useRef<InstancedMesh>(null);
  const born = useRef(performance.now() / 1000);
  const parts = useMemo(() => {
    const origin = tableOf(winner).position.clone().add(new Vector3(0, 3.2, 0));
    const colors = [team(winner).color, team(winner).ring, "#f3c34f", "#ffffff"].map((c) => new Color(c));
    return Array.from({ length: COUNT }, (_, i) => ({
      p: origin.clone().add(new Vector3((Math.random() - 0.5) * 1.5, Math.random() * 0.5, (Math.random() - 0.5) * 1.5)),
      v: new Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4),
      r: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: 4 + Math.random() * 8,
      color: colors[i % colors.length]!,
    }));
  }, [winner]);

  useLayoutEffect(() => {
    parts.forEach((pt, i) => mesh.current!.setColorAt(i, pt.color));
    if (mesh.current!.instanceColor) mesh.current!.instanceColor.needsUpdate = true;
  }, [parts]);

  const o = useMemo(() => new Object3D(), []);
  useFrame((_, dt) => {
    const age = performance.now() / 1000 - born.current;
    const m = mesh.current!;
    m.visible = age < 3.2;
    if (!m.visible) return;
    parts.forEach((pt, i) => {
      pt.v.y -= 4.5 * dt;
      pt.v.multiplyScalar(0.985);
      pt.p.addScaledVector(pt.v, dt);
      pt.r.x += pt.spin * dt;
      pt.r.y += pt.spin * 0.7 * dt;
      o.position.copy(pt.p);
      o.rotation.set(pt.r.x, pt.r.y, pt.r.z);
      o.scale.setScalar(age > 2.6 ? Math.max(0, 1 - (age - 2.6) / 0.6) : 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
      <planeGeometry args={[0.07, 0.035]} />
      <meshStandardMaterial side={DoubleSide} roughness={0.4} metalness={0.3} />
    </instancedMesh>
  );
}
