import * as THREE from 'three';
import {
  getRecycledPETTextures,
  getCutEdgeNormalTexture,
  getBottleCapTextures,
  getKraftCardboardTexture,
  getBambooWoodTexture,
  getPottingSoilTexture,
} from './photorealisticTextures';

/**
 * Creates realistic recycled PET plastic material with transmission, clearcoat,
 * subtle micro-scratches, and authentic physical index of refraction (IOR 1.52).
 */
export function createRecycledPETMaterial(options?: {
  tintColor?: number;
  transmission?: number;
  roughness?: number;
}): THREE.MeshPhysicalMaterial {
  const { normalMap, roughnessMap } = getRecycledPETTextures();

  return new THREE.MeshPhysicalMaterial({
    color: options?.tintColor ?? 0xffffff,
    metalness: 0.02,
    roughness: options?.roughness ?? 0.22,
    transmission: options?.transmission ?? 0.84,
    thickness: 0.7,
    ior: 1.52, // Authentic PET plastic IOR
    attenuationColor: new THREE.Color(0xdbeafe),
    attenuationDistance: 2.2,
    clearcoat: 0.88,
    clearcoatRoughness: 0.18,
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughnessMap: roughnessMap,
    transparent: true,
    opacity: 1.0,
    depthWrite: false, // Essential for proper nested refraction
    side: THREE.DoubleSide,
  });
}

/**
 * Creates material for the sheared hand-cut edge (gờ cắt thủ công).
 * Shows the slightly frosted, micro-serrated cut lip where the scissors or cutter made contact.
 */
export function createHandCutLipMaterial(): THREE.MeshPhysicalMaterial {
  const normalMap = getCutEdgeNormalTexture();

  return new THREE.MeshPhysicalMaterial({
    color: 0xf1f5f9,
    metalness: 0.04,
    roughness: 0.42,
    transmission: 0.45,
    thickness: 0.4,
    ior: 1.52,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    normalMap: normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    transparent: true,
    opacity: 0.95,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
}

/**
 * Creates HDPE bottle cap material with molded side flutes and mold sprue pip.
 */
export function createHDPECapMaterial(colorHex: number): THREE.MeshStandardMaterial {
  const { bumpMap } = getBottleCapTextures();

  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.36,
    metalness: 0.03,
    bumpMap: bumpMap,
    bumpScale: 0.04,
  });
}

/**
 * Creates realistic hot melt glue droplet (keo nến trong suốt có độ bóng cao).
 */
export function createHotGlueMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.14,
    transmission: 0.75,
    thickness: 0.5,
    ior: 1.48,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
}

/**
 * Creates bamboo skewer / wooden axle material with real wood grain.
 */
export function createBambooAxleMaterial(): THREE.MeshStandardMaterial {
  const woodTex = getBambooWoodTexture();

  return new THREE.MeshStandardMaterial({
    color: 0xdeb887,
    roughness: 0.72,
    metalness: 0.02,
    map: woodTex,
    bumpMap: woodTex,
    bumpScale: 0.02,
  });
}

/**
 * Creates realistic organic potting soil with white perlite specks.
 */
export function createPottingSoilMaterial(): THREE.MeshStandardMaterial {
  const soilTex = getPottingSoilTexture();

  return new THREE.MeshStandardMaterial({
    map: soilTex,
    bumpMap: soilTex,
    bumpScale: 0.05,
    roughness: 0.96,
    metalness: 0.01,
  });
}

/**
 * Creates Kraft cardboard material with fibers and corrugated ridges.
 */
export function createKraftCardboardMaterial(): THREE.MeshStandardMaterial {
  const { colorMap, bumpMap } = getKraftCardboardTexture();

  return new THREE.MeshStandardMaterial({
    map: colorMap,
    bumpMap: bumpMap,
    bumpScale: 0.03,
    roughness: 0.88,
    metalness: 0.01,
  });
}

/**
 * Creates brushed aluminum tin can material with realistic anisotropic highlights.
 */
export function createBrushedAluminumMaterial(tintHex: number = 0xa8b2c1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: tintHex,
    metalness: 0.88,
    roughness: 0.28,
  });
}

/**
 * Creates transparent glass material for recycled jars and beverage bottles.
 */
export function createGlassMaterial(options?: {
  tintColor?: number;
  roughness?: number;
}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: options?.tintColor ?? 0xffffff,
    metalness: 0.05,
    roughness: options?.roughness ?? 0.08,
    transmission: 0.96,
    thickness: 1.0,
    ior: 1.52,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Creates lush green plant leaf material with subtle organic subsurface translucency.
 */
export function createLushLeafMaterial(colorHex: number = 0x22c55e): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.32,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
}

/**
 * Creates glowing lantern light core material (flame / warm LED).
 */
export function createWarmLanternLightMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffedd5,
    emissive: 0xff9900,
    emissiveIntensity: 3.5,
    roughness: 0.1,
    metalness: 0.0,
  });
}

/**
 * Creates golden bird seed mixture material (thóc, hạt kê, hạt hướng dương).
 */
export function createBirdSeedMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.82,
    metalness: 0.02,
  });
}

/**
 * Creates glossy lacquer enamel material for stationery pencils / markers.
 */
export function createPencilLacquerMaterial(colorHex: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.22,
    metalness: 0.05,
  });
}

/**
 * Creates expanded clay pebbles (sỏi đất nung LECA) for hydroponic planters.
 */
export function createHydroponicLECAMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x9a3412, // Warm terracotta brown
    roughness: 0.9,
    metalness: 0.02,
  });
}

/**
 * Creates rustic galvanized iron / copper wire for handles and hangers.
 */
export function createRusticWireMaterial(colorHex: number = 0x64748b): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.85,
    roughness: 0.38,
  });
}

