import * as THREE from 'three';

// Cache generated procedural textures to avoid redundant canvas rendering
const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Creates procedural normal & roughness map for recycled PET plastic.
 * Simulates micro-scratches, handling scuffs, and extrusion flow waves.
 */
export function getRecycledPETTextures(): {
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const normalKey = 'pet_normal';
  const roughKey = 'pet_rough';

  if (textureCache.has(normalKey) && textureCache.has(roughKey)) {
    return {
      normalMap: textureCache.get(normalKey)!,
      roughnessMap: textureCache.get(roughKey)!,
    };
  }

  const size = 512;
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalCtx = normalCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext('2d')!;

  // 1. Base normal: neutral flat normal [128, 128, 255]
  normalCtx.fillStyle = 'rgb(128, 128, 255)';
  normalCtx.fillRect(0, 0, size, size);

  // 2. Base roughness: subtle satin gloss [55, 55, 55]
  roughCtx.fillStyle = 'rgb(55, 55, 55)';
  roughCtx.fillRect(0, 0, size, size);

  // Add subtle horizontal extrusion mold waves (characteristic of blown bottles)
  for (let y = 0; y < size; y += 8) {
    const wave = Math.sin((y / size) * Math.PI * 16) * 12;
    normalCtx.fillStyle = `rgba(${128 + wave}, ${128}, 255, 0.25)`;
    normalCtx.fillRect(0, y, size, 4);

    roughCtx.fillStyle = `rgba(80, 80, 80, 0.15)`;
    roughCtx.fillRect(0, y, size, 4);
  }

  // Add realistic micro-scratches and handling scuffs
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const length = 15 + Math.random() * 35;
    const angle = Math.random() * Math.PI * 2;

    // Normal scratch perturbation
    normalCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(150, 110, 255, 0.4)' : 'rgba(110, 150, 255, 0.4)';
    normalCtx.lineWidth = 1 + Math.random() * 1.5;
    normalCtx.beginPath();
    normalCtx.moveTo(x, y);
    normalCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    normalCtx.stroke();

    // Roughness scratch (scratches scatter light, higher roughness)
    roughCtx.strokeStyle = 'rgba(120, 120, 120, 0.6)';
    roughCtx.lineWidth = 1.2;
    roughCtx.beginPath();
    roughCtx.moveTo(x, y);
    roughCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    roughCtx.stroke();
  }

  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(2, 2);

  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = THREE.RepeatWrapping;
  roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(2, 2);

  return {
    normalMap: registerCachedTexture(normalKey, normalTex, false),
    roughnessMap: registerCachedTexture(roughKey, roughTex, false),
  };
}

/**
 * Creates procedural texture for the hand-cut sheared edge (gờ cắt thủ công).
 * Shows tactile micro-serrations and scissor bite marks.
 */
export function getCutEdgeNormalTexture(): THREE.CanvasTexture {
  const key = 'cut_edge_normal';
  if (textureCache.has(key)) return textureCache.get(key)!;

  const width = 512;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgb(128, 128, 255)';
  ctx.fillRect(0, 0, width, height);

  // Scissor teeth micro-ridges
  for (let x = 0; x < width; x += 4) {
    const jitter = Math.sin(x * 0.4) * 25;
    ctx.fillStyle = `rgb(${128 + jitter}, ${128 - jitter * 0.5}, 255)`;
    ctx.fillRect(x, 0, 2, height);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 1);
  return registerCachedTexture(key, tex, false);
}

/**
 * Creates fluted grip texture for HDPE bottle caps with injection molding center sprue.
 */
