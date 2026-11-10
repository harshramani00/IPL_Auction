// The hall itself: floor, back wall, stage, podium, LED screen and crowd.
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, DoubleSide, Matrix4, Object3D, Vector3, type CanvasTexture, type InstancedMesh } from "three";
import { renderQuality } from "./Effects";
import { PODIUM, SCREEN, STAGE } from "./layout";
import { CrowdPeople, SEAT_Y, usePeople, type CrowdSeat } from "./People";
import { imageTexture } from "./textures";

const CROWD = 140;

export function Room({ screen }: { screen: CanvasTexture }) {
  const ipl = imageTexture("/logos/IPL.png");
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#120f33" roughness={0.82} metalness={0.05} />
      </mesh>

      <mesh position={[0, 5, -7.3]} receiveShadow>
        <planeGeometry args={[40, 10]} />
        <meshStandardMaterial color="#17134a" roughness={0.9} />
      </mesh>
      {/* Vertical LED strips on the back wall */}
      {[-9, -6.2, 6.2, 9].map((x) => (
        <mesh key={x} position={[x, 3.5, -7.25]}>
          <boxGeometry args={[0.08, 6, 0.04]} />
          <meshStandardMaterial color="#f3c34f" emissive="#f3c34f" emissiveIntensity={1.4} />
        </mesh>
      ))}

      <mesh position={[0, STAGE.height / 2, STAGE.z]} receiveShadow castShadow>
        <cylinderGeometry args={[STAGE.radius, STAGE.radius + 0.1, STAGE.height, 72]} />
        <meshStandardMaterial color="#221d5c" roughness={0.55} metalness={0.15} />
      </mesh>
      <mesh position={[0, STAGE.height + 0.005, STAGE.z]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[STAGE.radius - 0.08, STAGE.radius, 96]} />
        <meshStandardMaterial color="#f3c34f" emissive="#f3c34f" emissiveIntensity={0.9} side={DoubleSide} />
      </mesh>

      {/* LED screen. The frame sits fully behind the picture: if its front face
          shares the picture's depth the two flicker against each other (z-fighting). */}
      <mesh position={[SCREEN.center.x, SCREEN.center.y, SCREEN.center.z - 0.08]}>
        <boxGeometry args={[SCREEN.width + 0.3, SCREEN.height + 0.3, 0.12]} />
        <meshStandardMaterial color="#07061a" roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={SCREEN.center}>
        <planeGeometry args={[SCREEN.width, SCREEN.height]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>

      {/* Podium */}
      <group position={PODIUM}>
        <mesh position={[0, 0.575, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 1.15, 0.7]} />
          <meshStandardMaterial color="#241f5c" roughness={0.45} metalness={0.25} />
        </mesh>
        <mesh position={[0, 1.18, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.56, 0.07, 0.82]} />
          <meshStandardMaterial color="#3b2414" roughness={0.5} />
        </mesh>
        <mesh position={[0, 1.142, 0.412]}>
          <boxGeometry args={[1.56, 0.012, 0.012]} />
          <meshStandardMaterial color="#f3c34f" emissive="#f3c34f" emissiveIntensity={0.6} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.66, 0.352]}>
          <planeGeometry args={[0.66, 0.42]} />
          <meshStandardMaterial color="#ffffff" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.66, 0.354]}>
          <planeGeometry args={[0.58, 0.36]} />
          <meshStandardMaterial map={ipl} transparent roughness={0.6} />
        </mesh>
        {/* Sound block for the gavel */}
        <mesh position={[0.48, 1.235, 0.1]} castShadow>
          <cylinderGeometry args={[0.09, 0.1, 0.04, 32]} />
          <meshStandardMaterial color="#2a1a0e" roughness={0.4} />
        </mesh>
      </group>

      {/* Lighting truss */}
      <mesh position={[0, 7.2, -2.5]}>
        <boxGeometry args={[16, 0.16, 0.16]} />
        <meshStandardMaterial color="#2a2660" metalness={0.6} roughness={0.4} />
      </mesh>

      <Crowd />
    </group>
  );
}

