import React, { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, ContactShadows, Text } from '@react-three/drei';
import * as THREE from 'three';

const _targetScale = new THREE.Vector3();
const _lerpColor = new THREE.Color();

// ─── Glowing Language Sphere ───
function LanguageSphere({ nativeLanguage, learningLanguage }: { nativeLanguage: string; learningLanguage: string }) {
  const groupRef = useRef<THREE.Group>(null!);
  const sphereRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHover] = useState(false);

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += 0.003;

    if (sphereRef.current) {
      const s = hovered ? 1.08 : 1;
      _targetScale.set(s, s, s);
      sphereRef.current.scale.lerp(_targetScale, 0.08);
    }
  });

  return (
    <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.8}>
      <group ref={groupRef}>
        {/* Main Sphere */}
        <mesh
          ref={sphereRef}
          onPointerOver={() => { setHover(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}
        >
          <sphereGeometry args={[1.4, 32, 32]} />
          <meshPhysicalMaterial
            color="#0A0A0B"
            emissive="#FFBF00"
            emissiveIntensity={0.08}
            roughness={0.15}
            metalness={0.6}
            clearcoat={1}
            clearcoatRoughness={0.05}
            transparent
            opacity={0.9}
          />
        </mesh>

        {/* Wireframe overlay */}
        <mesh>
          <sphereGeometry args={[1.42, 16, 16]} />
          <meshBasicMaterial color="#FFBF00" wireframe transparent opacity={0.08} />
        </mesh>

        {/* Latitude ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.6, 0.008, 16, 100]} />
          <meshBasicMaterial color="#00FF41" transparent opacity={0.4} />
        </mesh>

        {/* Longitude ring */}
        <mesh>
          <torusGeometry args={[1.7, 0.006, 16, 100]} />
          <meshBasicMaterial color="#FFBF00" transparent opacity={0.25} />
        </mesh>

        {/* Diagonal ring */}
        <mesh rotation={[0.5, 0.5, 0]}>
          <torusGeometry args={[1.8, 0.005, 16, 100]} />
          <meshBasicMaterial color="#F5F5F7" transparent opacity={0.12} />
        </mesh>

        {/* Native Language Label - orbiting */}
        <group rotation={[0, 0, 0.15]}>
          <mesh position={[0, 0, 1.9]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshBasicMaterial color="#00FF41" />
          </mesh>
          <Text
            position={[0, 0.25, 1.9]}
            fontSize={0.18}
            color="#00FF41"
            anchorX="center"
            anchorY="middle"
            font="https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ujIw2Y3iSe7cLxZhw8Skv0MCFw.woff2"
          >
            {nativeLanguage}
          </Text>
        </group>

        {/* Learning Language Label - opposite side */}
        <group rotation={[0, Math.PI, -0.15]}>
          <mesh position={[0, 0, 1.9]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshBasicMaterial color="#FFBF00" />
          </mesh>
          <Text
            position={[0, 0.25, 1.9]}
            fontSize={0.18}
            color="#FFBF00"
            anchorX="center"
            anchorY="middle"
            font="https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ujIw2Y3iSe7cLxZhw8Skv0MCFw.woff2"
          >
            {learningLanguage}
          </Text>
        </group>

        {/* Small orbiting particles */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const angle = (i / 8) * Math.PI * 2;
          const r = 2.1;
          return (
            <mesh key={i} position={[Math.cos(angle) * r, Math.sin(angle * 0.3) * 0.4, Math.sin(angle) * r]}>
              <sphereGeometry args={[0.025, 8, 8]} />
              <meshBasicMaterial
                color={i % 2 === 0 ? '#00FF41' : '#FFBF00'}
                transparent
                opacity={0.5}
              />
            </mesh>
          );
        })}
      </group>
    </Float>
  );
}

interface LanguageOrbProps {
  nativeLanguage: string;
  learningLanguage: string;
}

export default function LanguageOrb({ nativeLanguage, learningLanguage }: LanguageOrbProps) {
  return (
    <div style={{ width: '100%', height: '100%', minHeight: '300px' }}>
      <Canvas
        camera={{ position: [0, 0.5, 5.5], fov: 40 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={0.4} color="#FFBF00" />
        <directionalLight position={[-4, -2, -3]} intensity={0.2} color="#00FF41" />
        <pointLight position={[0, 3, 2]} intensity={0.3} color="#fff" />
        
        <LanguageSphere nativeLanguage={nativeLanguage} learningLanguage={learningLanguage} />
        
        <ContactShadows
          position={[0, -2.2, 0]}
          opacity={0.3}
          scale={8}
          blur={3}
          far={4}
          color="#FFBF00"
        />
      </Canvas>
    </div>
  );
}
