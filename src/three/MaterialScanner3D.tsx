import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Eye,
  Grid,
  Maximize2,
  Minimize2,
  RotateCcw,
  Ruler,
  ShieldCheck,
  Compass,
  Play,
  Pause,
  Download,
  Crosshair,
  Trash2,
  Layers,
  Info,
  Upload,
  Box,
  Image as ImageIcon,
  Sliders,
  AlertTriangle,
  Cpu,
  Sparkles,
} from 'lucide-react';
import { MaterialItem } from '../../server/db';
import { getContactShadowTexture } from './photorealisticTextures';
import {
  buildParametricReconstructionMesh,
  disposeObject3D,
  ensureMaterialReconstruction,
  inspectAndNormalizeGlbScene,
  optimizeSceneForQualityAndPerformance,
  resizeReconstructedModel,
  validateBufferGeometry,
  type GeometryRefinementReport,
  type GeometryTelemetry,
  type ParametricPartEntry,
  type Phase3ValidationReport,
} from './GeometryReconstructionEngine';
import {
  validateModelQualityPhase6,
  type Phase6QualityValidationReport,
} from './ModelQualityValidator';
import type { UvAlignmentMetrics } from '../vision/textureExtractor';
import type { GlbInspectionReport } from '../types/reconstruction';

interface MaterialScanner3DProps {
  material: MaterialItem;
  height?: string;
}

interface MeasuredPoint {
  position: THREE.Vector3;
  label: string;
}

type RenderMode = 'realistic' | 'wireframe' | 'xray';
type ModelSourceMode = 'parametric' | 'glb' | 'compare';
type QualityEnhancementMode = 'optimized' | 'raw' | 'compare_quality';

function applyRenderModeToGroup(group: THREE.Object3D, mode: RenderMode) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.name === 'usableZoneHighlight') return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.userData._wasTransparent === undefined) {
        mat.userData._wasTransparent = Boolean((mat as any).transparent);
        mat.userData._wasOpacity =
          typeof (mat as any).opacity === 'number' ? (mat as any).opacity : 1.0;
        mat.userData._wasDepthWrite =
          typeof (mat as any).depthWrite === 'boolean' ? (mat as any).depthWrite : true;
      }

      if (mode === 'wireframe') {
        (mat as any).wireframe = true;
        (mat as any).transparent = false;
        (mat as any).opacity = 1.0;
        (mat as any).depthWrite = true;
      } else if (mode === 'xray') {
        (mat as any).wireframe = false;
        (mat as any).transparent = true;
        (mat as any).opacity = 0.32;
        (mat as any).depthWrite = false;
      } else {
        (mat as any).wireframe = false;
        (mat as any).transparent = Boolean(mat.userData._wasTransparent);
        (mat as any).opacity =
          typeof mat.userData._wasOpacity === 'number' ? mat.userData._wasOpacity : 1.0;
        (mat as any).depthWrite =
          typeof mat.userData._wasDepthWrite === 'boolean' ? mat.userData._wasDepthWrite : true;
      }
      mat.needsUpdate = true;
    }
  });
}

function addDimensionLinesToGroup(
  dimGroup: THREE.Group,
  widthU: number,
  heightU: number,
  depthU: number,
  widthCm: number,
  heightCm: number,
  depthCm: number,
  isLathe: boolean
) {
  const createLabelSprite = (text: string, bgColor = '#0f172a', textColor = '#ffffff') => {
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(8, 8, 264, 48, 14);
      ctx.fill();
      ctx.font = 'bold 23px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 140, 32);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.18, 0.27, 1);
    sprite.renderOrder = 20;
    return sprite;
  };

  const makeLine = (p1: THREE.Vector3, p2: THREE.Vector3, colorHex: number) => {
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({ color: colorHex });
    return new THREE.Line(geo, mat);
  };

  const xOffset = widthU / 2 + 0.35;
  dimGroup.add(
    makeLine(new THREE.Vector3(xOffset, 0, 0), new THREE.Vector3(xOffset, heightU, 0), 0x059669)
  );
  dimGroup.add(
    makeLine(
      new THREE.Vector3(xOffset - 0.08, 0, 0),
      new THREE.Vector3(xOffset + 0.08, 0, 0),
      0x059669
    )
  );
  dimGroup.add(
    makeLine(
      new THREE.Vector3(xOffset - 0.08, heightU, 0),
      new THREE.Vector3(xOffset + 0.08, heightU, 0),
      0x059669
    )
  );

  const hLabel = createLabelSprite(`H = ${heightCm.toFixed(1)} cm`, '#059669');
  hLabel.position.set(xOffset + 0.65, heightU / 2, 0);
  dimGroup.add(hLabel);

  const zOffset = depthU / 2 + 0.35;
  dimGroup.add(
    makeLine(
      new THREE.Vector3(-widthU / 2, 0.04, zOffset),
      new THREE.Vector3(widthU / 2, 0.04, zOffset),
      0x2563eb
    )
  );

  const wLabel = createLabelSprite(
    isLathe ? `Ø = ${widthCm.toFixed(1)} cm` : `W = ${widthCm.toFixed(1)} cm`,
    '#2563eb'
  );
  wLabel.position.set(0, 0.26, zOffset + 0.2);
  dimGroup.add(wLabel);

  if (!isLathe) {
    const dLabel = createLabelSprite(`D = ${depthCm.toFixed(1)} cm`, '#7c3aed');
    dLabel.position.set(-widthU / 2 - 0.45, 0.26, 0);
    dimGroup.add(dLabel);
  }
}

