import React, { useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, ContactShadows, Float, MeshDistortMaterial, MeshTransmissionMaterial } from '@react-three/drei';
import * as THREE from 'three';

// ─── GLOSSOS Color Palette ───
const COLORS = {
  terminalGreen: '#00FF41',
  sacredAmber: '#FFBF00',
  vellumWhite: '#F5F5F7',
  idle: '#6366f1',        // Indigo for idle
  connecting: '#FFBF00',  // Amber for connecting
  connected: '#00FF41',   // Green for connected
  error: '#f43f5e',       // Rose for error
};

type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

interface OrbProps {
  connectionState: ConnectionState;
  volume: number;
}

// ─── Inner Core: A distorted glass sphere ───
function CoreOrb({ connectionState, volume }: OrbProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHover] = useState(false);
  const materialRef = useRef<any>(null);

  const targetColor = useMemo(() => {
    switch (connectionState) {
      case 'CONNECTING': return new THREE.Color(COLORS.connecting);
      case 'CONNECTED': return new THREE.Color(COLORS.connected);
      case 'ERROR': return new THREE.Color(COLORS.error);
      default: return new THREE.Color(COLORS.sacredAmber);
    }
  }, [connectionState]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;

    // Smooth scale on hover
    const baseScale = connectionState === 'CONNECTED' ? 1.0 + volume * 0.4 : 1.0;
    const targetScale = hovered ? baseScale * 1.15 : baseScale;
    meshRef.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, targetScale),
      0.08
    );

    // Gentle rotation
    meshRef.current.rotation.y += delta * 0.15;
    meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.1;

    // Smooth color transition
    if (materialRef.current && materialRef.current.color) {
      materialRef.current.color.lerp(targetColor, 0.05);
    }
  });

  const distortSpeed = connectionState === 'CONNECTED' ? 3 + volume * 8 : 
                        connectionState === 'CONNECTING' ? 4 : 2;
  const distortIntensity = connectionState === 'CONNECTED' ? 0.3 + volume * 0.5 : 
                           connectionState === 'CONNECTING' ? 0.35 : 0.2;

  return (
    <mesh
      ref={meshRef}
      onPointerOver={() => { setHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
    >
      <icosahedronGeometry args={[1.2, 8]} />
      <MeshDistortMaterial
        ref={materialRef}
        color={COLORS.sacredAmber}
        roughness={0.15}
        metalness={0.3}
        clearcoat={1}
        clearcoatRoughness={0.05}
        distort={distortIntensity}
        speed={distortSpeed}
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

// ─── Outer Wireframe Ring ───
function OrbitalRing({ connectionState, volume }: OrbProps) {
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame((state, delta) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.x += delta * 0.2;
    ringRef.current.rotation.z += delta * 0.08;

    const pulseScale = connectionState === 'CONNECTED' 
      ? 1 + Math.sin(state.clock.elapsedTime * 3) * 0.02 + volume * 0.15
      : 1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.03;
    ringRef.current.scale.setScalar(pulseScale);
  });

  return (
    <mesh ref={ringRef}>
      <torusGeometry args={[1.8, 0.015, 16, 100]} />
      <meshPhysicalMaterial
        color={connectionState === 'CONNECTED' ? COLORS.terminalGreen : COLORS.sacredAmber}
        emissive={connectionState === 'CONNECTED' ? COLORS.terminalGreen : COLORS.sacredAmber}
        emissiveIntensity={connectionState === 'CONNECTED' ? 0.8 + volume * 2 : 0.3}
        roughness={0.1}
        metalness={0.9}
        transparent
        opacity={0.6}
      />
    </mesh>
  );
}

// ─── Second Orbital Ring (perpendicular) ───
function OrbitalRing2({ connectionState, volume }: OrbProps) {
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame((state, delta) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.y += delta * 0.15;
    ringRef.current.rotation.x = Math.PI / 2.5;
  });

  return (
    <mesh ref={ringRef}>
      <torusGeometry args={[2.1, 0.008, 16, 100]} />
      <meshPhysicalMaterial
        color={COLORS.vellumWhite}
        emissive={COLORS.sacredAmber}
        emissiveIntensity={0.15}
        roughness={0.1}
        metalness={0.9}
        transparent
        opacity={0.25}
      />
    </mesh>
  );
}

// ─── Tiny orbiting particles ───
function OrbitalParticles({ connectionState, volume }: OrbProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const particleCount = 6;

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.3;
    groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.2;
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: particleCount }).map((_, i) => {
        const angle = (i / particleCount) * Math.PI * 2;
        const radius = 2.4;
        return (
          <mesh key={i} position={[Math.cos(angle) * radius, Math.sin(angle * 0.5) * 0.3, Math.sin(angle) * radius]}>
            <sphereGeometry args={[0.035, 16, 16]} />
            <meshPhysicalMaterial
              color={i % 2 === 0 ? COLORS.terminalGreen : COLORS.sacredAmber}
              emissive={i % 2 === 0 ? COLORS.terminalGreen : COLORS.sacredAmber}
              emissiveIntensity={connectionState === 'CONNECTED' ? 1 + volume * 3 : 0.5}
              roughness={0}
              metalness={1}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Connecting State: Animated Spinner Ring ───
function ConnectingSpinner() {
  const ringRef = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.z = state.clock.elapsedTime * 3;
  });

  return (
    <mesh ref={ringRef}>
      <torusGeometry args={[2.5, 0.025, 8, 32, Math.PI * 1.5]} />
      <meshPhysicalMaterial
        color={COLORS.connecting}
        emissive={COLORS.connecting}
        emissiveIntensity={1.5}
        roughness={0}
        metalness={1}
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}

// ─── Main 3D Scene ───
function Scene({ connectionState, volume }: OrbProps) {
  return (
    <>
      <Environment preset="night" />
      <ambientLight intensity={0.3} />
      <pointLight position={[5, 5, 5]} intensity={0.5} color={COLORS.sacredAmber} />
      <pointLight position={[-5, -3, -5]} intensity={0.3} color={COLORS.terminalGreen} />

      <Float 
        speed={connectionState === 'CONNECTING' ? 3 : 1.5} 
        rotationIntensity={0.4} 
        floatIntensity={connectionState === 'CONNECTED' ? 0.5 : 1.2}
      >
        <CoreOrb connectionState={connectionState} volume={volume} />
        <OrbitalRing connectionState={connectionState} volume={volume} />
        <OrbitalRing2 connectionState={connectionState} volume={volume} />
        <OrbitalParticles connectionState={connectionState} volume={volume} />
        {connectionState === 'CONNECTING' && <ConnectingSpinner />}
      </Float>

      <ContactShadows 
        position={[0, -2.5, 0]} 
        opacity={0.4} 
        scale={12} 
        blur={3} 
        far={4}
        color={connectionState === 'CONNECTED' ? COLORS.terminalGreen : COLORS.sacredAmber}
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
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Scene connectionState={connectionState} volume={volume} />
      </Canvas>
    </div>
  );
}