export function getBottleCapTextures(): {
  bumpMap: THREE.CanvasTexture;
  topBumpMap: THREE.CanvasTexture;
} {
  const sideKey = 'cap_side_bump';
  const topKey = 'cap_top_bump';

  if (textureCache.has(sideKey) && textureCache.has(topKey)) {
    return {
      bumpMap: textureCache.get(sideKey)!,
      topBumpMap: textureCache.get(topKey)!,
    };
  }

  // Side flutes
  const sideCanvas = document.createElement('canvas');
  sideCanvas.width = 512;
  sideCanvas.height = 64;
  const sCtx = sideCanvas.getContext('2d')!;
  sCtx.fillStyle = '#808080';
  sCtx.fillRect(0, 0, 512, 64);

  // 32 flutes around circumference
  const fluteWidth = 512 / 32;
  for (let i = 0; i < 32; i++) {
    const x = i * fluteWidth;
    sCtx.fillStyle = '#ffffff';
    sCtx.fillRect(x, 0, fluteWidth * 0.55, 64);
    sCtx.fillStyle = '#202020';
    sCtx.fillRect(x + fluteWidth * 0.55, 0, fluteWidth * 0.45, 64);
  }

  const sideTex = new THREE.CanvasTexture(sideCanvas);
  sideTex.wrapS = THREE.RepeatWrapping;
  sideTex.wrapT = THREE.ClampToEdgeWrapping;
  sideTex.repeat.set(1, 1);

  // Top surface with mold gate pip ring
  const topCanvas = document.createElement('canvas');
  topCanvas.width = 256;
  topCanvas.height = 256;
  const tCtx = topCanvas.getContext('2d')!;
  tCtx.fillStyle = '#808080';
  tCtx.fillRect(0, 0, 256, 256);

  // Outer bevel ring
  tCtx.strokeStyle = '#c0c0c0';
  tCtx.lineWidth = 6;
  tCtx.beginPath();
  tCtx.arc(128, 128, 118, 0, Math.PI * 2);
  tCtx.stroke();

  // Center injection sprue pip
  tCtx.fillStyle = '#404040';
  tCtx.beginPath();
  tCtx.arc(128, 128, 10, 0, Math.PI * 2);
  tCtx.fill();
  tCtx.fillStyle = '#ffffff';
  tCtx.beginPath();
  tCtx.arc(128, 128, 5, 0, Math.PI * 2);
  tCtx.fill();

  const topTex = new THREE.CanvasTexture(topCanvas);
  return {
    bumpMap: registerCachedTexture(sideKey, sideTex, false),
    topBumpMap: registerCachedTexture(topKey, topTex, false),
  };
}

/**
 * Creates Kraft cardboard fibrous texture with corrugated fluting.
 */
export function getKraftCardboardTexture(): {
  colorMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const colKey = 'cardboard_col';
  const bumpKey = 'cardboard_bump';
  if (textureCache.has(colKey) && textureCache.has(bumpKey)) {
    return {
      colorMap: textureCache.get(colKey)!,
      bumpMap: textureCache.get(bumpKey)!,
    };
  }

  const size = 512;
  const cCanvas = document.createElement('canvas');
  cCanvas.width = size;
  cCanvas.height = size;
  const cCtx = cCanvas.getContext('2d')!;

  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d')!;

  // Kraft warm base
  cCtx.fillStyle = '#d4a373';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  // Random paper fiber flecks
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 3 + Math.random() * 8;
    const angle = Math.random() * Math.PI * 2;
    const darkFleck = Math.random() > 0.4;

    cCtx.strokeStyle = darkFleck ? 'rgba(120, 80, 50, 0.35)' : 'rgba(240, 220, 190, 0.4)';
    cCtx.lineWidth = 1;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    cCtx.stroke();

    bCtx.strokeStyle = darkFleck ? 'rgba(40, 40, 40, 0.3)' : 'rgba(200, 200, 200, 0.3)';
    bCtx.lineWidth = 1;
    bCtx.beginPath();
    bCtx.moveTo(x, y);
    bCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    bCtx.stroke();
  }

  // Corrugation subtle linear waves
  for (let y = 0; y < size; y += 12) {
    cCtx.fillStyle = 'rgba(140, 95, 60, 0.08)';
    cCtx.fillRect(0, y, size, 6);
    bCtx.fillStyle = 'rgba(180, 180, 180, 0.15)';
    bCtx.fillRect(0, y, size, 6);
  }

  const colTex = new THREE.CanvasTexture(cCanvas);
  colTex.colorSpace = THREE.SRGBColorSpace;
  colTex.wrapS = THREE.RepeatWrapping;
  colTex.wrapT = THREE.RepeatWrapping;

  const bumpTex = new THREE.CanvasTexture(bCanvas);
  bumpTex.wrapS = THREE.RepeatWrapping;
  bumpTex.wrapT = THREE.RepeatWrapping;

  return {
    colorMap: registerCachedTexture(colKey, colTex, true),
    bumpMap: registerCachedTexture(bumpKey, bumpTex, false),
  };
}

