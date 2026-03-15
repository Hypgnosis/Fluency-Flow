import React, { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Float } from '@react-three/drei';
import * as THREE from 'three';

// ─── GLOSSOS Color Palette ───
const COLORS = {
  terminalGreen: new THREE.Color('#00FF41'),
  sacredAmber: new THREE.Color('#FFBF00'),
  vellumWhite: new THREE.Color('#F5F5F7'),
  error: new THREE.Color('#f43f5e'),
  idle: new THREE.Color('#FFBF00'),
};

type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

interface OrbProps {
  connectionState: ConnectionState;
  volume: number;
}

// Reusable vectors to avoid allocating inside useFrame
const _targetScale = new THREE.Vector3();
const _targetColor = new THREE.Color();

// ─── Inner Core: An icosahedron with premium physical material ───
function CoreOrb({ connectionState, volume }: OrbProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null!);
  const [hovered, setHover] = useState(false);

  useFrame((state) => {
    if (!meshRef.current) return;

    // Smooth scale on hover + volume reactivity
    const baseScale = connectionState === 'CONNECTED' ? 1.0 + volume * 0.35 : 1.0;
    const s = hovered ? baseScale * 1.15 : baseScale;
    _targetScale.set(s, s, s);
    meshRef.current.scale.lerp(_targetScale, 0.08);

    // Gentle rotation
    meshRef.current.rotation.y += 0.004;
    meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.1;

    // Smooth color transition
    if (matRef.current) {
      if (connectionState === 'CONNECTED') {
        _targetColor.copy(COLORS.terminalGreen);
      } else if (connectionState === 'CONNECTING') {
        _targetColor.copy(COLORS.sacredAmber);
      } else if (connectionState === 'ERROR') {
        _targetColor.copy(COLORS.error);
      } else {
        _targetColor.copy(COLORS.sacredAmber);
      }
      matRef.current.color.lerp(_targetColor, 0.04);
      matRef.current.emissive.lerp(_targetColor, 0.03);
    }
  });

  return (
    <mesh
      ref={meshRef}
      onPointerOver={() => { setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
    >
      <icosahedronGeometry args={[1.3, 1]} />
      <meshPhysicalMaterial
        ref={matRef}
        color="#FFBF00"
        emissive="#FFBF00"
        emissiveIntensity={0.15}
        roughness={0.18}
        metalness={0.4}
        clearcoat={1}
        clearcoatRoughness={0.05}
        transparent
        opacity={0.88}
      />
    </mesh>
  );
}

// ─── Wireframe version of the same shape ───
function WireframeShell({ connectionState, volume }: OrbProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y -= 0.002;
    meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.2) * 0.05;
    const pulse = connectionState === 'CONNECTED'
      ? 1.6 + volume * 0.2
      : 1.6 + Math.sin(state.clock.elapsedTime * 0.8) * 0.03;
    meshRef.current.scale.setScalar(pulse);
  });

  return (
    <mesh ref={meshRef}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial
        color={connectionState === 'CONNECTED' ? '#00FF41' : '#FFBF00'}
        wireframe
        transparent
        opacity={0.12}
      />
    </mesh>
  );
}

// ─── Orbital Ring ───
function OrbitalRing({ connectionState, volume }: OrbProps) {
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame((state, delta) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.x += delta * 0.2;
    ringRef.current.rotation.z += delta * 0.08;
    const pulse = connectionState === 'CONNECTED'
      ? 1 + volume * 0.12
      : 1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.02;
    ringRef.current.scale.setScalar(pulse);
  });

  const color = connectionState === 'CONNECTED' ? '#00FF41' : '#FFBF00';

  return (
    <mesh ref={ringRef}>
      <torusGeometry args={[1.9, 0.012, 16, 100]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={connectionState === 'CONNECTED' ? 0.5 + volume * 0.5 : 0.3}
      />
    </mesh>
  );
}

// ─── Second Ring (perpendicular) ───
function OrbitalRing2() {
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame((_, delta) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.y += delta * 0.12;
  });

  return (
    <mesh ref={ringRef} rotation={[Math.PI / 2.5, 0, 0]}>
      <torusGeometry args={[2.2, 0.006, 16, 100]} />
      <meshBasicMaterial color="#F5F5F7" transparent opacity={0.1} />
    </mesh>
  );
}

// ─── Orbiting particles ───
function Particles({ connectionState, volume }: OrbProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const count = 5;

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.25;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const r = 2.5;
        return (
          <mesh key={i} position={[Math.cos(angle) * r, Math.sin(angle * 0.5) * 0.3, Math.sin(angle) * r]}>
            <sphereGeometry args={[0.04, 8, 8]} />
            <meshBasicMaterial
              color={i % 2 === 0 ? '#00FF41' : '#FFBF00'}
              transparent
              opacity={connectionState === 'CONNECTED' ? 0.6 + volume * 0.4 : 0.45}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Connecting spinner arc ───
function Spinner() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.z = state.clock.elapsedTime * 3;
  });
  return (
    <mesh ref={ref}>
      <torusGeometry args={[2.6, 0.02, 8, 32, Math.PI * 1.5]} />
      <meshBasicMaterial color="#FFBF00" transparent opacity={0.7} />
    </mesh>
  );
}

// ─── Main Scene ───
function Scene({ connectionState, volume }: OrbProps) {
  return (
    <>
      {/* Simple lighting — no Environment preset needed */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.4} color="#FFBF00" />
      <directionalLight position={[-4, -2, -3]} intensity={0.2} color="#00FF41" />
      <pointLight position={[0, 3, 2]} intensity={0.3} color="#fff" />

      <Float
        speed={connectionState === 'CONNECTING' ? 3 : 1.5}
        rotationIntensity={0.3}
        floatIntensity={connectionState === 'CONNECTED' ? 0.4 : 1}
      >
        <CoreOrb connectionState={connectionState} volume={volume} />
        <WireframeShell connectionState={connectionState} volume={volume} />
        <OrbitalRing connectionState={connectionState} volume={volume} />
        <OrbitalRing2 />
        <Particles connectionState={connectionState} volume={volume} />
        {connectionState === 'CONNECTING' && <Spinner />}
      </Float>

      <ContactShadows
        position={[0, -2.5, 0]}
        opacity={0.35}
        scale={10}
        blur={3}
        far={4}
        color={connectionState === 'CONNECTED' ? '#00FF41' : '#FFBF00'}
      />
    </>
  );
}

// ─── Public Component ───
export default function GlossosOrb({ connectionState = 'IDLE', volume = 0 }: Partial<OrbProps>) {
  return (
    <div className="glossos-orb-container">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
        style={{ background: 'transparent' }}
      >
        <Scene connectionState={connectionState} volume={volume} />
      </Canvas>
    </div>
  );
}
