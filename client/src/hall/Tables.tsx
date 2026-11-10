// The ten franchise tables, each with its owners and a paddle that shoots up
// when the team bids and stays raised while it leads.
import type { Snapshot } from "@auction/shared";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, MathUtils, type Group, type MeshStandardMaterial } from "three";
import { seatColor, seatName, team } from "../view";
import { TABLES, type TableSpot } from "./layout";
import { imageTexture, labelTexture } from "./textures";

export function Tables({ s }: { s: Snapshot }) {
  const lobby = s.phase === "lobby";
  return (
    <group>
      {TABLES.map((spot) => {
        const owner = s.owners[spot.id];
        const label = owner ? `P${owner} · ${seatName(s, owner)}` : lobby ? "Free" : "AI";
        const leading = !lobby && s.lead?.teamId === spot.id;
        return (
          <Table key={spot.id} spot={spot} label={label}
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
}

function Table({ spot, label, labelColor, leading, bump }: TableProps) {
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

  useFrame((state, dt) => {
    const g = paddle.current;
    if (!g) return;
    const now = performance.now() / 1000;
    const sinceBump = now - bumpAt.current;
    // A sharp jab up on each bid, then held high while leading.
    const jab = sinceBump < 0.5 ? Math.sin((sinceBump / 0.5) * Math.PI) * 0.25 : 0;
    const targetY = (leading ? 0.55 : 0) + jab;
    const k = 1 - Math.exp(-dt * 12);
    g.position.y = MathUtils.lerp(g.position.y, 1.02 + targetY, k);
    g.rotation.z = MathUtils.lerp(g.rotation.z, leading ? -0.18 : 0, k);
    if (disc.current) {
      const glow = leading ? 0.35 + Math.sin(state.clock.elapsedTime * 4) * 0.08 : 0;
      disc.current.emissiveIntensity = MathUtils.lerp(disc.current.emissiveIntensity, glow, k);
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
      {[-0.42, 0.38].map((x) => (
        <group key={x} position={[x, 0, -0.78]}>
          <mesh position={[0, 0.98, 0]} castShadow>
            <capsuleGeometry args={[0.19, 0.42, 4, 12]} />
            <meshStandardMaterial color="#25214a" roughness={0.8} />
          </mesh>
          <mesh position={[0, 1.47, 0]} castShadow>
            <sphereGeometry args={[0.125, 20, 16]} />
            <meshStandardMaterial color="#2e2a58" roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* Paddle, held by the owner on the right */}
      <group ref={paddle} position={[0.62, 1.02, -0.7]}>
        <mesh position={[0, 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.016, 0.016, 0.42, 10]} />
          <meshStandardMaterial color="#c9a86a" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.55, 0]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.18, 0.18, 0.025, 40]} />
          <meshStandardMaterial ref={disc} color={t.color} emissive={t.color} emissiveIntensity={0} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.55, 0.014]}>
          <circleGeometry args={[0.15, 40]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0.55, -0.014]} rotation-y={Math.PI}>
          <circleGeometry args={[0.15, 40]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0.55, 0.016]}>
          <planeGeometry args={[0.24, 0.24]} />
          <meshStandardMaterial map={logo} transparent side={DoubleSide} />
        </mesh>
        <mesh position={[0, 0.55, -0.016]} rotation-y={Math.PI}>
          <planeGeometry args={[0.24, 0.24]} />
          <meshStandardMaterial map={logo} transparent />
        </mesh>
      </group>
      {/* Owner tag floating above, facing the camera side */}
      <mesh position={[0, 2.15, -0.2]} rotation-y={Math.PI}>
        <planeGeometry args={[1, 0.25]} />
        <meshBasicMaterial map={tag} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