/**
 * Creates bamboo / wood grain texture for skewers and axles.
 */
export function getBambooWoodTexture(): THREE.CanvasTexture {
  const key = 'bamboo_grain';
  if (textureCache.has(key)) return textureCache.get(key)!;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#deb887';
  ctx.fillRect(0, 0, 256, 256);

  // Linear fibers
  for (let x = 0; x < 256; x += 2) {
    const shade = 180 + Math.floor(Math.random() * 40);
    ctx.strokeStyle = `rgb(${shade + 20}, ${shade - 10}, ${shade - 60})`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return registerCachedTexture(key, tex, true);
}

/**
 * Creates organic potting soil texture with humus specks and white perlite particles.
 */
export function getPottingSoilTexture(): THREE.CanvasTexture {
  const key = 'potting_soil';
  if (textureCache.has(key)) return textureCache.get(key)!;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Deep rich dark loam
  ctx.fillStyle = '#2c1e14';
  ctx.fillRect(0, 0, 256, 256);

  // Soil granules
  for (let i = 0; i < 600; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 1 + Math.random() * 2.5;
    ctx.fillStyle = Math.random() > 0.5 ? '#1a110a' : '#3d2b1f';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // White perlite dots (soil aeration minerals)
  ctx.fillStyle = '#e2e8f0';
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return registerCachedTexture(key, tex, true);
}

/**
 * Creates soft radial contact shadow texture to firmly anchor the product to the studio ground.
 */
export function getContactShadowTexture(): THREE.CanvasTexture {
  const key = 'contact_shadow_radial';
  if (textureCache.has(key)) return textureCache.get(key)!;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const gradient = ctx.createRadialGradient(256, 256, 20, 256, 256, 240);
  gradient.addColorStop(0, 'rgba(15, 23, 42, 0.85)');
  gradient.addColorStop(0.35, 'rgba(15, 23, 42, 0.45)');
  gradient.addColorStop(0.7, 'rgba(15, 23, 42, 0.15)');
  gradient.addColorStop(1, 'rgba(15, 23, 42, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  return registerCachedTexture(key, tex, true);
}

/**
 * Creates realistic carpenter workbench wood texture for the workshop studio backdrop.
 */
export function getWorkshopWoodFloorTexture(): THREE.CanvasTexture {
  const key = 'workshop_wood_floor';
  if (textureCache.has(key)) return textureCache.get(key)!;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#78350f';
  ctx.fillRect(0, 0, 512, 512);

  // Planks
  const plankH = 512 / 8;
  for (let p = 0; p < 8; p++) {
    const y = p * plankH;
    const tone = 20 + Math.floor(Math.sin(p) * 15);
    ctx.fillStyle = `rgb(${110 + tone}, ${55 + tone * 0.5}, ${20 + tone * 0.2})`;
    ctx.fillRect(0, y, 512, plankH - 2);

    // Plank seam
    ctx.fillStyle = '#261205';
    ctx.fillRect(0, y + plankH - 2, 512, 2);

    // Fine wood grain lines inside plank
    for (let g = 0; g < 14; g++) {
      ctx.strokeStyle = 'rgba(40, 20, 5, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + g * 4);
      ctx.bezierCurveTo(150, y + g * 4 + 3, 350, y + g * 4 - 3, 512, y + g * 4);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.anisotropy = 4;
  tex.userData.isSharedCache = true;
  textureCache.set(key, tex);
  return tex;
}

function registerCachedTexture(
  key: string,
  tex: THREE.CanvasTexture,
  isColorMap: boolean
): THREE.CanvasTexture {
  tex.colorSpace = isColorMap ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.userData.isSharedCache = true;
  textureCache.set(key, tex);
  return tex;
}

/**
 * Marks existing cached textures on first read as shared-cache safe.
 */
export function ensureSharedCacheFlags() {
  textureCache.forEach((tex, key) => {
    tex.userData.isSharedCache = true;
    const isColor =
      key.includes('col') ||
      key.includes('bamboo') ||
      key.includes('soil') ||
      key.includes('wood');
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  });
}

/**
 * Procedural anisotropic brushed metal normal + roughness maps (Aluminum / Steel cans).
 */
export function getBrushedMetalTextures(): {
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const nKey = 'metal_brushed_normal';
  const rKey = 'metal_brushed_rough';
  if (textureCache.has(nKey) && textureCache.has(rKey)) {
    return {
      normalMap: textureCache.get(nKey)!,
      roughnessMap: textureCache.get(rKey)!,
    };
  }

  const size = 256;
  const nCanvas = document.createElement('canvas');
  nCanvas.width = size;
  nCanvas.height = size;
  const nCtx = nCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(72, 72, 72)';
  rCtx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y++) {
    const jitter = Math.sin(y * 1.37) * 14 + ((y * 17) % 9) - 4;
    nCtx.fillStyle = `rgb(${Math.round(128 + jitter * 0.4)}, ${Math.round(128 + jitter)}, 255)`;
    nCtx.fillRect(0, y, size, 1);

    const roughVal = Math.max(38, Math.min(115, 72 + Math.round(jitter * 1.4)));
    rCtx.fillStyle = `rgb(${roughVal}, ${roughVal}, ${roughVal})`;
    rCtx.fillRect(0, y, size, 1);
  }

  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(3, 3);

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(3, 3);

  return {
    normalMap: registerCachedTexture(nKey, normalMap, false),
    roughnessMap: registerCachedTexture(rKey, roughnessMap, false),
  };
}

/**
 * Procedural textile / denim twill weave normal + roughness maps (Fabric / Denim).
 */
export function getFabricWeaveTextures(): {
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const nKey = 'fabric_weave_normal';
  const rKey = 'fabric_weave_rough';
  if (textureCache.has(nKey) && textureCache.has(rKey)) {
    return {
      normalMap: textureCache.get(nKey)!,
      roughnessMap: textureCache.get(rKey)!,
    };
  }

  const size = 256;
  const nCanvas = document.createElement('canvas');
  nCanvas.width = size;
  nCanvas.height = size;
  const nCtx = nCanvas.getContext('2d')!;

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;

  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(218, 218, 218)';
  rCtx.fillRect(0, 0, size, size);

  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const diag = ((x + y) / step) % 2 === 0;
      nCtx.fillStyle = diag ? 'rgb(154, 144, 255)' : 'rgb(102, 114, 255)';
      nCtx.fillRect(x + 1, y + 1, step - 2, step - 2);
      rCtx.fillStyle = diag ? 'rgb(200, 200, 200)' : 'rgb(235, 235, 235)';
      rCtx.fillRect(x, y, step, step);
    }
  }

  const normalMap = new THREE.CanvasTexture(nCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(4, 4);

  const roughnessMap = new THREE.CanvasTexture(rCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(4, 4);

  return {
    normalMap: registerCachedTexture(nKey, normalMap, false),
    roughnessMap: registerCachedTexture(rKey, roughnessMap, false),
  };
}

export function getCachedTextureStats(): { count: number; keys: string[] } {
  ensureSharedCacheFlags();
  return {
    count: textureCache.size,
    keys: Array.from(textureCache.keys()),
  };
}