export const MaterialScanner3D: React.FC<MaterialScanner3DProps> = ({
  material,
  height = '460px',
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  const initialRecon = ensureMaterialReconstruction(material);
  const externalGlbUrl = initialRecon.imageTo3D?.glbUrl || null;

  // Display & reconstruction controls
  const [renderMode, setRenderMode] = useState<RenderMode>('realistic');
  const [modelSource, setModelSource] = useState<ModelSourceMode>(
    externalGlbUrl ? 'glb' : 'parametric'
  );
  const [qualityMode, setQualityMode] = useState<QualityEnhancementMode>('optimized');
  const [uploadedGlbUrl, setUploadedGlbUrl] = useState<string | null>(null);
  const [glbLoadError, setGlbLoadError] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);
  const [webglContextLost, setWebglContextLost] = useState<boolean>(false);

  const [usePhotoTexture, setUsePhotoTexture] = useState<boolean>(true);
  const [explodedFactor, setExplodedFactor] = useState<number>(0);
  const [showDimensions, setShowDimensions] = useState(true);
  const [showUsableZone, setShowUsableZone] = useState(true);
  const [isAutoRotating, setIsAutoRotating] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [telemetry, setTelemetry] = useState<GeometryTelemetry | null>(null);
  const [glbInspection, setGlbInspection] = useState<GlbInspectionReport | null>(null);
  const [phase3Validation, setPhase3Validation] = useState<Phase3ValidationReport | null>(null);
  const [refinementReport, setRefinementReport] = useState<GeometryRefinementReport | null>(null);
  const [uvMetrics, setUvMetrics] = useState<UvAlignmentMetrics | null>(null);
  const [qualityValidation, setQualityValidation] = useState<Phase6QualityValidationReport | null>(null);
  const [gpuStats, setGpuStats] = useState<{ calls: number; triangles: number; textures: number } | null>(null);
  const [partsList, setPartsList] = useState<ParametricPartEntry[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [showReferenceThumb, setShowReferenceThumb] = useState<boolean>(false);

  // Caliper 3D measurement tool
  const [isCaliperActive, setIsCaliperActive] = useState(false);
  const [caliperPoints, setCaliperPoints] = useState<MeasuredPoint[]>([]);
  const [measuredDistanceCm, setMeasuredDistanceCm] = useState<number | null>(null);
  const [calibrationHeightCm, setCalibrationHeightCm] = useState<number>(
    initialRecon.dimensions.heightCm || material.dimensions?.heightCm || 20
  );
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [exportingGlb, setExportingGlb] = useState(false);

  // Refs for Three.js scene
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const dimGroupRef = useRef<THREE.Group | null>(null);
  const measurementGroupRef = useRef<THREE.Group | null>(null);
  const partsRef = useRef<ParametricPartEntry[]>([]);
  const animFrameRef = useRef<number>(0);
  const isSoftwareGlRef = useRef<boolean>(false);
  const targetCamPosRef = useRef<THREE.Vector3 | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  const activeGlbUrl = uploadedGlbUrl || externalGlbUrl;
  const activeScaleUnitsPerCm = telemetry?.scaleUnitsPerCm || 0.1;
  const sceneHeightCm = initialRecon.dimensions.heightCm || material.dimensions?.heightCm || 20;
  const scaleCmPerUnit =
    (calibrationHeightCm || sceneHeightCm) /
    Math.max(0.1, (telemetry?.sceneDimensions.y || sceneHeightCm * activeScaleUnitsPerCm));

  // Reset state when inspecting a different material item
  useEffect(() => {
    const recon = ensureMaterialReconstruction(material);
    setCalibrationHeightCm(recon.dimensions.heightCm || material.dimensions?.heightCm || 20);
    setCaliperPoints([]);
    setMeasuredDistanceCm(null);
    setExplodedFactor(0);
    setSelectedPartId(null);
    setGlbLoadError(null);
    setGlbInspection(null);
    setUploadedGlbUrl((prev) => {
      if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    setModelSource(recon.imageTo3D?.glbUrl ? 'glb' : 'parametric');
  }, [material.id]);

  // Revoke local GLB blob URL on unmount
  useEffect(() => {
    return () => {
      if (uploadedGlbUrl && uploadedGlbUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedGlbUrl);
      }
    };
  }, [uploadedGlbUrl]);

  // Initialize WebGL Scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();
    isSoftwareGlRef.current = isSoftwareGl;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0xf8fafc);
    scene.fog = new THREE.FogExp2(0xf8fafc, 0.028);

    const width = container.clientWidth || 640;
    const clientHeight = container.clientHeight || 440;
    const camera = new THREE.PerspectiveCamera(45, width / clientHeight, 0.1, 100);
    camera.position.set(3.8, 2.8, 4.4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setSize(width, clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglContextLost(true);
    };
    const handleContextRestored = () => {
      setWebglContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 1.2;
    controls.maxDistance = 14;
    controlsRef.current = controls;

    // Studio 3-point lighting
    const keyLight = new THREE.DirectionalLight(0xfffcf5, 2.4);
    keyLight.position.set(5, 8, 5);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe0f2fe, 0.9);
    fillLight.position.set(-5, 4, 3);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xd1fae5, 1.3);
    rimLight.position.set(0, 6, -6);
    scene.add(rimLight);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xe2e8f0, 0.7));

    // Studio Grid & Contact Shadow
    const gridHelper = new THREE.GridHelper(10, 20, 0xcbd5e1, 0xe2e8f0);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const contactShadowGeo = new THREE.PlaneGeometry(5, 5);
    const contactShadowTex = getContactShadowTexture();
    const contactShadowMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = -0.004;
    scene.add(contactShadow);

    const modelGroup = new THREE.Group();
    modelGroupRef.current = modelGroup;
    scene.add(modelGroup);

    const dimGroup = new THREE.Group();
    dimGroupRef.current = dimGroup;
    scene.add(dimGroup);

    const measurementGroup = new THREE.Group();
    measurementGroupRef.current = measurementGroup;
    scene.add(measurementGroup);

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth || 640;
      const h = mountRef.current.clientHeight || 440;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      if (targetCamPosRef.current && cameraRef.current) {
        cameraRef.current.position.lerp(targetCamPosRef.current, 0.08);
        if (cameraRef.current.position.distanceTo(targetCamPosRef.current) < 0.04) {
          targetCamPosRef.current = null;
        }
      }
      if (controlsRef.current) controlsRef.current.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      disposeObject3D(modelGroup);
      disposeObject3D(dimGroup);
      disposeObject3D(measurementGroup);
      contactShadowGeo.dispose();
      contactShadowMat.dispose();
      if (!contactShadowTex.userData?.isSharedCache) {
        contactShadowTex.dispose();
      }
      envTarget.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Sync AutoRotate
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = isAutoRotating;
      controlsRef.current.autoRotateSpeed = 1.8;
    }
  }, [isAutoRotating]);

  // Build Parametric 3D or load GLB when material / source / photoTexture changes
  useEffect(() => {
    const modelGroup = modelGroupRef.current;
    const dimGroup = dimGroupRef.current;
    if (!modelGroup || !dimGroup) return;

    let cancelled = false;
    setIsLoadingModel(true);
    setGlbLoadError(null);

    const clearPrevious = () => {
      disposeObject3D(modelGroup);
      modelGroup.clear();
      disposeObject3D(dimGroup);
      dimGroup.clear();
      partsRef.current = [];
    };

    const recon = ensureMaterialReconstruction(material);

    const runBuild = async () => {
      const reconH = recon.dimensions.heightCm ?? material.dimensions?.heightCm ?? 20;
      const reconW = recon.dimensions.widthCm ?? material.dimensions?.widthCm ?? 7;
      const reconD = recon.dimensions.depthCm ?? material.dimensions?.lengthCm ?? reconW;

      const sampleGpuStats = () => {
        requestAnimationFrame(() => {
          const r = rendererRef.current;
          if (!r || cancelled) return;
          setGpuStats({
            calls: r.info.render.calls,
            triangles: r.info.render.triangles,
            textures: r.info.memory.textures,
          });
        });
      };

      const makeTagSprite = (label: string, bg: string) => {
        const canvas = document.createElement('canvas');
        canvas.width = 340;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.roundRect(6, 6, 328, 52, 14);
          ctx.fill();
          ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, 170, 32);
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
        sprite.scale.set(1.32, 0.25, 1);
        return sprite;
      };

      if (modelSource === 'compare' && activeGlbUrl) {
        try {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          const loader = new GLTFLoader();
          const [gltf, built] = await Promise.all([
            loader.loadAsync(activeGlbUrl),
            buildParametricReconstructionMesh({
              material,
              isSoftwareGl: isSoftwareGlRef.current,
              usePhotoTexture,
              qualityMode: qualityMode === 'raw' ? 'raw' : 'optimized',
            }),
          ]);
          if (cancelled) {
            disposeObject3D(gltf.scene);
            disposeObject3D(built.group);
            return;
          }

          clearPrevious();
          const glbRoot = gltf.scene;
          const glbInspect = inspectAndNormalizeGlbScene(glbRoot, {
            targetHeightCm: reconH,
            targetSceneHeightU: built.telemetry.sceneDimensions.y,
            scaleUnitsPerCm: built.telemetry.scaleUnitsPerCm,
            enableShadows: !isSoftwareGlRef.current,
          });
          if (qualityMode !== 'raw') {
            optimizeSceneForQualityAndPerformance(glbRoot, {
              isSoftwareGl: isSoftwareGlRef.current,
              materialType: recon.object.material,
            });
          }
          setGlbInspection(glbInspect);

          const spanX = Math.max(1.15, built.telemetry.sceneDimensions.x * 1.15);
          built.group.position.x = -spanX;
          glbRoot.position.x += spanX;

          const tagLeft = makeTagSprite('Parametric (Phase 4/6)', '#059669');
          tagLeft.position.set(-spanX, built.telemetry.sceneDimensions.y + 0.35, 0);
          const tagRight = makeTagSprite('Image-to-3D (.GLB)', '#4f46e5');
          tagRight.position.set(spanX, built.telemetry.sceneDimensions.y + 0.35, 0);

          modelGroup.add(built.group);
          modelGroup.add(glbRoot);
          modelGroup.add(tagLeft);
          modelGroup.add(tagRight);

          partsRef.current = built.parts;
          setPartsList(built.parts);
          setPhase3Validation(built.validation);
          setRefinementReport(built.refinementReport || null);
          setUvMetrics(built.uvMetrics || null);
          const combinedTel = validateBufferGeometry(modelGroup, built.parts);
          setTelemetry(combinedTel);
          setQualityValidation(
            validateModelQualityPhase6({
              root: built.group,
              recon: built.reconstruction,
              telemetry: built.telemetry,
              parts: built.parts,
              hasPhotoTexture: Boolean(built.textureCreated),
              refinementReport: built.refinementReport,
              uvMetrics: built.uvMetrics,
            })
          );

          applyRenderModeToGroup(modelGroup, renderMode);
          if (controlsRef.current) {
            controlsRef.current.target.set(0, built.telemetry.sceneDimensions.y / 2, 0);
            controlsRef.current.update();
          }
          setIsLoadingModel(false);
          sampleGpuStats();
          return;
        } catch (err) {
          if (cancelled) return;
          console.warn('Compare GLB failed, falling back to Parametric 3D:', err);
          setGlbLoadError('Không thể tải tệp GLB để so sánh — đang hiển thị mô hình Parametric 3D.');
        }
      }

      if (modelSource === 'glb' && activeGlbUrl) {
        try {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          const loader = new GLTFLoader();
          const gltf = await loader.loadAsync(activeGlbUrl);
          if (cancelled) {
            disposeObject3D(gltf.scene);
            return;
          }

          clearPrevious();
          const root = gltf.scene;
          const targetHeightU = Math.max(0.8, Math.min(3.2, reconH * 0.1));
          const glbInspect = inspectAndNormalizeGlbScene(root, {
            targetHeightCm: reconH,
            targetSceneHeightU: targetHeightU,
            scaleUnitsPerCm: targetHeightU / Math.max(1, reconH),
            enableShadows: !isSoftwareGlRef.current,
          });
          setGlbInspection(glbInspect);

          if (!glbInspect.valid) {
            disposeObject3D(root);
            throw new Error(glbInspect.issues[0] || 'GLB không hợp lệ');
          }

          if (qualityMode !== 'raw') {
            const opt = optimizeSceneForQualityAndPerformance(root, {
              isSoftwareGl: isSoftwareGlRef.current,
              materialType: recon.object.material,
            });
            setRefinementReport(opt.refinementReport);
            setUvMetrics(opt.uvMetrics);
          } else {
            setRefinementReport(null);
            setUvMetrics(null);
          }

          const glbParts: ParametricPartEntry[] = [];
          root.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              const dir = mesh.position.clone().normalize();
              if (dir.lengthSq() < 0.01) dir.set(0, 0.4, 0);
              glbParts.push({
                id: mesh.name || `mesh_${glbParts.length + 1}`,
                name: mesh.name || `mesh_${glbParts.length + 1}`,
                label: mesh.name || `Phần ${glbParts.length + 1}`,
                role: 'body',
                parentId: null,
                geometryMethod: 'buffer',
                mesh,
                basePos: mesh.position.clone(),
                explodeDir: dir,
              });
            }
          });

          modelGroup.add(root);
          partsRef.current = glbParts;
          setPartsList(glbParts);
          setPhase3Validation(null);

          const tel = validateBufferGeometry(modelGroup, glbParts);
          tel.scaleUnitsPerCm = targetHeightU / Math.max(1, reconH);
          setTelemetry(tel);
          setQualityValidation(
            validateModelQualityPhase6({
              root,
              recon,
              telemetry: tel,
              parts: glbParts,
              hasPhotoTexture: glbInspect.hasEmbeddedTextures,
            })
          );

          const finalSize = new THREE.Vector3();
          new THREE.Box3().setFromObject(modelGroup).getSize(finalSize);
          addDimensionLinesToGroup(
            dimGroup,
            finalSize.x,
            finalSize.y,
            finalSize.z,
            reconW,
            reconH,
            reconD,
            recon.geometry.geometryType === 'lathe'
          );

          applyRenderModeToGroup(modelGroup, renderMode);
          if (controlsRef.current) {
            controlsRef.current.target.set(0, finalSize.y / 2, 0);
            controlsRef.current.update();
          }
          setIsLoadingModel(false);
          sampleGpuStats();
          return;
        } catch (err: any) {
          if (cancelled) return;
          console.warn('GLB load failed, falling back to Parametric 3D:', err);
          setGlbLoadError(
            'Không thể tải tệp GLB — đang hiển thị mô hình Parametric 3D thay thế.'
          );
        }
      }

      // Phase 6 Before-vs-After Side-by-Side Comparison (Raw vs Optimized Parametric)
      if (qualityMode === 'compare_quality') {
        try {
          const [rawBuilt, optBuilt] = await Promise.all([
            buildParametricReconstructionMesh({
              material,
              isSoftwareGl: isSoftwareGlRef.current,
              usePhotoTexture,
              qualityMode: 'raw',
            }),
            buildParametricReconstructionMesh({
              material,
              isSoftwareGl: isSoftwareGlRef.current,
              usePhotoTexture,
              qualityMode: 'optimized',
            }),
          ]);
          if (cancelled) {
            disposeObject3D(rawBuilt.group);
            disposeObject3D(optBuilt.group);
            return;
          }

          clearPrevious();
          setGlbInspection(null);

          const spanX = Math.max(1.15, optBuilt.telemetry.sceneDimensions.x * 1.15);
          rawBuilt.group.position.x = -spanX;
          optBuilt.group.position.x = spanX;

          const usableRaw = rawBuilt.group.getObjectByName('usableZoneHighlight');
          if (usableRaw) usableRaw.visible = false;
          const usableOpt = optBuilt.group.getObjectByName('usableZoneHighlight');
          if (usableOpt) usableOpt.visible = false;

          const tagLeft = makeTagSprite('Bản gốc thô (Trước P6)', '#64748b');
          tagLeft.position.set(-spanX, optBuilt.telemetry.sceneDimensions.y + 0.35, 0);
          const tagRight = makeTagSprite('Bản Tối ưu PBR (Phase 6)', '#059669');
          tagRight.position.set(spanX, optBuilt.telemetry.sceneDimensions.y + 0.35, 0);

          modelGroup.add(rawBuilt.group, optBuilt.group, tagLeft, tagRight);
          partsRef.current = optBuilt.parts;
          setPartsList(optBuilt.parts);
          setPhase3Validation(optBuilt.validation);
          setTelemetry(optBuilt.telemetry);
          setRefinementReport(optBuilt.refinementReport || null);
          setUvMetrics(optBuilt.uvMetrics || null);
          setQualityValidation(
            validateModelQualityPhase6({
              root: optBuilt.group,
              recon: optBuilt.reconstruction,
              telemetry: optBuilt.telemetry,
              parts: optBuilt.parts,
              hasPhotoTexture: Boolean(optBuilt.textureCreated),
              refinementReport: optBuilt.refinementReport,
              uvMetrics: optBuilt.uvMetrics,
            })
          );

          applyRenderModeToGroup(modelGroup, renderMode);
          if (controlsRef.current) {
            controlsRef.current.target.set(0, optBuilt.telemetry.sceneDimensions.y / 2, 0);
            controlsRef.current.update();
          }
          sampleGpuStats();
          return;
        } finally {
          if (!cancelled) setIsLoadingModel(false);
        }
      }

      // Parametric 3D reconstruction path (raw OR optimized)
      setGlbInspection(null);
      try {
        const built = await buildParametricReconstructionMesh({
          material,
          isSoftwareGl: isSoftwareGlRef.current,
          usePhotoTexture,
          qualityMode: qualityMode === 'raw' ? 'raw' : 'optimized',
        });
        if (cancelled) {
          disposeObject3D(built.group);
          return;
        }

        clearPrevious();
        modelGroup.add(built.group);
        partsRef.current = built.parts;
        setPartsList(built.parts);
        setPhase3Validation(built.validation);
        setTelemetry(built.telemetry);
        setRefinementReport(built.refinementReport || null);
        setUvMetrics(built.uvMetrics || null);
        setQualityValidation(
          validateModelQualityPhase6({
            root: built.group,
            recon: built.reconstruction,
            telemetry: built.telemetry,
            parts: built.parts,
            hasPhotoTexture: Boolean(built.textureCreated),
            refinementReport: built.refinementReport,
            uvMetrics: built.uvMetrics,
          })
        );

        const usableMesh = modelGroup.getObjectByName('usableZoneHighlight');
        if (usableMesh) usableMesh.visible = showUsableZone;

        addDimensionLinesToGroup(
          dimGroup,
          built.telemetry.sceneDimensions.x,
          built.telemetry.sceneDimensions.y,
          built.telemetry.sceneDimensions.z,
          built.reconstruction.dimensions.widthCm ?? 7,
          built.reconstruction.dimensions.heightCm ?? 20,
          built.reconstruction.dimensions.depthCm ?? 7,
          built.reconstruction.geometry.geometryType === 'lathe'
        );

        applyRenderModeToGroup(modelGroup, renderMode);

        if (controlsRef.current) {
          controlsRef.current.target.set(0, built.telemetry.sceneDimensions.y / 2, 0);
          controlsRef.current.update();
        }
        sampleGpuStats();
      } finally {
        if (!cancelled) setIsLoadingModel(false);
      }
    };

    runBuild();
    return () => {
      cancelled = true;
    };
  }, [material, modelSource, activeGlbUrl, usePhotoTexture, qualityMode]);

  // Update render mode in-place
  useEffect(() => {
    if (modelGroupRef.current) {
      applyRenderModeToGroup(modelGroupRef.current, renderMode);
    }
  }, [renderMode]);

  // Update Exploded View
  useEffect(() => {
    partsRef.current.forEach((p) => {
      p.mesh.position.copy(p.basePos).addScaledVector(p.explodeDir, explodedFactor * 0.85);
    });
  }, [explodedFactor]);

  // Sync Dimension & Usable Zone visibility
  useEffect(() => {
    if (dimGroupRef.current) dimGroupRef.current.visible = showDimensions;
    const usable = modelGroupRef.current?.getObjectByName('usableZoneHighlight');
    if (usable) usable.visible = showUsableZone;
  }, [showDimensions, showUsableZone]);

  // Highlight selected component part inside Three.js scene
  useEffect(() => {
    partsRef.current.forEach((p) => {
      const isSelected = selectedPartId !== null && p.id === selectedPartId;
      p.mesh.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || mesh.name === 'usableZoneHighlight') return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const stdMat = m as THREE.MeshStandardMaterial;
          if (!stdMat || !('emissive' in stdMat) || !stdMat.emissive) continue;
          if (isSelected) {
            stdMat.emissive.setHex(0x10b981);
            stdMat.emissiveIntensity = 0.4;
          } else {
            stdMat.emissive.setHex(0x000000);
            stdMat.emissiveIntensity = 0;
          }
        }
      });
    });
  }, [selectedPartId]);

  const handleApplyLiveResize = () => {
    setShowCalibrationModal(false);
    const modelGroup = modelGroupRef.current;
    const dimGroup = dimGroupRef.current;
    if (!modelGroup || !dimGroup) return;

    const recon = ensureMaterialReconstruction(material);
    const origH = Math.max(1, recon.dimensions.heightCm || material.dimensions?.heightCm || 20);
    const ratio = calibrationHeightCm / origH;
    const newW = Number(((recon.dimensions.widthCm || 7) * ratio).toFixed(2));
    const newD = Number(((recon.dimensions.depthCm || newW) * ratio).toFixed(2));
    const scaleU = telemetry?.scaleUnitsPerCm || 0.1;

    const nextTel = resizeReconstructedModel(modelGroup, calibrationHeightCm, newW, newD, scaleU);
    setTelemetry(nextTel);

    disposeObject3D(dimGroup);
    dimGroup.clear();
    addDimensionLinesToGroup(
      dimGroup,
      nextTel.sceneDimensions.x,
      nextTel.sceneDimensions.y,
      nextTel.sceneDimensions.z,
      newW,
      calibrationHeightCm,
      newD,
      recon.geometry.geometryType === 'lathe'
    );

    if (controlsRef.current) {
      controlsRef.current.target.set(0, nextTel.sceneDimensions.y / 2, 0);
      controlsRef.current.update();
    }
  };

  // Caliper Points Raycast with drag-threshold guard
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleCanvasPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isCaliperActive || !mountRef.current || !cameraRef.current || !modelGroupRef.current) {
        return;
      }
      if (pointerDownPosRef.current) {
        const dx = e.clientX - pointerDownPosRef.current.x;
        const dy = e.clientY - pointerDownPosRef.current.y;
        pointerDownPosRef.current = null;
        if (Math.hypot(dx, dy) > 6) return; // Ignore orbit drags
      }

      const rect = mountRef.current.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);

      const meshes: THREE.Mesh[] = [];
      modelGroupRef.current.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj.name !== 'usableZoneHighlight') {
          meshes.push(obj as THREE.Mesh);
        }
      });

      const intersects = raycaster.intersectObjects(meshes, false);
      if (intersects.length > 0) {
        const hitPoint = intersects[0].point.clone();
        setCaliperPoints((prev) => {
          const next =
            prev.length >= 2
              ? [{ position: hitPoint, label: 'P1' }]
              : [...prev, { position: hitPoint, label: `P${prev.length + 1}` }];
          if (next.length === 2) {
            const distUnits = next[0].position.distanceTo(next[1].position);
            setMeasuredDistanceCm(Number((distUnits * scaleCmPerUnit).toFixed(1)));
          } else {
            setMeasuredDistanceCm(null);
          }
          return next;
        });
      }
    },
    [isCaliperActive, scaleCmPerUnit]
  );

  // Sync Caliper markers & dispose old geometries/materials cleanly
  useEffect(() => {
    const group = measurementGroupRef.current;
    if (!group) return;
    disposeObject3D(group);
    group.clear();

    caliperPoints.forEach((pt) => {
      const markerGeo = new THREE.SphereGeometry(0.055, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.copy(pt.position);
      group.add(marker);
    });

    if (caliperPoints.length === 2) {
      const p1 = caliperPoints[0].position;
      const p2 = caliperPoints[1].position;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xf43f5e });
      group.add(new THREE.Line(lineGeo, lineMat));
    }
  }, [caliperPoints]);

  // Camera view presets
  const focusPreset = (preset: 'front' | 'side' | 'top' | 'iso') => {
    const yMid = (telemetry?.sceneDimensions.y || 2.0) / 2;
    if (controlsRef.current) controlsRef.current.target.set(0, yMid, 0);
    if (preset === 'front') targetCamPosRef.current = new THREE.Vector3(0, yMid, 4.6);
    else if (preset === 'side') targetCamPosRef.current = new THREE.Vector3(4.6, yMid, 0);
    else if (preset === 'top') targetCamPosRef.current = new THREE.Vector3(0, 5.2, 0.01);
    else targetCamPosRef.current = new THREE.Vector3(3.8, 2.8, 4.4);
  };

  // Upload custom local GLB file (verifying binary magic header 0x46546C67)
  const handleUploadGlb = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await file.slice(0, 12).arrayBuffer();
      const view = new DataView(buf);
      const magic = view.byteLength >= 4 ? view.getUint32(0, true) : 0;
      if (magic !== 0x46546c67 && !file.name.toLowerCase().endsWith('.gltf')) {
        setGlbLoadError('Tệp không hợp lệ: Chỉ hỗ trợ chuẩn nhị phân .glb (header glTF) hoặc .gltf.');
        return;
      }
      const nextUrl = URL.createObjectURL(file);
      setUploadedGlbUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return nextUrl;
      });
      setGlbLoadError(null);
      setModelSource('glb');
    } catch {
      setGlbLoadError('Không thể đọc tệp 3D được chọn.');
    }
  };

  // Export scene to GLB
  const handleExportGLB = async () => {
    if (!modelGroupRef.current) return;
    setExportingGlb(true);
    try {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      exporter.parse(
        modelGroupRef.current,
        (result) => {
          const blob =
            result instanceof ArrayBuffer
              ? new Blob([result], { type: 'model/gltf-binary' })
              : new Blob([JSON.stringify(result)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${material.name.replace(/\s+/g, '_').toLowerCase()}_3d_scan.glb`;
          link.click();
          URL.revokeObjectURL(url);
          setExportingGlb(false);
        },
        (err) => {
          console.error('Export GLB error:', err);
          setExportingGlb(false);
        },
        { binary: true }
      );
    } catch (err) {
      console.error('Load GLTFExporter error:', err);
      setExportingGlb(false);
    }
  };

  return (
    <div
      className={`flex flex-col rounded-3xl overflow-hidden bg-white border border-slate-200 shadow-lg ${
        isZenMode ? 'fixed inset-0 z-50 rounded-none border-none' : ''
      }`}
    >
      {/* Top Toolbar (No backdrop-blur over WebGL canvas) */}
      <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold tracking-wide uppercase flex items-center gap-2 flex-wrap">
              <span>Scanner 3D Tham Số & Hình Học</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px]">
                {modelSource === 'compare' && activeGlbUrl
                  ? 'So sánh Parametric ↔ GLB'
                  : modelSource === 'glb' && activeGlbUrl
                  ? 'GLB Mesh'
                  : `Parametric: ${initialRecon.geometry.geometryType}`}
              </span>
            </h4>
            <p className="text-[11px] text-slate-400 truncate max-w-[260px] sm:max-w-md">
              {material.name} ({initialRecon.object.material})
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Parametric vs GLB vs Compare switcher */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-[11px]">
            <button
              type="button"
              onClick={() => setModelSource('parametric')}
              className={`px-2 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer ${
                modelSource === 'parametric' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
              title="Mô hình Parametric 3D dựng theo hình dáng & kích thước thực tế"
            >
              <Box className="w-3 h-3" />
              <span>Parametric</span>
            </button>
            <button
              type="button"
              onClick={() => activeGlbUrl && setModelSource('glb')}
              disabled={!activeGlbUrl}
              className={`px-2 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40 ${
                modelSource === 'glb' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
              title={activeGlbUrl ? 'Hiển thị mô hình Mesh GLB' : 'Chưa có file GLB — có thể tải lên tệp .glb'}
            >
              <Cpu className="w-3 h-3" />
              <span>GLB 3D</span>
            </button>
            <button
              type="button"
              onClick={() => activeGlbUrl && setModelSource('compare')}
              disabled={!activeGlbUrl}
              className={`px-2 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40 ${
                modelSource === 'compare' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
              title={activeGlbUrl ? 'Đặt Parametric (Phase 4) & GLB 3D cạnh nhau để đối chiếu' : 'Cần có GLB để bật chế độ so sánh song song'}
            >
              <span>So sánh</span>
            </button>
          </div>

          <label
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            title="Nạp tệp mô hình .glb từ máy"
          >
            <Upload className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Nạp .GLB</span>
            <input type="file" accept=".glb,.gltf" className="hidden" onChange={handleUploadGlb} />
          </label>

          {/* Render Mode Switcher */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-[11px]">
            <button
              type="button"
              onClick={() => setRenderMode('realistic')}
              className={`px-2 py-1 rounded-md font-medium cursor-pointer ${
                renderMode === 'realistic' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Thật
            </button>
            <button
              type="button"
              onClick={() => setRenderMode('wireframe')}
              className={`px-2 py-1 rounded-md font-medium cursor-pointer ${
                renderMode === 'wireframe' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Lưới
            </button>
            <button
              type="button"
              onClick={() => setRenderMode('xray')}
              className={`px-2 py-1 rounded-md font-medium cursor-pointer ${
                renderMode === 'xray' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              X-Quang
            </button>
          </div>

          {/* Phase 6 Quality Enhancement Mode (Raw vs Optimized vs Side-by-Side) */}
          <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-700 text-[11px]">
            <button
              type="button"
              onClick={() => setQualityMode('optimized')}
              className={`px-2 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer ${
                qualityMode === 'optimized' ? 'bg-teal-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
              title="Bật PBR + Normal/Roughness Map + Tinh chỉnh lưới & UV Phase 6"
            >
              <Sparkles className="w-3 h-3" />
              <span>Tối ưu P6</span>
            </button>
            <button
              type="button"
              onClick={() => setQualityMode('raw')}
              className={`px-2 py-1 rounded-md font-medium cursor-pointer ${
                qualityMode === 'raw' ? 'bg-slate-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
              title="Xem bản gốc thô trước tinh chỉnh Phase 6"
            >
              Gốc thô
            </button>
            <button
              type="button"
              onClick={() => {
                setModelSource('parametric');
                setQualityMode('compare_quality');
              }}
              className={`px-2 py-1 rounded-md font-semibold cursor-pointer ${
                qualityMode === 'compare_quality' ? 'bg-amber-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
              title="So sánh song song Gốc thô ↔ Bản Tối ưu Phase 6"
            >
              Gốc↔P6
            </button>
          </div>

          {/* Photo UV texture toggle */}
          <button
            type="button"
            onClick={() => setUsePhotoTexture((p) => !p)}
            className={`p-1.5 rounded-lg border text-xs transition cursor-pointer ${
              usePhotoTexture
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title="Bật/tắt phủ ảnh chụp thật lên bề mặt 3D"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          {/* Toggle Corner Reference Photo Comparison */}
          {(initialRecon.segmentation.croppedObjectUrl || material.images?.[0]) && (
            <button
              type="button"
              onClick={() => setShowReferenceThumb((s) => !s)}
              className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition cursor-pointer ${
                showReferenceThumb
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="So sánh nhanh với ảnh vật thể gốc ở góc khung hình"
            >
              Đối chiếu ảnh
            </button>
          )}

          {/* Caliper Measurement */}
          <button
            type="button"
            onClick={() => {
              setIsCaliperActive(!isCaliperActive);
              if (isCaliperActive) {
                setCaliperPoints([]);
                setMeasuredDistanceCm(null);
              }
            }}
            className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition cursor-pointer ${
              isCaliperActive
                ? 'bg-rose-600 border-rose-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Thước kẹp 3D: Chạm 2 điểm trên mô hình để đo (cm)"
          >
            <Crosshair className="w-4 h-4" />
            <span className="hidden sm:inline font-semibold">Thước đo 3D</span>
          </button>

          {/* Calibration */}
          <button
            type="button"
            onClick={() => setShowCalibrationModal(!showCalibrationModal)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition cursor-pointer"
            title="Hiệu chuẩn chiều cao thực (cm)"
          >
            <Ruler className="w-4 h-4 text-amber-400" />
          </button>

          {/* Toggles */}
          <button
            type="button"
            onClick={() => setShowDimensions(!showDimensions)}
            className={`p-1.5 rounded-lg border text-xs transition cursor-pointer ${
              showDimensions
                ? 'bg-slate-700 border-slate-600 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Hiện đường kích thước XYZ"
          >
            <Grid className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowUsableZone(!showUsableZone)}
            className={`p-1.5 rounded-lg border text-xs transition cursor-pointer ${
              showUsableZone
                ? 'bg-slate-700 border-slate-600 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Vùng cắt tối ưu"
          >
            <Layers className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsAutoRotating(!isAutoRotating)}
            className={`p-1.5 rounded-lg border text-xs transition cursor-pointer ${
              isAutoRotating
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}
            title="Tự động xoay"
          >
            {isAutoRotating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={handleExportGLB}
            disabled={exportingGlb}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition cursor-pointer"
            title="Xuất mô hình 3D (.glb)"
          >
            <Download className="w-4 h-4 text-sky-400" />
          </button>

          <button
            type="button"
            onClick={() => setIsZenMode(!isZenMode)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition cursor-pointer"
            title={isZenMode ? 'Thu nhỏ' : 'Toàn màn hình'}
          >
            {isZenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Viewport Container */}
      <div className="relative bg-slate-50" style={{ height: isZenMode ? 'calc(100vh - 110px)' : height }}>
        <div
          ref={mountRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerUp={handleCanvasPointerUp}
          className={`w-full h-full touch-none select-none ${
            isCaliperActive ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
          }`}
        />

        {webglContextLost && (
          <div
            role="alert"
            className="absolute inset-0 z-30 bg-slate-900/90 text-white flex flex-col items-center justify-center p-6 text-center gap-3"
          >
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-sm font-bold">Ngữ cảnh WebGL tạm thời bị ngắt</p>
            <p className="text-xs text-slate-300 max-w-sm">
              Trình duyệt vừa giải phóng bộ nhớ WebGL. Nhấn khôi phục để tiếp tục kiểm tra mô hình 3D.
            </p>
            <button
              type="button"
              onClick={() => {
                const ctx = rendererRef.current?.getContext();
                ctx?.getExtension('WEBGL_lose_context')?.restoreContext?.();
                setWebglContextLost(false);
              }}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white cursor-pointer"
            >
              Khôi phục khung 3D
            </button>
          </div>
        )}

        {isLoadingModel && (
          <div className="absolute inset-0 bg-slate-50/90 flex items-center justify-center text-xs font-bold text-slate-700 z-10 pointer-events-none">
            Đang dựng lưới hình học 3D & áp chất liệu...
          </div>
        )}

        {glbLoadError && (
          <div className="absolute top-3 left-3 right-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-3 py-2 text-xs flex items-center gap-2 z-20">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{glbLoadError}</span>
          </div>
        )}

        {/* Solid opaque Camera Angle Presets HUD (no backdrop-blur over WebGL) */}
        <div className="absolute top-3 left-3 flex flex-col gap-1 z-10">
          <button
            type="button"
            onClick={() => focusPreset('iso')}
            className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[10px] font-bold text-slate-700 hover:bg-emerald-50 shadow-xs transition cursor-pointer"
          >
            3D Iso
          </button>
          <button
            type="button"
            onClick={() => focusPreset('front')}
            className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[10px] font-bold text-slate-700 hover:bg-emerald-50 shadow-xs transition cursor-pointer"
          >
            Trước
          </button>
          <button
            type="button"
            onClick={() => focusPreset('side')}
            className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[10px] font-bold text-slate-700 hover:bg-emerald-50 shadow-xs transition cursor-pointer"
          >
            Cạnh
          </button>
          <button
            type="button"
            onClick={() => focusPreset('top')}
            className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[10px] font-bold text-slate-700 hover:bg-emerald-50 shadow-xs transition cursor-pointer"
          >
            Trên
          </button>
        </div>

        {/* Geometry Telemetry HUD */}
        {telemetry && (
          <div className="absolute top-3 right-3 bg-white border border-slate-300 rounded-xl px-3 py-2 text-[10px] text-slate-700 shadow-xs z-10 space-y-0.5 max-w-[205px]">
            <div className="font-bold text-slate-900 flex items-center justify-between gap-2">
              <span>Lưới 3D Thực tế</span>
              <span className={telemetry.valid ? 'text-emerald-600' : 'text-rose-600'}>
                {telemetry.valid ? 'OK' : 'Lỗi'}
              </span>
            </div>
            <p>
              {telemetry.vertexCount.toLocaleString()} đỉnh • {telemetry.triangleCount.toLocaleString()} tam giác
            </p>
            <p className="text-slate-500">
              {telemetry.meshCount} bộ phận • {(telemetry.estimatedGpuBytes / 1024).toFixed(1)} KB
            </p>
            {telemetry.geometryMethodsUsed.length > 0 && (
              <p className="text-emerald-700 font-semibold truncate">
                Engine: {telemetry.geometryMethodsUsed.join(' + ')}
              </p>
            )}
            {glbInspection && (
              <div className="pt-1 mt-1 border-t border-slate-200 text-[9px] text-indigo-700 space-y-0.5">
                <p className="font-bold">
                  GLB: {glbInspection.materialCount} mat • {glbInspection.textureCount} tex
                </p>
                {glbInspection.boundingBoxCm && (
                  <p className="text-slate-500">
                    Box: {glbInspection.boundingBoxCm.x}×{glbInspection.boundingBoxCm.y}×{glbInspection.boundingBoxCm.z} cm
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Small Corner Reference Thumbnail for Visual Comparison */}
        {showReferenceThumb && (initialRecon.segmentation.croppedObjectUrl || material.images?.[0]) && (
          <div className="absolute bottom-14 right-3 bg-white border border-slate-300 rounded-xl p-1.5 shadow-md z-10 w-24">
            <img
              src={initialRecon.segmentation.croppedObjectUrl || material.images?.[0]}
              alt="Ảnh đối chiếu"
              className="w-full h-20 object-contain rounded-lg bg-slate-100"
            />
            <span className="block text-[9px] text-center font-semibold text-slate-600 mt-1">
              Ảnh gốc tách nền
            </span>
          </div>
        )}

        {/* Active Caliper HUD */}
        {isCaliperActive && (
          <div className="absolute top-24 right-3 w-64 p-3 rounded-2xl bg-slate-900 text-white text-xs shadow-xl border border-slate-700 space-y-2 z-20">
            <div className="flex items-center justify-between">
              <span className="font-bold text-rose-400 flex items-center gap-1">
                <Crosshair className="w-3.5 h-3.5" />
                <span>Thước Kẹp 3D</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setCaliperPoints([]);
                  setMeasuredDistanceCm(null);
                }}
                className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Xóa</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-300">
              {caliperPoints.length === 0
                ? 'Nhấn vào điểm thứ nhất trên vật thể 3D'
                : caliperPoints.length === 1
                ? 'Nhấn vào điểm thứ hai để đo khoảng cách'
                : 'Khoảng cách đo được:'}
            </p>
            {measuredDistanceCm !== null && (
              <div className="p-2 rounded-xl bg-rose-500/20 border border-rose-500/40 text-center">
                <span className="text-lg font-extrabold text-rose-300">{measuredDistanceCm} cm</span>
                <span className="text-[10px] text-slate-300 block">
                  (~{Math.round(measuredDistanceCm * 10)} mm)
                </span>
              </div>
            )}
          </div>
        )}

        {/* Calibration Modal */}
        {showCalibrationModal && (
          <div className="absolute inset-0 bg-slate-900/45 flex items-center justify-center z-30 p-4">
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-3 border border-slate-200 text-xs">
              <div className="flex items-center justify-between">
                <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Ruler className="w-4 h-4 text-emerald-600" />
                  <span>Hiệu chuẩn kích thước 3D</span>
                </h5>
                <button
                  type="button"
                  onClick={() => setShowCalibrationModal(false)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <p className="text-slate-600">
                Nhập chiều cao đo được bằng thước ngoài đời thật để quy đổi chính xác số đo thước kẹp 3D:
              </p>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Chiều cao thực tế (cm):</label>
                <input
                  type="number"
                  step="0.5"
                  value={calibrationHeightCm}
                  onChange={(e) => setCalibrationHeightCm(parseFloat(e.target.value) || 20)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-slate-900 font-bold"
                />
              </div>
              <button
                type="button"
                onClick={handleApplyLiveResize}
                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold cursor-pointer"
              >
                Xác nhận & Co giãn mô hình 3D
              </button>
            </div>
          </div>
        )}

        {/* Bottom Exploded Slider + Reset HUD */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pointer-events-none z-10">
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-300 shadow-xs text-[11px] text-slate-700">
            <Sliders className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="font-semibold whitespace-nowrap">Tách lớp:</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={explodedFactor}
              onChange={(e) => setExplodedFactor(parseFloat(e.target.value))}
              className="w-24 sm:w-32 accent-emerald-600 cursor-pointer"
            />
            <span className="font-mono text-[10px] w-8 text-right">
              {Math.round(explodedFactor * 100)}%
            </span>
          </div>

          <div className="pointer-events-auto flex items-center justify-between sm:justify-end gap-2">
            <span className="text-[11px] bg-white border border-slate-300 px-3 py-1 rounded-full text-slate-700 shadow-xs flex items-center gap-1">
              <Info className="w-3 h-3 text-emerald-600" />
              <span>Kéo xoay 360° • Cuộn thu phóng</span>
            </span>

            <button
              type="button"
              onClick={() => focusPreset('iso')}
              className="p-2 rounded-full bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 shadow-xs transition cursor-pointer"
              title="Khôi phục góc nhìn"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Multi-Component Hierarchy & Phase 6 Validation / Optimization Summary */}
      {(partsList.length > 0 ||
        (phase3Validation && phase3Validation.uncertainties.length > 0) ||
        refinementReport ||
        qualityValidation) && (
        <div className="bg-white px-4 py-2.5 border-t border-slate-200 space-y-2 text-[11px]">
          {partsList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-700 mr-1">Cấu trúc bộ phận (chạm để soi):</span>
              {partsList.map((part) => {
                const isSelected = selectedPartId === part.id;
                return (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => setSelectedPartId(isSelected ? null : part.id)}
                    className={`px-2 py-0.5 rounded-md border font-medium flex items-center gap-1 cursor-pointer transition ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-emerald-50'
                    }`}
                  >
                    {part.parentId && <span className="opacity-65">↳</span>}
                    <span>{part.label}</span>
                    <span className={`text-[9px] px-1 rounded ${isSelected ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-600'}`}>
                      {part.geometryMethod}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {refinementReport && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] bg-teal-50 border border-teal-200 text-teal-900 rounded-lg px-2.5 py-1.5">
              <span className="font-bold text-teal-800 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>Tối ưu Phase 6:</span>
              </span>
              <span>
                Tam giác suy biến: <strong>{refinementReport.before.degenerateTriangles} → {refinementReport.after.degenerateTriangles}</strong>
              </span>
              <span>•</span>
              <span>
                UV chuẩn [0..1]: <strong>{Math.round(refinementReport.after.uvCoverageRatio * 100)}%</strong>
              </span>
              {uvMetrics && (
                <>
                  <span>•</span>
                  <span>
                    Chống méo UV: <strong>{Math.round(uvMetrics.stretchDistortionScore * 100)}%</strong>
                  </span>
                </>
              )}
              <span>•</span>
              <span>
                Bảo toàn tỷ lệ: <strong>{Math.round(refinementReport.proportionsPreservedRatio * 100)}%</strong>
              </span>
              <span>•</span>
              <span>{refinementReport.materialsEnhanced} vật liệu PBR</span>
            </div>
          )}

          {qualityValidation && (
            <div className="text-[10px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Kiểm chứng Phase 6:</strong> {qualityValidation.summary}
              </span>
              {qualityValidation.overallScore !== null && (
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                  Điểm thực: {Math.round(qualityValidation.overallScore * 100)}% ({qualityValidation.availableMetricsCount}/6)
                </span>
              )}
            </div>
          )}

          {phase3Validation && phase3Validation.uncertainties.length > 0 && (
            <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Độ bất định hình học:</strong> {phase3Validation.uncertainties.join(' • ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Bottom Footer Status Bar */}
      <div className="bg-slate-50 px-4 py-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>
              Vật liệu: <strong>{initialRecon.object.material}</strong> (tin cậy{' '}
              {Math.round((initialRecon.object.materialConfidence || 0.7) * 100)}%)
            </span>
          </span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">
            Phương pháp đo: <strong>{initialRecon.dimensions.measurementMethod}</strong>
          </span>
          {gpuStats && (
            <>
              <span className="hidden md:inline">•</span>
              <span className="hidden md:inline font-mono text-[10px] text-slate-500">
                WebGL: {gpuStats.calls} calls • {gpuStats.triangles} tris • {gpuStats.textures} tex
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-slate-500" />
          <span>
            {renderMode === 'realistic' ? 'Thật PBR' : renderMode === 'wireframe' ? 'Lưới đa giác' : 'X-Quang'}
            {' • '}
            {qualityMode === 'raw' ? 'Gốc thô' : qualityMode === 'compare_quality' ? 'So sánh Gốc↔P6' : 'Tối ưu P6'}
          </span>
        </div>
      </div>
    </div>
  );
};
