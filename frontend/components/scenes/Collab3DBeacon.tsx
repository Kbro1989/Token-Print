"use client";

import React from "react";
import { Billboard, Text } from "@react-three/drei";
import { useStore } from "@/lib/store";
import { LAYOUT, layerOrigin } from "./ArchitectureLayout";
import { sanitizeColor } from "@/lib/collab/client";

export function Collab3DBeacon() {
  const collabEnabled = useStore((s) => s.collabEnabled);
  const collabPeers = useStore((s) => s.collabPeers);

  if (!collabEnabled) return null;

  const peers = Object.values(collabPeers);

  return (
    <group name="collab-3d-beacons">
      {peers.map((peer) => {
        // Target layer from selection or active cursor
        const targetLayer =
          peer.selection?.kind === "layer"
            ? peer.selection.index
            : peer.cursor?.activeLayer ?? null;

        if (
          targetLayer === null ||
          targetLayer === undefined ||
          typeof targetLayer !== "number" ||
          isNaN(targetLayer) ||
          targetLayer < 0
        ) {
          return null;
        }

        const [, originY] = layerOrigin(targetLayer);
        const beaconY = originY - LAYOUT.LAYER_HEIGHT * 0.35;
        const color = sanitizeColor(peer.color);

        return (
          <group key={peer.user_id} position={[0, beaconY, 0]}>
            {/* Glowing Selection Ring */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[13.5, 0.15, 16, 64]} />
              <meshBasicMaterial color={color} transparent opacity={0.8} />
            </mesh>

            {/* Inner pulsing ring */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[13.8, 0.05, 12, 48]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
            </mesh>

            {/* Billboard Name Tag */}
            <Billboard position={[0, 4.5, 14]} follow lockX={false} lockY={false} lockZ={false}>
              <Text
                fontSize={1.4}
                color={color}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.12}
                outlineColor="#000000"
              >
                {`${peer.name}: Layer ${targetLayer}`}
              </Text>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}
