// Broadcast-style post-processing: ambient occlusion for contact shadows,
// bloom on the screen and lights, depth of field on close shots, a vignette,
// and filmic tone mapping. Lighter on phones and modest machines.
import { useThree } from "@react-three/fiber";
import {
  Bloom, DepthOfField, EffectComposer, N8AO, ToneMapping, Vignette,
} from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useLayoutEffect, useMemo } from "react";
import { NoToneMapping, type Vector3 } from "three";

export type Quality = "high" | "low" | "off";

/** "high" on capable desktops; "low" on phones, touch-first or few-core devices. localStorage "ar-quality" overrides. */
export function renderQuality(): Quality {
  try {
    const forced = localStorage.getItem("ar-quality");
    if (forced === "high" || forced === "low" || forced === "off") return forced;
  } catch { /* private mode */ }
  const coarse = matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  return coarse || cores <= 4 || innerWidth < 760 ? "low" : "high";
}

interface Props {
  /** What the camera is looking at; depth of field focuses here. */
  focus: Vector3;
  /** Blur strength: 0 on wide shots, a little on close ones. */
  bokeh: number;
}

export function Effects({ focus, bokeh }: Props) {
  const gl = useThree((s) => s.gl);
  const quality = useMemo(renderQuality, []);
  // The composer's ToneMapping effect replaces the renderer's own.
  useLayoutEffect(() => {
    const before = gl.toneMapping;
    gl.toneMapping = NoToneMapping;
    return () => { gl.toneMapping = before; };
  }, [gl]);

  if (quality === "off") return <EffectComposer><ToneMapping mode={ToneMappingMode.ACES_FILMIC} /></EffectComposer>;
  if (quality === "low") {
    return (
      <EffectComposer multisampling={0}>
        <Bloom luminanceThreshold={0.85} intensity={0.55} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={0.55} distanceFalloff={0.6} intensity={2.2} quality="medium" halfRes />
      {/* focusRange is in metres: the subject and a few metres around it stay sharp, the far room softens. */}
      <DepthOfField target={focus} focusRange={5} bokehScale={bokeh} height={480} />
      <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.65} mipmapBlur />
      <Vignette offset={0.28} darkness={0.55} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
