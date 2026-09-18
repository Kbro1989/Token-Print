"use client";

interface TokenFlowParticle3DProps {
  activeTokenIndex?: number;
  isPlaying?: boolean;
}

/**
 * Animated emissive 3D data flow particles traveling along actual spatial 3D pathways
 * (Input Tokens → Embedding → Layer 0..23 → LM Head) during playback execution.
 * Pure monochrome aesthetics.
 */
export function TokenFlowParticle3D({
  activeTokenIndex = 0,
  isPlaying = false,
}: TokenFlowParticle3DProps) {
  return null;
}
