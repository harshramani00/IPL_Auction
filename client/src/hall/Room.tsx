// The hall itself: floor, back wall, stage, podium, LED screen and crowd.
import { useLayoutEffect, useRef } from "react";
import { Color, DoubleSide, Matrix4, Object3D, type CanvasTexture, type InstancedMesh } from "three";
import { PODIUM, SCREEN, STAGE } from "./layout";
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

/** Seated audience behind the tables, as dark silhouettes (one draw call). */
function Crowd() {
  const bodies = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    const m = new Matrix4();
    let n = 0;
    for (let row = 0; row < 4 && n < CROWD; row++) {
      for (let i = 0; i < 35 && n < CROWD; i++, n++) {
        const x = -13 + i * 0.76 + (row % 2) * 0.38;
        const z = 5.6 + row * 1.15;
        const y = 0.2 * row; // tiered seating
        o.position.set(x, 0.62 + y, z);
        o.scale.setScalar(0.9 + ((i * 7 + row * 3) % 5) * 0.04);
        o.updateMatrix();
        bodies.current!.setMatrixAt(n, o.matrix);
        m.copy(o.matrix).multiply(new Matrix4().makeTranslation(0, 0.55, 0));
        heads.current!.setMatrixAt(n, m);
        const shade = new Color().setHSL(0.68, 0.35, 0.09 + ((i + row) % 4) * 0.012);
        bodies.current!.setColorAt(n, shade);
        heads.current!.setColorAt(n, shade);
      }
    }
    for (const mesh of [bodies.current!, heads.current!]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, []);
  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, CROWD]}>
        <capsuleGeometry args={[0.22, 0.45, 4, 10]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, CROWD]}>
        <sphereGeometry args={[0.14, 16, 12]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
