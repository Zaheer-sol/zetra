"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, SRGBColorSpace, type Group } from "three";

type CoinPalette = { face: string; faceEdge: string; ink: string; metal: string };

function useCoinFace(mark: string, name: string, palette: CoinPalette) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const gradient = ctx.createRadialGradient(184, 148, 24, 256, 256, 260);
    gradient.addColorStop(0, palette.faceEdge);
    gradient.addColorStop(0.48, palette.face);
    gradient.addColorStop(1, palette.faceEdge);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(256, 256, 213, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(5,18,31,0.18)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(256, 256, 191, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = palette.ink;
    ctx.shadowColor = "rgba(5,18,31,0.22)";
    ctx.shadowBlur = 8;
    ctx.font = `700 ${mark.length > 1 ? 126 : 176}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(mark, 256, 225);
    ctx.shadowBlur = 0;
    ctx.font = "700 44px ui-sans-serif, system-ui, sans-serif";
    ctx.letterSpacing = "8px";
    ctx.fillText(name, 260, 355);

    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    result.anisotropy = 8;
    return result;
  }, [mark, name, palette.face, palette.faceEdge, palette.ink]);

  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

function Coin({ mark, name, palette, size = 1, thickness = 0.24 }: { mark: string; name: string; palette: CoinPalette; size?: number; thickness?: number }) {
  const face = useCoinFace(mark, name, palette);
  return (
    <group scale={size}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, thickness, 96, 2]} />
        <meshPhysicalMaterial color={palette.metal} metalness={0.88} roughness={0.24} clearcoat={0.76} clearcoatRoughness={0.16} />
      </mesh>
      <mesh position={[0, 0, thickness / 2 + 0.008]}>
        <circleGeometry args={[0.9, 96]} />
        <meshPhysicalMaterial map={face ?? undefined} color={face ? "#ffffff" : palette.face} metalness={0.42} roughness={0.23} clearcoat={1} clearcoatRoughness={0.12} />
      </mesh>
      <mesh position={[0, 0, thickness / 2 + 0.019]}>
        <torusGeometry args={[0.934, 0.025, 16, 96]} />
        <meshPhysicalMaterial color="#e9f2f7" metalness={0.95} roughness={0.17} clearcoat={1} />
      </mesh>
      <mesh position={[0, 0, -thickness / 2 - 0.008]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[0.9, 96]} />
        <meshPhysicalMaterial map={face ?? undefined} color={face ? "#ffffff" : palette.face} metalness={0.42} roughness={0.23} clearcoat={1} clearcoatRoughness={0.12} />
      </mesh>
    </group>
  );
}

function SettlementScene({ animate }: { animate: boolean }) {
  const orbit = useRef<Group>(null);
  const usdc = useRef<Group>(null);
  const near = useRef<Group>(null);

  useFrame(({ clock }, delta) => {
    if (!animate) return;
    if (orbit.current) orbit.current.rotation.y += delta * 0.2;
    if (usdc.current) {
      usdc.current.rotation.y += delta * 0.3;
      usdc.current.rotation.x = -0.12 + Math.sin(clock.elapsedTime * 0.72) * 0.035;
    }
    if (near.current) {
      near.current.rotation.y -= delta * 0.42;
      near.current.position.y = 0.82 + Math.sin(clock.elapsedTime * 1.05) * 0.07;
    }
  });

  return (
    <group rotation={[-0.04, -0.14, 0]}>
      <group ref={orbit}>
        <mesh rotation={[0.78, 0.12, -0.3]}>
          <torusGeometry args={[1.62, 0.026, 12, 140]} />
          <meshPhysicalMaterial color="#4ba7ff" emissive="#087cff" emissiveIntensity={0.5} metalness={0.45} roughness={0.22} transparent opacity={0.86} />
        </mesh>
        <mesh rotation={[1.14, -0.36, 0.38]}>
          <torusGeometry args={[1.88, 0.017, 10, 140]} />
          <meshBasicMaterial color="#6cf5dd" transparent opacity={0.72} />
        </mesh>
        <mesh position={[-1.43, -0.72, 0.18]}>
          <sphereGeometry args={[0.065, 20, 20]} />
          <meshPhysicalMaterial color="#d8fff6" emissive="#15d3ba" emissiveIntensity={0.65} metalness={0.55} roughness={0.18} />
        </mesh>
      </group>

      <group ref={usdc} rotation={[-0.12, -0.36, 0.05]}>
        <Coin mark="$" name="USDC" palette={{ face: "#2378d8", faceEdge: "#64bbff", ink: "#ffffff", metal: "#b9d8e8" }} size={1.12} thickness={0.3} />
      </group>
      <group ref={near} position={[1.36, 0.82, 0.72]} rotation={[0.18, 0.5, -0.16]}>
        <Coin mark="N" name="NEAR" palette={{ face: "#101820", faceEdge: "#3e555f", ink: "#e9fff8", metal: "#dce9e9" }} size={0.43} thickness={0.22} />
      </group>

      <mesh position={[-1.27, 0.86, -0.16]} rotation={[0.46, 0.2, 0.32]}>
        <octahedronGeometry args={[0.13, 0]} />
        <meshPhysicalMaterial color="#c6fff1" emissive="#11bda5" emissiveIntensity={0.48} metalness={0.62} roughness={0.18} clearcoat={1} />
      </mesh>
    </group>
  );
}

export default function HeroThreeCanvas() {
  const reduceMotion = useReducedMotion();
  return (
    <Canvas aria-hidden="true" camera={{ position: [0, 0, 7], fov: 35 }} dpr={[1, 1.6]} frameloop={reduceMotion ? "demand" : "always"} gl={{ alpha: true, antialias: true, powerPreference: "low-power" }} fallback={<div className="size-full rounded-full border border-primary/10" />}>
      <ambientLight intensity={1.18} />
      <directionalLight position={[-3.5, 4.5, 5]} intensity={3.4} color="#ffffff" castShadow />
      <pointLight position={[3.2, 1.7, 3]} intensity={15} color="#78d9ff" />
      <pointLight position={[-3, -1.6, 1]} intensity={10} color="#24e2c4" />
      <SettlementScene animate={!reduceMotion} />
    </Canvas>
  );
}