/** Audience seats: four tiered rows behind the tables, each turned towards the stage. */
function crowdSeats(rows: number): CrowdSeat[] {
  const seats: CrowdSeat[] = [];
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < 35 && seats.length < CROWD; i++) {
      const x = -13 + i * 0.76 + (row % 2) * 0.38;
      const z = 5.6 + row * 1.15;
      seats.push({ position: new Vector3(x, TIER * row, z), yaw: Math.atan2(-x, STAGE.z - z) });
    }
  }
  return seats;
}

/** Seated audience behind the tables: real people once loaded, dark stand-ins until then. */
function Crowd() {
  const people = usePeople();
  // Phones and modest machines get the front two rows.
  const seats = useMemo(() => crowdSeats(renderQuality() === "high" ? 4 : 2), []);
  return (
    <group>
      {seats.length > 0 && <Risers rows={Math.round(seats[seats.length - 1]!.position.y / TIER) + 1} />}
      <CrowdChairs seats={seats} />
      {people ? <CrowdPeople people={people} seats={seats} /> : <CrowdStandIns seats={seats} />}
    </group>
  );
}

const TIER = 0.2;

/** Stepped platforms under the back rows. */
function Risers({ rows }: { rows: number }) {
  return (
    <group>
      {Array.from({ length: rows - 1 }, (_, i) => i + 1).map((row) => (
        <mesh key={row} position={[0, (TIER * row) / 2, 5.6 + row * 1.15]} receiveShadow>
          <boxGeometry args={[28, TIER * row, 1.15]} />
          <meshStandardMaterial color="#141130" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Seat and back for every audience place, instanced. */
function CrowdChairs({ seats }: { seats: CrowdSeat[] }) {
  const seat = useRef<InstancedMesh>(null);
  const back = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    seats.forEach((s, n) => {
      o.position.copy(s.position);
      o.rotation.set(0, s.yaw, 0);
      o.updateMatrix();
      seat.current!.setMatrixAt(n, o.matrix.clone().multiply(new Matrix4().makeTranslation(0, SEAT_Y - 0.03, 0.12)));
      back.current!.setMatrixAt(n, o.matrix.clone().multiply(new Matrix4().makeTranslation(0, SEAT_Y + 0.25, -0.16)));
    });
    seat.current!.instanceMatrix.needsUpdate = true;
    back.current!.instanceMatrix.needsUpdate = true;
  }, [seats]);
  return (
    <group>
      <instancedMesh ref={seat} args={[undefined, undefined, seats.length]} receiveShadow>
        <boxGeometry args={[0.5, 0.06, 0.5]} />
        <meshStandardMaterial color="#1a1730" roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={back} args={[undefined, undefined, seats.length]} receiveShadow>
        <boxGeometry args={[0.48, 0.48, 0.05]} />
        <meshStandardMaterial color="#1a1730" roughness={0.6} />
      </instancedMesh>
    </group>
  );
}

/** Dark seated figures while the real people load (one draw call each for bodies and heads). */
function CrowdStandIns({ seats }: { seats: CrowdSeat[] }) {
  const bodies = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    const m = new Matrix4();
    seats.forEach((s, n) => {
      o.position.copy(s.position).setY(s.position.y + 0.72);
      o.updateMatrix();
      bodies.current!.setMatrixAt(n, o.matrix);
      m.copy(o.matrix).multiply(new Matrix4().makeTranslation(0, 0.55, 0));
      heads.current!.setMatrixAt(n, m);
      const shade = new Color().setHSL(0.68, 0.35, 0.09 + (n % 4) * 0.012);
      bodies.current!.setColorAt(n, shade);
      heads.current!.setColorAt(n, shade);
    });
    for (const mesh of [bodies.current!, heads.current!]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [seats]);
  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, seats.length]}>
        <capsuleGeometry args={[0.22, 0.45, 4, 10]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, seats.length]}>
        <sphereGeometry args={[0.14, 16, 12]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
