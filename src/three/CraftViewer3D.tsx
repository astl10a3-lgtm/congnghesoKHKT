import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Pause,
  Play,
  RotateCcw,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Sparkles,
  Download,
  Info,
  X,
  Layers,
  Wrench,
  ShieldAlert,
  Compass,
  CheckCircle2,
  Split,
  RefreshCw,
  Camera,
  Sun,
  Lightbulb,
  Check,
  Palette,
  Heart,
  Box,
  Cpu,
  Upload,
  AlertTriangle,
  Grid,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Crosshair,
  GitBranch,
  ListChecks,
  ZoomIn,
  ZoomOut,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { CraftProduct, CraftStep, MaterialItem } from '../../server/db';
import {
  createRecycledPETMaterial,
  createHandCutLipMaterial,
  createHDPECapMaterial,
  createHotGlueMaterial,
  createBambooAxleMaterial,
  createPottingSoilMaterial,
  createKraftCardboardMaterial,
  createBrushedAluminumMaterial,
  createGlassMaterial,
  createLushLeafMaterial,
  createWarmLanternLightMaterial,
  createBirdSeedMaterial,
  createPencilLacquerMaterial,
  createHydroponicLECAMaterial,
  createRusticWireMaterial,
} from './photorealisticMaterials';
import {
  getContactShadowTexture,
  getWorkshopWoodFloorTexture,
} from './photorealisticTextures';
import { normalizeHexColor, type GlbInspectionReport } from '../types/reconstruction';
import type {
  AssemblySimulationPlan,
  ComponentSeparationDistance,
  InteractiveComponent3D,
  Vec3Tuple,
} from '../types/assembly';
import {
  buildAssemblySimulationPlan,
  computeSeparationDistances,
  extractComponentHierarchy,
  resolveMatchingComponentIdsForGuideStep,
  type ComponentRuntimeEntry,
  type SubpartRegistration,
} from './ComponentAssemblyManager';
import {
  buildParametricReconstructionMesh,
  disposeObject3D,
  ensureMaterialReconstruction,
  inspectAndNormalizeGlbScene,
  optimizeSceneForQualityAndPerformance,
  type GeometryRefinementReport,
  type ParametricPartEntry,
} from './GeometryReconstructionEngine';

interface CraftViewer3DProps {
  craft: CraftProduct;
  sourceMaterial?: MaterialItem | null;
  currentStepIndex: number;
  onStepChange?: (index: number) => void;
  height?: string;
  activeGuideStep?: CraftStep;
  highlightComponentIds?: string[];
  onComponentSelect?: (component: InteractiveComponent3D | null) => void;
}

// Pre-allocated scratch math for zero per-frame allocations inside animate()
const _scratchVecA = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchTargetPos = new THREE.Vector3();
const _scratchWorldA = new THREE.Vector3();
const _scratchWorldB = new THREE.Vector3();
const _scratchBox3 = new THREE.Box3();
const _scratchCenter = new THREE.Vector3();
const _scratchSize = new THREE.Vector3();
const _scratchRaycaster = new THREE.Raycaster();
const _scratchPointerNdc = new THREE.Vector2();
const MAX_SEPARATION_LINES = 64;

interface ComponentHotspot {
  id: string;
  name: string;
  material: string;
  role: string;
  howToMake: string;
  safetyNotice: string;
  position: THREE.Vector3;
}

export type StudioBackdrop = 'studio_white' | 'workshop_wood' | 'studio_dark';
export type LightingMode = 'soft_studio' | 'natural_sun' | 'dramatic_rim';
export type CraftViewMode = 'craft' | 'source_parametric' | 'source_glb' | 'compare_glb';

export const CraftViewer3D: React.FC<CraftViewer3DProps> = ({
  craft,
  sourceMaterial = null,
  currentStepIndex,
  onStepChange,
  height = '480px',
  activeGuideStep,
  highlightComponentIds = [],
  onComponentSelect,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [explodedFactor, setExplodedFactor] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isAutoRotating, setIsAutoRotating] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [selectedHotspot, setSelectedHotspot] = useState<ComponentHotspot | null>(null);
  const [exportingGlb, setExportingGlb] = useState(false);

  // Photorealistic Studio Controls
  const [studioBackdrop, setStudioBackdrop] = useState<StudioBackdrop>('studio_white');
  const [lightingMode, setLightingMode] = useState<LightingMode>('soft_studio');
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null);
  const [showDecorations, setShowDecorations] = useState(true);

  // Phase 5 & 6 Interactive Quality, Wireframe, Texture & Comparison Controls
  const [craftViewMode, setCraftViewMode] = useState<CraftViewMode>('craft');
  const [qualityEnhancement, setQualityEnhancement] = useState<'optimized' | 'raw' | 'compare_quality'>('optimized');
  const [wireframeMode, setWireframeMode] = useState<boolean>(false);
  const [texturesEnabled, setTexturesEnabled] = useState<boolean>(true);
  const [uploadedGlbUrl, setUploadedGlbUrl] = useState<string | null>(null);
  const [glbInspection, setGlbInspection] = useState<GlbInspectionReport | null>(null);
  const [refinementSummary, setRefinementSummary] = useState<GeometryRefinementReport | null>(null);
  const [gpuStats, setGpuStats] = useState<{ calls: number; triangles: number; textures: number } | null>(null);
  const [glbError, setGlbError] = useState<string | null>(null);
  const [webglContextLost, setWebglContextLost] = useState<boolean>(false);
  const isSoftwareGlRef = useRef<boolean>(false);

  // Phase 8 Interactive Component Hierarchy & Assembly Simulation States
  const [components3D, setComponents3D] = useState<InteractiveComponent3D[]>([]);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [hiddenComponentIds, setHiddenComponentIds] = useState<string[]>([]);
  const [assemblyPlan, setAssemblyPlan] = useState<AssemblySimulationPlan | null>(null);
  const [assemblyModeActive, setAssemblyModeActive] = useState<boolean>(false);
  const [assemblyStepIdx, setAssemblyStepIdx] = useState<number>(0);
  const [assemblyPlaying, setAssemblyPlaying] = useState<boolean>(false);
  const [completedAssemblyStepIds, setCompletedAssemblyStepIds] = useState<string[]>([]);
  const [phase8PanelTab, setPhase8PanelTab] = useState<'components' | 'assembly'>('components');
  const [separationDistances, setSeparationDistances] = useState<ComponentSeparationDistance[]>([]);

  const attachedGlbUrl = sourceMaterial?.reconstruction?.imageTo3D?.glbUrl || null;
  const activeSourceGlbUrl = uploadedGlbUrl || attachedGlbUrl;

  const safeSteps: CraftStep[] =
    craft.steps && craft.steps.length > 0
      ? craft.steps
      : [
          {
            stepNumber: 1,
            title: 'Mô hình tổng quan sản phẩm',
            description: 'Mô hình 3D hoàn chỉnh được dựng từ vật liệu tái chế thực tế.',
            materialsNeeded: craft.materialsUsed?.map((m) => m.name) || ['Vật liệu tái chế'],
            toolsNeeded: craft.toolsRequired || ['Kéo thủ công'],
            highlightPart: 'body',
          },
        ];

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const craftGroupRef = useRef<THREE.Group | null>(null);
  const hotspotGroupRef = useRef<THREE.Group | null>(null);
  const separationLinesRef = useRef<THREE.LineSegments | null>(null);
  const groundMeshRef = useRef<THREE.Mesh | null>(null);
  const contactShadowRef = useRef<THREE.Mesh | null>(null);
  const animFrameRef = useRef<number>(0);
  const simulationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const assemblyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const targetCamPosRef = useRef<THREE.Vector3 | null>(null);
  const targetOrbitCenterRef = useRef<THREE.Vector3 | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  // Live animation refs for smooth zero-allocation damping inside animate()
  const explodedFactorRef = useRef<number>(0);
  const runtimeMapRef = useRef<Map<string, ComponentRuntimeEntry>>(new Map());
  const components3DRef = useRef<InteractiveComponent3D[]>([]);
  const assemblyStateRef = useRef<{
    active: boolean;
    stepIdx: number;
    stepComponentOrder: string[];
    completedIds: Set<string>;
  }>({
    active: false,
    stepIdx: 0,
    stepComponentOrder: [],
    completedIds: new Set(),
  });

  // Studio Lights References
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const fillLightRef = useRef<THREE.DirectionalLight | null>(null);
  const rimLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);

  // Subparts array for exploded view & assembly animations
  const subpartsRef = useRef<SubpartRegistration[]>([]);

  // Simulation autoplay (Craft Guide steps)
  useEffect(() => {
    if (isSimulating) {
      simulationTimerRef.current = setInterval(() => {
        const nextStep = (currentStepIndex + 1) % safeSteps.length;
        if (onStepChange) onStepChange(nextStep);
        if (nextStep === 0) {
          setIsSimulating(false);
        }
      }, 3500);
    } else {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
    }
    return () => {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
    };
  }, [isSimulating, currentStepIndex, safeSteps.length, onStepChange]);

  // Phase 8 Assembly Simulation autoplay
  useEffect(() => {
    if (assemblyModeActive && assemblyPlaying && assemblyPlan && assemblyPlan.steps.length > 0) {
      assemblyTimerRef.current = setInterval(() => {
        setAssemblyStepIdx((prev) => {
          const steps = assemblyPlan.steps;
          const currentStep = steps[prev];
          if (currentStep) {
            setCompletedAssemblyStepIds((cPrev) =>
              cPrev.includes(currentStep.stepId) ? cPrev : [...cPrev, currentStep.stepId]
            );
          }
          if (prev >= steps.length - 1) {
            setAssemblyPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 2200);
    } else if (assemblyTimerRef.current) {
      clearInterval(assemblyTimerRef.current);
    }
    return () => {
      if (assemblyTimerRef.current) clearInterval(assemblyTimerRef.current);
    };
  }, [assemblyModeActive, assemblyPlaying, assemblyPlan]);

  // Keep refs synced for animate()
  useEffect(() => {
    explodedFactorRef.current = explodedFactor;
  }, [explodedFactor]);

  useEffect(() => {
    components3DRef.current = components3D;
  }, [components3D]);

  useEffect(() => {
    assemblyStateRef.current = {
      active: assemblyModeActive,
      stepIdx: assemblyStepIdx,
      stepComponentOrder: assemblyPlan ? assemblyPlan.steps.map((s) => s.componentId) : [],
      completedIds: new Set(
        (assemblyPlan?.steps || [])
          .filter((s) => completedAssemblyStepIds.includes(s.stepId))
          .map((s) => s.componentId)
      ),
    };
  }, [assemblyModeActive, assemblyStepIdx, assemblyPlan, completedAssemblyStepIds]);

  // Main Scene Initialization with Photorealistic PBR & Studio Lighting
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Detect software WebGL guard
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();
    isSoftwareGlRef.current = isSoftwareGl;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0xf8fafc); // Default clean studio white
    scene.fog = new THREE.FogExp2(0xf8fafc, 0.025);

    // 2. Camera: slightly lower focal length (42mm equivalent) for authentic product photography
    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(3.4, 2.4, 4.2);
    cameraRef.current = camera;

    // 3. Renderer with ACES Filmic tone mapping for rich photorealistic dynamic range
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // Required for HD studio snapshot download
    });
    rendererRef.current = renderer;
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18; // Calibrated for translucent plastics
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.touchAction = 'none';

    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglContextLost(true);
    };
    const handleContextRestored = () => {
      setWebglContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // 4. Studio Environment map via RoomEnvironment for realistic specular reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 5. OrbitControls - Allow unrestricted 360-degree rotation vertically & horizontally
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    // Allow full 360-degree orbit around the model (both horizontally and vertically)
    controls.maxPolarAngle = Math.PI - 0.05; // Full bottom orbit
    controls.minPolarAngle = 0.05; // Full top orbit
    controls.minDistance = 0.8;
    controls.maxDistance = 14;
    controls.target.set(0, 0.85, 0);
    // Explicit touch gestures for mobile screens
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    // 6. Balanced Studio 3-Point Photography Lighting Rig
    // Hemisphere ambient fill
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xcfe2ff, 0.65);
    hemiLightRef.current = hemiLight;
    scene.add(hemiLight);

    // Key Light (Main soft directional sun with 2048x2048 soft shadow map)
    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(4.5, 7.5, 3.5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.normalBias = 0.02;
    keyLight.shadow.radius = 3.5; // Soft penumbra for realistic studio shadow
    keyLightRef.current = keyLight;
    scene.add(keyLight);

    // Fill Light (Soft cool fill light to prevent black voids in plastic folds)
    const fillLight = new THREE.DirectionalLight(0xcfd8dc, 0.85);
    fillLight.position.set(-3.5, 3.8, 2.5);
    fillLightRef.current = fillLight;
    scene.add(fillLight);

    // Rim / Back Light (Crucial for photorealism: catches bevels, cut edges, and translucent plastic walls)
    const rimLight = new THREE.DirectionalLight(0xffffff, 2.5);
    rimLight.position.set(-2.5, 5.0, -4.5);
    rimLightRef.current = rimLight;
    scene.add(rimLight);

    // Ground bounce underfill
    const underFill = new THREE.DirectionalLight(0xf8fafc, 0.35);
    underFill.position.set(0, -2, 0);
    scene.add(underFill);

    // 7. Ground Studio Floor Mesh
    const groundGeo = new THREE.PlaneGeometry(16, 16);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.85,
      metalness: 0.02,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = !isSoftwareGl;
    groundMeshRef.current = ground;
    scene.add(ground);

    // 8. Contact Shadow Ground Disc (Firmly anchors the product to the studio floor with natural AO)
    const contactShadowTex = getContactShadowTexture();
    const contactGeo = new THREE.PlaneGeometry(3.6, 3.6);
    const contactMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const contactShadowMesh = new THREE.Mesh(contactGeo, contactMat);
    contactShadowMesh.rotation.x = -Math.PI / 2;
    contactShadowMesh.position.y = 0.002;
    contactShadowRef.current = contactShadowMesh;
    scene.add(contactShadowMesh);

    // 9. Craft Group & Hotspot Markers
    const craftGroup = new THREE.Group();
    craftGroup.name = 'craft_root';
    craftGroupRef.current = craftGroup;
    scene.add(craftGroup);

    const hotspotGroup = new THREE.Group();
    hotspotGroupRef.current = hotspotGroup;
    scene.add(hotspotGroup);

    // Phase 8: Pre-allocated separation guide lines connecting separated parts to parent anchors
    const sepLineGeo = new THREE.BufferGeometry();
    const sepPositions = new Float32Array(MAX_SEPARATION_LINES * 2 * 3);
    sepLineGeo.setAttribute('position', new THREE.BufferAttribute(sepPositions, 3));
    sepLineGeo.setDrawRange(0, 0);
    const sepLineMat = new THREE.LineBasicMaterial({
      color: 0x4f46e5,
      transparent: true,
      opacity: 0.75,
    });
    const separationLines = new THREE.LineSegments(sepLineGeo, sepLineMat);
    separationLines.name = 'phase8_separation_lines';
    separationLines.frustumCulled = false;
    separationLines.visible = false;
    separationLinesRef.current = separationLines;
    scene.add(separationLines);

    // Cancel camera focus/preset transitions when user drags/zooms manually
    const cancelCameraTransition = () => {
      targetCamPosRef.current = null;
      targetOrbitCenterRef.current = null;
    };
    controls.addEventListener('start', cancelCameraTransition);

    // 10. Smooth Damped Animation Render Loop (Zero per-frame GC allocations)
    const clock = new THREE.Clock();
    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      const exp = explodedFactorRef.current;

      // Smoothly damp Craft Root Elevation & Contact Shadow
      if (craftGroupRef.current) {
        craftGroupRef.current.position.y = THREE.MathUtils.damp(
          craftGroupRef.current.position.y,
          exp * 1.15,
          8.0,
          delta
        );
      }
      if (hotspotGroupRef.current) {
        hotspotGroupRef.current.position.y = THREE.MathUtils.damp(
          hotspotGroupRef.current.position.y,
          exp * 1.15,
          8.0,
          delta
        );
      }
      if (contactShadowRef.current && contactShadowRef.current.material) {
        const mat = contactShadowRef.current.material as THREE.MeshBasicMaterial;
        const targetOpacity = Math.max(0, 0.65 * (1 - exp * 1.25));
        mat.opacity = THREE.MathUtils.damp(mat.opacity, targetOpacity, 8.0, delta);
      }

      // Smoothly damp every component position (Exploded View OR Assembly Simulation)
      const asmState = assemblyStateRef.current;
      const runtimeMap = runtimeMapRef.current;
      if (runtimeMap.size > 0) {
        runtimeMap.forEach((entry, compId) => {
          if (asmState.active) {
            const stepIdx = asmState.stepComponentOrder.indexOf(compId);
            const isPlaced =
              stepIdx === -1 ||
              stepIdx <= asmState.stepIdx ||
              asmState.completedIds.has(compId);
            const baseOrStaged = isPlaced ? entry.basePos : entry.stagedPos;
            _scratchTargetPos.copy(baseOrStaged);
          } else {
            _scratchTargetPos
              .copy(entry.basePos)
              .addScaledVector(entry.explodeDir, exp * 1.55);
          }
          entry.object3D.position.x = THREE.MathUtils.damp(
            entry.object3D.position.x,
            _scratchTargetPos.x,
            8.5,
            delta
          );
          entry.object3D.position.y = THREE.MathUtils.damp(
            entry.object3D.position.y,
            _scratchTargetPos.y,
            8.5,
            delta
          );
          entry.object3D.position.z = THREE.MathUtils.damp(
            entry.object3D.position.z,
            _scratchTargetPos.z,
            8.5,
            delta
          );
        });
      }

      // Update separation distance connector lines cleanly without allocations
      if (separationLinesRef.current && craftGroupRef.current) {
        const showLines = (exp > 0.03 || asmState.active) && runtimeMap.size > 0;
        separationLinesRef.current.visible = showLines;
        if (showLines) {
          craftGroupRef.current.updateMatrixWorld(true);
          const posAttr = sepLineGeo.getAttribute('position') as THREE.BufferAttribute;
          let segCount = 0;
          runtimeMap.forEach((entry) => {
            if (segCount >= MAX_SEPARATION_LINES || !entry.object3D.visible) return;
            const distMoved = entry.object3D.position.distanceTo(entry.basePos);
            if (distMoved < 0.025 && exp < 0.03) return;

            entry.object3D.getWorldPosition(_scratchWorldA);
            _scratchWorldA.add(entry.centerOffset);

            const parentEntry = entry.parentId ? runtimeMap.get(entry.parentId) : null;
            if (parentEntry && parentEntry.object3D.visible) {
              parentEntry.object3D.getWorldPosition(_scratchWorldB);
              _scratchWorldB.add(parentEntry.centerOffset);
            } else {
              craftGroupRef.current!.getWorldPosition(_scratchWorldB);
              _scratchWorldB.y += 0.2;
            }

            if (_scratchWorldA.distanceTo(_scratchWorldB) > 0.04) {
              const vIdx = segCount * 2;
              posAttr.setXYZ(vIdx, _scratchWorldB.x, _scratchWorldB.y, _scratchWorldB.z);
              posAttr.setXYZ(vIdx + 1, _scratchWorldA.x, _scratchWorldA.y, _scratchWorldA.z);
              segCount++;
            }
          });
          posAttr.needsUpdate = true;
          sepLineGeo.setDrawRange(0, segCount * 2);
        }
      }

      // Smoothly damp Camera position & Orbit target (when preset or focusComponent active)
      if (cameraRef.current && controlsRef.current) {
        if (targetOrbitCenterRef.current) {
          controlsRef.current.target.x = THREE.MathUtils.damp(
            controlsRef.current.target.x,
            targetOrbitCenterRef.current.x,
            6.5,
            delta
          );
          controlsRef.current.target.y = THREE.MathUtils.damp(
            controlsRef.current.target.y,
            targetOrbitCenterRef.current.y,
            6.5,
            delta
          );
          controlsRef.current.target.z = THREE.MathUtils.damp(
            controlsRef.current.target.z,
            targetOrbitCenterRef.current.z,
            6.5,
            delta
          );
          if (controlsRef.current.target.distanceTo(targetOrbitCenterRef.current) < 0.015) {
            targetOrbitCenterRef.current = null;
          }
        } else if (!selectedComponentId) {
          controlsRef.current.target.y = THREE.MathUtils.damp(
            controlsRef.current.target.y,
            0.85 + exp * 0.75,
            6.5,
            delta
          );
        }

        if (targetCamPosRef.current) {
          cameraRef.current.position.x = THREE.MathUtils.damp(
            cameraRef.current.position.x,
            targetCamPosRef.current.x,
            6.5,
            delta
          );
          cameraRef.current.position.y = THREE.MathUtils.damp(
            cameraRef.current.position.y,
            targetCamPosRef.current.y,
            6.5,
            delta
          );
          cameraRef.current.position.z = THREE.MathUtils.damp(
            cameraRef.current.position.z,
            targetCamPosRef.current.z,
            6.5,
            delta
          );
          if (cameraRef.current.position.distanceTo(targetCamPosRef.current) < 0.02) {
            targetCamPosRef.current = null;
          }
        }
      }

      // Hotspot markers subtle breathing + billboard toward camera
      if (hotspotGroupRef.current && cameraRef.current) {
        hotspotGroupRef.current.children.forEach((hp, idx) => {
          const scale = 1.0 + Math.sin(time * 3 + idx) * 0.12;
          hp.scale.set(scale, scale, scale);
          hp.lookAt(cameraRef.current!.position);
        });
      }

      // Hide floor when camera dips below so the entire 360 bottom of the craft is clearly visible
      if (groundMeshRef.current && cameraRef.current) {
        groundMeshRef.current.visible = cameraRef.current.position.y > 0.05;
      }

      controls.update();
      renderer.render(scene, camera);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    // 11. Resize Observer
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      controls.removeEventListener('start', cancelCameraTransition);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      disposeObject3D(craftGroup);
      disposeObject3D(hotspotGroup);
      sepLineGeo.dispose();
      sepLineMat.dispose();
      groundGeo.dispose();
      (ground.material as THREE.Material)?.dispose?.();
      contactGeo.dispose();
      contactMat.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Revoke local uploaded GLB object URL on unmount
  useEffect(() => {
    return () => {
      if (uploadedGlbUrl && uploadedGlbUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedGlbUrl);
      }
    };
  }, [uploadedGlbUrl]);

  // Build / Switch Craft Mesh, Phase 4 Parametric Mesh, Image-to-3D GLB, or Side-by-Side Comparison
  useEffect(() => {
    const craftGroup = craftGroupRef.current;
    const hotspotGroup = hotspotGroupRef.current;
    if (!craftGroup || !hotspotGroup) return;

    let cancelled = false;
    setGlbError(null);

    const clearGroups = () => {
      disposeObject3D(craftGroup);
      craftGroup.clear();
      craftGroup.scale.set(1, 1, 1);
      craftGroup.position.set(0, 0, 0);
      disposeObject3D(hotspotGroup);
      hotspotGroup.clear();
      subpartsRef.current = [];
      runtimeMapRef.current.clear();
      setSelectedComponentId(null);
      setHiddenComponentIds([]);
      setAssemblyModeActive(false);
      setAssemblyPlaying(false);
      setAssemblyStepIdx(0);
      setCompletedAssemblyStepIds([]);
    };

    const syncPhase8Hierarchy = (
      mode: 'craft' | 'source_parametric' | 'source_glb' | 'compare_glb',
      paramParts: ParametricPartEntry[] = []
    ) => {
      const extracted = extractComponentHierarchy({
        rootGroup: craftGroup,
        subparts: subpartsRef.current,
        parametricParts: paramParts,
        sourceMaterial,
        viewMode: mode,
      });
      runtimeMapRef.current = extracted.runtimeMap;
      setComponents3D(extracted.components);
      const plan = buildAssemblySimulationPlan({
        components: extracted.components,
        craft,
        sourceMaterial,
      });
      setAssemblyPlan(plan);
      setSeparationDistances(
        computeSeparationDistances({
          components: extracted.components,
          explodedFactor: explodedFactorRef.current,
          scaleUnitsPerCm: sourceMaterial?.reconstruction?.dimensions?.heightCm
            ? 2.0 / sourceMaterial.reconstruction.dimensions.heightCm
            : 0.1,
        })
      );
    };

    const stripPbrMicroMapsToRaw = (rootObj: THREE.Object3D) => {
      rootObj.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          const p = m as any;
          if ('normalMap' in p) p.normalMap = null;
          if ('roughnessMap' in p) p.roughnessMap = null;
          if ('bumpMap' in p) p.bumpMap = null;
          if ('clearcoat' in p) p.clearcoat = 0;
          if ('sheen' in p) p.sheen = 0;
          if ('transmission' in p && !p.transparent) p.transmission = 0;
          m.needsUpdate = true;
        }
      });
    };

    const applyWireAndTextureOverrides = (rootObj: THREE.Object3D) => {
      rootObj.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || mesh.name === 'usableZoneHighlight' || mesh.name === 'cut_guide_line') return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          const p = m as any;
          if (!p.userData._savedMapsCaptured) {
            p.userData._savedMap = p.map || null;
            p.userData._savedNormalMap = p.normalMap || null;
            p.userData._savedRoughnessMap = p.roughnessMap || null;
            p.userData._savedBumpMap = p.bumpMap || null;
            p.userData._savedMapsCaptured = true;
          }
          p.wireframe = wireframeMode;
          if (texturesEnabled) {
            p.map = p.userData._savedMap;
            p.normalMap = p.userData._savedNormalMap;
            p.roughnessMap = p.userData._savedRoughnessMap;
            p.bumpMap = p.userData._savedBumpMap;
          } else {
            p.map = null;
            p.normalMap = null;
            p.roughnessMap = null;
            p.bumpMap = null;
          }
          m.needsUpdate = true;
        }
      });
    };

    const finishRenderSync = (
      mode: 'craft' | 'source_parametric' | 'source_glb' | 'compare_glb' = 'craft',
      paramParts: ParametricPartEntry[] = []
    ) => {
      applyWireAndTextureOverrides(craftGroup);
      syncPhase8Hierarchy(mode, paramParts);
      if (rendererRef.current && sceneRef.current && cameraRef.current && !isSoftwareGlRef.current) {
        try {
          rendererRef.current.compile(sceneRef.current, cameraRef.current);
        } catch {
          // Ignore compile warnings on edge environments
        }
      }
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

    const makeComparisonSprite = (label: string, bg: string) => {
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
      sprite.scale.set(1.3, 0.25, 1);
      return sprite;
    };

    const buildActiveView = async () => {
      const recon = sourceMaterial ? ensureMaterialReconstruction(sourceMaterial) : null;

      if (craftViewMode === 'compare_glb' && activeSourceGlbUrl) {
        try {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          const loader = new GLTFLoader();
          const gltf = await loader.loadAsync(activeSourceGlbUrl);
          if (cancelled) {
            disposeObject3D(gltf.scene);
            return;
          }
          clearGroups();

          const leftGroup = new THREE.Group();
          const leftParts: { mesh: THREE.Object3D; basePos: THREE.Vector3; explodeDir: THREE.Vector3 }[] = [];
          buildPhotorealisticCraftMesh(leftGroup, craft, leftParts, showDecorations);
          applySourceMaterialAdaptation(leftGroup, sourceMaterial);
          leftGroup.position.x = -1.25;

          const rightRoot = gltf.scene;
          const inspect = inspectAndNormalizeGlbScene(rightRoot, {
            targetHeightCm: recon?.dimensions.heightCm ?? sourceMaterial?.dimensions?.heightCm ?? 20,
            targetSceneHeightU: 1.9,
            enableShadows: !isSoftwareGlRef.current,
          });
          if (qualityEnhancement !== 'raw') {
            const opt = optimizeSceneForQualityAndPerformance(rightRoot, {
              isSoftwareGl: isSoftwareGlRef.current,
              materialType: recon?.object.material,
            });
            setRefinementSummary(opt.refinementReport);
          } else {
            setRefinementSummary(null);
          }
          setGlbInspection(inspect);
          rightRoot.position.x += 1.25;

          const tagLeft = makeComparisonSprite('Sản phẩm chế tác 3D', '#059669');
          tagLeft.position.set(-1.25, 2.35, 0);
          const tagRight = makeComparisonSprite('Image-to-3D (.GLB)', '#4f46e5');
          tagRight.position.set(1.25, 2.35, 0);

          craftGroup.add(leftGroup, rightRoot, tagLeft, tagRight);
          subpartsRef.current = leftParts.map((p) => ({
            ...p,
            basePos: p.basePos.clone(),
          }));
          if (controlsRef.current) {
            controlsRef.current.target.set(0, 0.9, 0);
            controlsRef.current.update();
          }
          finishRenderSync('compare_glb');
          return;
        } catch {
          if (cancelled) return;
          setGlbError('Không thể tải mô hình .GLB để so sánh; đã tự động chuyển về mô hình chế tác chuẩn.');
        }
      }

      if (craftViewMode === 'source_glb' && activeSourceGlbUrl) {
        try {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          const loader = new GLTFLoader();
          const gltf = await loader.loadAsync(activeSourceGlbUrl);
          if (cancelled) {
            disposeObject3D(gltf.scene);
            return;
          }
          clearGroups();

          const glbRoot = gltf.scene;
          const inspect = inspectAndNormalizeGlbScene(glbRoot, {
            targetHeightCm: recon?.dimensions.heightCm ?? sourceMaterial?.dimensions?.heightCm ?? 20,
            targetSceneHeightU: 2.0,
            enableShadows: !isSoftwareGlRef.current,
          });
          setGlbInspection(inspect);
          if (!inspect.valid) {
            disposeObject3D(glbRoot);
            throw new Error(inspect.issues[0] || 'Tệp GLB không hợp lệ');
          }

          if (qualityEnhancement !== 'raw') {
            const opt = optimizeSceneForQualityAndPerformance(glbRoot, {
              isSoftwareGl: isSoftwareGlRef.current,
              materialType: recon?.object.material,
            });
            setRefinementSummary(opt.refinementReport);
          } else {
            setRefinementSummary(null);
          }

          craftGroup.add(glbRoot);
          if (controlsRef.current) {
            controlsRef.current.target.set(0, 0.95, 0);
            controlsRef.current.update();
          }
          finishRenderSync('source_glb');
          return;
        } catch {
          if (cancelled) return;
          setGlbError('Không thể nạp file GLB — tự động fallback về mô hình Parametric / Thủ công.');
        }
      }

      if (craftViewMode === 'source_parametric' && sourceMaterial) {
        if (qualityEnhancement === 'compare_quality') {
          const [rawBuilt, optBuilt] = await Promise.all([
            buildParametricReconstructionMesh({
              material: sourceMaterial,
              isSoftwareGl: isSoftwareGlRef.current,
              usePhotoTexture: texturesEnabled,
              qualityMode: 'raw',
            }),
            buildParametricReconstructionMesh({
              material: sourceMaterial,
              isSoftwareGl: isSoftwareGlRef.current,
              usePhotoTexture: texturesEnabled,
              qualityMode: 'optimized',
            }),
          ]);
          if (cancelled) {
            disposeObject3D(rawBuilt.group);
            disposeObject3D(optBuilt.group);
            return;
          }
          clearGroups();
          setGlbInspection(null);
          setRefinementSummary(optBuilt.refinementReport || null);

          const uRaw = rawBuilt.group.getObjectByName('usableZoneHighlight');
          if (uRaw) uRaw.visible = false;
          const uOpt = optBuilt.group.getObjectByName('usableZoneHighlight');
          if (uOpt) uOpt.visible = false;

          const spanX = Math.max(1.15, optBuilt.telemetry.sceneDimensions.x * 1.15);
          rawBuilt.group.position.x = -spanX;
          optBuilt.group.position.x = spanX;

          const tagLeft = makeComparisonSprite('Bản gốc thô', '#64748b');
          tagLeft.position.set(-spanX, optBuilt.telemetry.sceneDimensions.y + 0.35, 0);
          const tagRight = makeComparisonSprite('Tối ưu PBR (Phase 6)', '#059669');
          tagRight.position.set(spanX, optBuilt.telemetry.sceneDimensions.y + 0.35, 0);

          craftGroup.add(rawBuilt.group, optBuilt.group, tagLeft, tagRight);
          subpartsRef.current = optBuilt.parts.map((p) => ({
            mesh: p.mesh,
            basePos: p.basePos.clone(),
            explodeDir: p.explodeDir.clone(),
          }));
          if (controlsRef.current) {
            controlsRef.current.target.set(0, optBuilt.telemetry.sceneDimensions.y / 2, 0);
            controlsRef.current.update();
          }
          finishRenderSync('source_parametric', optBuilt.parts);
          return;
        }

        const built = await buildParametricReconstructionMesh({
          material: sourceMaterial,
          isSoftwareGl: isSoftwareGlRef.current,
          usePhotoTexture: texturesEnabled,
          qualityMode: qualityEnhancement === 'raw' ? 'raw' : 'optimized',
        });
        if (cancelled) {
          disposeObject3D(built.group);
          return;
        }
        clearGroups();
        setGlbInspection(null);
        setRefinementSummary(built.refinementReport || null);
        const usable = built.group.getObjectByName('usableZoneHighlight');
        if (usable) usable.visible = false;
        craftGroup.add(built.group);
        subpartsRef.current = built.parts.map((p) => ({
          mesh: p.mesh,
          basePos: p.basePos.clone(),
          explodeDir: p.explodeDir.clone(),
        }));
        if (controlsRef.current) {
          controlsRef.current.target.set(0, built.telemetry.sceneDimensions.y / 2, 0);
          controlsRef.current.update();
        }
        finishRenderSync('source_parametric', built.parts);
        return;
      }

      // Default procedural Craft PBR view (supports Phase 6 Raw / Optimized / Side-by-Side Comparison)
      clearGroups();
      setGlbInspection(null);

      if (qualityEnhancement === 'compare_quality') {
        const leftRaw = new THREE.Group();
        const leftParts: SubpartRegistration[] = [];
        buildPhotorealisticCraftMesh(leftRaw, craft, leftParts, showDecorations);
        applySourceMaterialAdaptation(leftRaw, sourceMaterial);
        stripPbrMicroMapsToRaw(leftRaw);
        leftRaw.position.x = -1.3;

        const rightOpt = new THREE.Group();
        const rightParts: SubpartRegistration[] = [];
        buildPhotorealisticCraftMesh(rightOpt, craft, rightParts, showDecorations);
        applySourceMaterialAdaptation(rightOpt, sourceMaterial);
        const opt = optimizeSceneForQualityAndPerformance(rightOpt, {
          isSoftwareGl: isSoftwareGlRef.current,
          materialType: recon?.object.material,
        });
        setRefinementSummary(opt.refinementReport);
        rightOpt.position.x = 1.3;

        const tagLeft = makeComparisonSprite('Thô (Chưa tối ưu PBR)', '#64748b');
        tagLeft.position.set(-1.3, 2.3, 0);
        const tagRight = makeComparisonSprite('Tối ưu PBR (Phase 6)', '#059669');
        tagRight.position.set(1.3, 2.3, 0);

        craftGroup.add(leftRaw, rightOpt, tagLeft, tagRight);
        subpartsRef.current = rightParts;
        if (controlsRef.current) {
          controlsRef.current.target.set(0, 0.9, 0);
          controlsRef.current.update();
        }
        finishRenderSync('craft');
        return;
      }

      buildPhotorealisticCraftMesh(craftGroup, craft, subpartsRef.current, showDecorations);
      applySourceMaterialAdaptation(craftGroup, sourceMaterial);
      if (qualityEnhancement === 'raw') {
        stripPbrMicroMapsToRaw(craftGroup);
        setRefinementSummary(null);
      } else {
        const opt = optimizeSceneForQualityAndPerformance(craftGroup, {
          isSoftwareGl: isSoftwareGlRef.current,
          materialType: recon?.object.material,
        });
        setRefinementSummary(opt.refinementReport);
      }
      buildInteractiveHotspots(hotspotGroup, craft);
      finishRenderSync('craft');
    };

    void buildActiveView();
    return () => {
      cancelled = true;
    };
  }, [craft, sourceMaterial, craftViewMode, activeSourceGlbUrl, qualityEnhancement]);

  // Fast in-place toggle for Wireframe & Texture visibility without rebuilding meshes
  useEffect(() => {
    const craftGroup = craftGroupRef.current;
    if (!craftGroup) return;
    craftGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === 'usableZoneHighlight' || mesh.name === 'cut_guide_line') return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const p = m as any;
        if (!p.userData._savedMapsCaptured) {
          p.userData._savedMap = p.map || null;
          p.userData._savedNormalMap = p.normalMap || null;
          p.userData._savedRoughnessMap = p.roughnessMap || null;
          p.userData._savedBumpMap = p.bumpMap || null;
          p.userData._savedMapsCaptured = true;
        }
        p.wireframe = wireframeMode;
        if (texturesEnabled) {
          p.map = p.userData._savedMap;
          p.normalMap = p.userData._savedNormalMap;
          p.roughnessMap = p.userData._savedRoughnessMap;
          p.bumpMap = p.userData._savedBumpMap;
        } else {
          p.map = null;
          p.normalMap = null;
          p.roughnessMap = null;
          p.bumpMap = null;
        }
        m.needsUpdate = true;
      }
    });
  }, [wireframeMode, texturesEnabled]);

  // Update Studio Backdrop (White Studio / Wood Workshop / Dark Studio)
  useEffect(() => {
    if (!sceneRef.current || !groundMeshRef.current) return;
    const scene = sceneRef.current;
    const ground = groundMeshRef.current;
    const prevMat = ground.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    if (Array.isArray(prevMat)) prevMat.forEach((m) => m?.dispose?.());
    else prevMat?.dispose?.();

    if (studioBackdrop === 'studio_white') {
      const col = new THREE.Color(0xf8fafc);
      scene.background = col;
      scene.fog = new THREE.FogExp2(0xf8fafc, 0.025);
      ground.material = new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.85,
        metalness: 0.02,
      });
    } else if (studioBackdrop === 'workshop_wood') {
      const col = new THREE.Color(0xf5ebe0);
      scene.background = col;
      scene.fog = new THREE.FogExp2(0xf5ebe0, 0.025);
      const woodTex = getWorkshopWoodFloorTexture();
      ground.material = new THREE.MeshStandardMaterial({
        map: woodTex,
        roughness: 0.75,
        metalness: 0.05,
      });
    } else if (studioBackdrop === 'studio_dark') {
      const col = new THREE.Color(0x0f172a);
      scene.background = col;
      scene.fog = new THREE.FogExp2(0x0f172a, 0.035);
      ground.material = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.65,
        metalness: 0.2,
      });
    }
  }, [studioBackdrop]);

  // Update Studio Lighting Mode (Soft Studio / Natural Sun / Dramatic Rim)
  useEffect(() => {
    if (!keyLightRef.current || !fillLightRef.current || !rimLightRef.current || !hemiLightRef.current) return;

    if (lightingMode === 'soft_studio') {
      keyLightRef.current.color.setHex(0xfff7ed);
      keyLightRef.current.intensity = 2.2;
      fillLightRef.current.color.setHex(0xcfd8dc);
      fillLightRef.current.intensity = 0.85;
      rimLightRef.current.color.setHex(0xffffff);
      rimLightRef.current.intensity = 2.5;
      hemiLightRef.current.intensity = 0.65;
    } else if (lightingMode === 'natural_sun') {
      keyLightRef.current.color.setHex(0xfffbeb);
      keyLightRef.current.intensity = 2.8;
      fillLightRef.current.color.setHex(0xbbf7d0);
      fillLightRef.current.intensity = 0.6;
      rimLightRef.current.color.setHex(0xffedd5);
      rimLightRef.current.intensity = 1.8;
      hemiLightRef.current.intensity = 0.8;
    } else if (lightingMode === 'dramatic_rim') {
      keyLightRef.current.color.setHex(0xffffff);
      keyLightRef.current.intensity = 1.4;
      fillLightRef.current.color.setHex(0x38bdf8);
      fillLightRef.current.intensity = 0.5;
      rimLightRef.current.color.setHex(0x34d399);
      rimLightRef.current.intensity = 3.6; // High intensity edge pop
      hemiLightRef.current.intensity = 0.4;
    }
  }, [lightingMode]);

  // Synchronize Component Highlighting (CraftGuide Step + Clicked Selection + Active Assembly Step) & Visibility
  useEffect(() => {
    if (!craftGroupRef.current) return;
    const currentStep = activeGuideStep || safeSteps[currentStepIndex];
    const highlightTarget = currentStep?.highlightPart || 'body';

    const guideMatchedSet = new Set<string>([
      ...resolveMatchingComponentIdsForGuideStep(currentStep, components3D),
      ...highlightComponentIds,
    ]);
    const activeAsmCompId =
      assemblyModeActive && assemblyPlan?.steps[assemblyStepIdx]
        ? assemblyPlan.steps[assemblyStepIdx].componentId
        : null;
    const hiddenSet = new Set(hiddenComponentIds);

    // Apply per-component visibility from Phase 8 Component Tree
    runtimeMapRef.current.forEach((entry, compId) => {
      entry.object3D.visible = !hiddenSet.has(compId);
    });

    const findOwningComponentId = (obj: THREE.Object3D): string | null => {
      let curr: THREE.Object3D | null = obj;
      while (curr && curr !== craftGroupRef.current) {
        if (typeof curr.userData?._phase8ComponentId === 'string') {
          return curr.userData._phase8ComponentId;
        }
        curr = curr.parent;
      }
      return null;
    };

    craftGroupRef.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const partName = mesh.name || '';
        const ownerId = findOwningComponentId(mesh);

        // If mesh is the cut guide line
        if (partName === 'cut_guide_line') {
          const isExplicitlyHidden = ownerId ? hiddenSet.has(ownerId) : false;
          mesh.visible =
            !isExplicitlyHidden &&
            (currentStepIndex === 0 || highlightTarget === 'cut_line' || selectedComponentId === ownerId);
        }

        const isSelected = Boolean(ownerId && selectedComponentId === ownerId);
        const isAsmActive = Boolean(ownerId && activeAsmCompId === ownerId);
        const isGuideMatch = Boolean(
          (ownerId && guideMatchedSet.has(ownerId)) ||
            (highlightTarget !== 'all' && partName.includes(highlightTarget))
        );

        // Pending assembly components appear slightly ghosted until their assembly step activates
        let isPendingAsm = false;
        if (assemblyModeActive && ownerId && assemblyPlan) {
          const stepIndexOfPart = assemblyPlan.steps.findIndex((s) => s.componentId === ownerId);
          const stepObj = stepIndexOfPart >= 0 ? assemblyPlan.steps[stepIndexOfPart] : null;
          if (
            stepIndexOfPart > assemblyStepIdx &&
            stepObj &&
            !completedAssemblyStepIds.includes(stepObj.stepId)
          ) {
            isPendingAsm = true;
          }
        }

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((rawMat) => {
          const mat = rawMat as any;
          if (!mat) return;
          if (mat.userData._origOpacity === undefined) {
            mat.userData._origOpacity = typeof mat.opacity === 'number' ? mat.opacity : 1;
            mat.userData._origTransparent = Boolean(mat.transparent);
          }
          if (isPendingAsm) {
            mat.transparent = true;
            mat.opacity = Math.min(mat.userData._origOpacity, 0.35);
          } else {
            mat.transparent = mat.userData._origTransparent;
            mat.opacity = mat.userData._origOpacity;
          }

          if (
            ('isMeshStandardMaterial' in mat ||
              'isMeshPhysicalMaterial' in mat ||
              'isMeshPhongMaterial' in mat) &&
            mat.emissive &&
            !mat.userData?.preserveEmissive
          ) {
            if (mat.userData._origEmissiveHex === undefined) {
              mat.userData._origEmissiveHex = mat.emissive.getHex();
              mat.userData._origEmissiveIntensity = mat.emissiveIntensity || 0;
            }
            if (isSelected) {
              mat.emissive.setHex(0x0ea5e9);
              mat.emissiveIntensity = 0.38;
            } else if (isAsmActive) {
              mat.emissive.setHex(0xf59e0b);
              mat.emissiveIntensity = 0.32;
            } else if (isGuideMatch && highlightTarget !== 'all') {
              mat.emissive.setHex(0x10b981);
              mat.emissiveIntensity = 0.24;
            } else {
              mat.emissive.setHex(mat.userData._origEmissiveHex);
              mat.emissiveIntensity = mat.userData._origEmissiveIntensity;
            }
          }
          mat.needsUpdate = true;
        });
      }
    });
  }, [
    currentStepIndex,
    craft,
    safeSteps,
    activeGuideStep,
    highlightComponentIds,
    components3D,
    selectedComponentId,
    hiddenComponentIds,
    assemblyModeActive,
    assemblyStepIdx,
    assemblyPlan,
    completedAssemblyStepIds,
  ]);

  // Recompute numeric separation distances whenever explodedFactor or assembly simulation state updates
  useEffect(() => {
    if (components3D.length === 0) {
      setSeparationDistances([]);
      return;
    }
    const scaleCm = sourceMaterial?.reconstruction?.dimensions?.heightCm
      ? 2.0 / sourceMaterial.reconstruction.dimensions.heightCm
      : 0.1;

    const customPos = new Map<string, Vec3Tuple>();
    if (assemblyModeActive && assemblyPlan) {
      components3D.forEach((comp) => {
        const idx = assemblyPlan.steps.findIndex((s) => s.componentId === comp.id);
        const stepObj = idx >= 0 ? assemblyPlan.steps[idx] : null;
        const isPlaced =
          idx === -1 ||
          idx <= assemblyStepIdx ||
          (stepObj ? completedAssemblyStepIds.includes(stepObj.stepId) : false);
        customPos.set(comp.id, isPlaced ? comp.position : (stepObj?.stagedPosition || comp.position));
      });
    }

    setSeparationDistances(
      computeSeparationDistances({
        components: components3D,
        explodedFactor,
        currentPositions: assemblyModeActive ? customPos : undefined,
        scaleUnitsPerCm: scaleCm,
      })
    );
  }, [
    components3D,
    explodedFactor,
    assemblyModeActive,
    assemblyStepIdx,
    assemblyPlan,
    completedAssemblyStepIds,
    sourceMaterial,
  ]);

  // Synchronize Cute Decorative Elements Visibility
  useEffect(() => {
    if (!craftGroupRef.current) return;
    craftGroupRef.current.traverse((child) => {
      if (child.name === 'decorations' || child.userData?.isDecoration) {
        child.visible = showDecorations;
      }
    });
  }, [showDecorations]);

  // Auto-rotate effect
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = isAutoRotating;
      controlsRef.current.autoRotateSpeed = 2.0;
    }
  }, [isAutoRotating]);

  // Select component helper (notifies parent listener like InteractiveCraftGuide)
  const selectComponent3D = (compId: string | null) => {
    setSelectedComponentId(compId);
    if (onComponentSelect) {
      const comp = compId ? components3D.find((c) => c.id === compId) || null : null;
      onComponentSelect(comp);
    }
  };

  // Focus camera smoothly on a specific component's Bounding Box
  const focusCameraOnComponent = (compId: string) => {
    const entry = runtimeMapRef.current.get(compId);
    if (!entry || !cameraRef.current || !controlsRef.current) return;

    entry.object3D.updateMatrixWorld(true);
    _scratchBox3.setFromObject(entry.object3D);
    if (_scratchBox3.isEmpty()) {
      entry.object3D.getWorldPosition(_scratchCenter);
      _scratchSize.set(0.8, 0.8, 0.8);
    } else {
      _scratchBox3.getCenter(_scratchCenter);
      _scratchBox3.getSize(_scratchSize);
    }

    const radius = Math.max(0.45, _scratchSize.length() * 0.65);
    const fovRad = THREE.MathUtils.degToRad(cameraRef.current.fov);
    const distance = Math.min(8.5, Math.max(1.6, radius / Math.sin(fovRad / 2) * 1.15));

    _scratchVecA.subVectors(cameraRef.current.position, controlsRef.current.target);
    if (_scratchVecA.lengthSq() < 0.001) _scratchVecA.set(0.6, 0.4, 0.7);
    _scratchVecA.normalize().multiplyScalar(distance);

    targetOrbitCenterRef.current = _scratchCenter.clone();
    targetCamPosRef.current = _scratchCenter.clone().add(_scratchVecA);
    selectComponent3D(compId);
  };

  // Toggle visibility of a component or restore all
  const toggleComponentVisibility = (compId: string) => {
    setHiddenComponentIds((prev) =>
      prev.includes(compId) ? prev.filter((x) => x !== compId) : [...prev, compId]
    );
  };

  const showAllComponents = () => {
    setHiddenComponentIds([]);
  };

  // Zoom Camera smoothly closer or farther along view ray
  const zoomCamera = (scaleFactor: number) => {
    if (!cameraRef.current || !controlsRef.current) return;
    _scratchVecA.subVectors(cameraRef.current.position, controlsRef.current.target);
    const nextDist = THREE.MathUtils.clamp(_scratchVecA.length() * scaleFactor, 1.0, 12.0);
    _scratchVecA.normalize().multiplyScalar(nextDist);
    targetCamPosRef.current = controlsRef.current.target.clone().add(_scratchVecA);
  };

  // Restore full initial assembled state (exploded = 0, assembly off, all visible, default iso camera)
  const resetModelToInitialState = () => {
    setExplodedFactor(0);
    setAssemblyModeActive(false);
    setAssemblyPlaying(false);
    setAssemblyStepIdx(0);
    setCompletedAssemblyStepIds([]);
    setHiddenComponentIds([]);
    selectComponent3D(null);
    setSelectedHotspot(null);
    targetOrbitCenterRef.current = new THREE.Vector3(0, 0.85, 0);
    targetCamPosRef.current = new THREE.Vector3(3.4, 2.4, 4.2);
  };

  // Handle Direct 3D Mesh + Hotspot Raycast Click on Viewport (guarded against OrbitControls drag)
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pointerDownPosRef.current) {
      const dist = Math.hypot(
        e.clientX - pointerDownPosRef.current.x,
        e.clientY - pointerDownPosRef.current.y
      );
      if (dist > 6) return;
    }
    if (!mountRef.current || !cameraRef.current) return;

    const rect = mountRef.current.getBoundingClientRect();
    _scratchPointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    _scratchRaycaster.setFromCamera(_scratchPointerNdc, cameraRef.current);

    // 1. Prioritize floating hotspot badges when clicked
    if (hotspotGroupRef.current && hotspotGroupRef.current.children.length > 0) {
      const hotspotHits = _scratchRaycaster.intersectObjects(hotspotGroupRef.current.children, true);
      if (hotspotHits.length > 0) {
        const data = hotspotHits[0].object.userData as ComponentHotspot;
        if (data && data.name) {
          setSelectedHotspot(data);
          const matchedComp = components3D.find(
            (c) =>
              data.id.includes(c.partRole) ||
              c.name.toLowerCase().includes(data.name.toLowerCase().split(' ')[0])
          );
          if (matchedComp) {
            selectComponent3D(matchedComp.id);
          }
          return;
        }
      }
    }

    // 2. Raycast directly against visible 3D component meshes
    if (craftGroupRef.current) {
      const meshHits = _scratchRaycaster.intersectObjects(craftGroupRef.current.children, true);
      for (const hit of meshHits) {
        if (!hit.object.visible) continue;
        if (hit.object.name === 'usableZoneHighlight') continue;
        let curr: THREE.Object3D | null = hit.object;
        let foundId: string | null = null;
        while (curr && curr !== craftGroupRef.current) {
          if (typeof curr.userData?._phase8ComponentId === 'string') {
            foundId = curr.userData._phase8ComponentId;
            break;
          }
          curr = curr.parent;
        }
        if (foundId) {
          selectComponent3D(foundId);
          setPhase8PanelTab('components');
          return;
        }
      }
    }
  };

  // Camera presets transitions (smoothly damped inside animate())
  const setCameraAngle = (angle: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso') => {
    const targetY = 0.85 + explodedFactor * 0.75;
    const dist = 5.0 + explodedFactor * 0.6;
    targetOrbitCenterRef.current = new THREE.Vector3(0, targetY, 0);

    const positions: Record<string, THREE.Vector3> = {
      front: new THREE.Vector3(0, targetY, dist),
      back: new THREE.Vector3(0, targetY, -dist),
      left: new THREE.Vector3(-dist, targetY, 0),
      right: new THREE.Vector3(dist, targetY, 0),
      top: new THREE.Vector3(0, targetY + dist * 1.35, 0.001),
      bottom: new THREE.Vector3(0, Math.max(0.2, targetY - dist * 0.95), 0.001),
      iso: new THREE.Vector3(3.4, targetY + 1.55, 4.2),
    };

    targetCamPosRef.current = positions[angle] || positions.iso;
  };

  // Trigger smooth exploded view transition (damped inside animate())
  const animateExplodeTo = (targetVal: number) => {
    setAssemblyModeActive(false);
    setAssemblyPlaying(false);
    setExplodedFactor(targetVal);
  };

  // Capture High-Res Photorealistic Product Studio Snapshot
  const handleTakeSnapshot = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    setIsSnapshotting(true);

    try {
      // Re-render synchronously right before reading canvas
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      const dataUrl = rendererRef.current.domElement.toDataURL('image/png', 1.0);

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${craft.title.toLowerCase().replace(/[\s/]/g, '_')}_photorealistic_3d.png`;
      link.click();

      setSnapshotToast('Đã tải ảnh chụp 3D Studio chất lượng cao!');
      setTimeout(() => setSnapshotToast(null), 3000);
    } catch (e) {
      console.warn('Snapshot error:', e);
    } finally {
      setIsSnapshotting(false);
    }
  };

  // GLTF/GLB Export
  const handleExportGLB = async () => {
    if (!craftGroupRef.current) return;
    setExportingGlb(true);

    try {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      exporter.parse(
        craftGroupRef.current,
        (gltf) => {
          const blob = new Blob([gltf as ArrayBuffer], { type: 'application/octet-stream' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `${craft.title.toLowerCase().replace(/[\s/]/g, '_')}_photoreal3d.glb`;
          link.click();
          URL.revokeObjectURL(link.href);
          setExportingGlb(false);
        },
        (error) => {
          console.error('An error happened while exporting GLB:', error);
          setExportingGlb(false);
        },
        { binary: true }
      );
    } catch (error) {
      console.error('Failed to load GLTFExporter:', error);
      setExportingGlb(false);
    }
  };

  // Upload optional local .glb file to inspect/compare inside CraftViewer3D
  const handleUploadSourceGlb = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const header = await file.slice(0, 12).arrayBuffer();
      const view = new DataView(header);
      const magic = view.byteLength >= 4 ? view.getUint32(0, true) : 0;
      if (magic !== 0x46546c67 && !file.name.toLowerCase().endsWith('.gltf')) {
        setGlbError('Tệp không đúng chuẩn nhị phân glTF 2.0 (.glb / .gltf).');
        return;
      }
      const nextUrl = URL.createObjectURL(file);
      setUploadedGlbUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return nextUrl;
      });
      setGlbError(null);
      setCraftViewMode('compare_glb');
    } catch {
      setGlbError('Không thể đọc tệp GLB được chọn.');
    }
  };

  const activeStep = safeSteps[currentStepIndex] || safeSteps[0];

  return (
    <div className="w-full space-y-3">
      <div
        className={`relative w-full rounded-3xl overflow-hidden bg-slate-50 border border-slate-200/90 shadow-lg transition-all ${
          isZenMode ? 'fixed inset-0 z-50 rounded-none h-screen w-screen' : ''
        }`}
        style={{ height: isZenMode ? '100vh' : height }}
      >
      {/* 3D Canvas Mount Point */}
      <div
        ref={mountRef}
        onPointerDown={(e) => {
          pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={handleCanvasClick}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ touchAction: 'none' }}
      />

      {webglContextLost && (
        <div
          role="alert"
          className="absolute inset-0 z-30 bg-slate-900/90 text-white flex flex-col items-center justify-center p-6 text-center gap-3"
        >
          <AlertTriangle className="w-8 h-8 text-amber-400" />
          <p className="text-sm font-bold">Ngữ cảnh WebGL tạm thời bị gián đoạn</p>
          <p className="text-xs text-slate-300 max-w-sm">
            Trình duyệt đã thu hồi bộ nhớ đồ họa 3D tạm thời. Nhấn khôi phục hoặc xoay lại trang để tiếp tục.
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

      {/* Floating 360 Rotation Guide Badge (solid background for WebGL perf) */}
      <div className="absolute top-16 left-3 bg-white px-3 py-1 rounded-xl shadow-xs border border-slate-200 text-[10px] text-slate-600 font-medium pointer-events-none flex items-center gap-1.5 z-10">
        <Compass className="w-3.5 h-3.5 text-emerald-600" />
        <span>Vuốt tay / kéo chuột để xoay 360° tự do</span>
      </div>

      {/* Top Left Step Indicator & Realistic PBR Badge */}
      <div className="absolute top-3 left-3 flex flex-col gap-1.5 pointer-events-none max-w-sm z-10">
        <div className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-2xl shadow-sm border border-emerald-100 text-xs font-bold text-emerald-900">
          <Sparkles className="w-4 h-4 text-emerald-600" />
          <span>
            Bước {activeStep.stepNumber} / {safeSteps.length}: {activeStep.title}
          </span>
        </div>
        <div className="bg-slate-900 text-white text-[11px] px-3 py-1 rounded-xl shadow-md flex items-center justify-between gap-3">
          <span className="text-emerald-400 font-bold flex items-center gap-1">
            <span>Mô phỏng 3D dự kiến</span>
          </span>
          <span className="text-slate-300 text-[10px] truncate max-w-[210px]">
            {sourceMaterial ? `Minh họa từ: ${sourceMaterial.name}` : 'Mô hình tham khảo (không phải ảnh thật)'}
          </span>
        </div>
      </div>

      {/* Top Right Quick Tool Buttons & Studio Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
        {/* Studio Snapshot Photo Button */}
        <button
          onClick={handleTakeSnapshot}
          disabled={isSnapshotting}
          className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 shadow-sm border border-slate-200 text-xs font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
          title="Chụp ảnh màn hình mô hình mô phỏng 3D (PNG)"
        >
          <Camera className="w-3.5 h-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Chụp Studio HD</span>
        </button>

        {/* GLB Export */}
        <button
          onClick={handleExportGLB}
          disabled={exportingGlb}
          className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 shadow-sm border border-slate-200 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
          title="Tải tệp mô hình 3D (.glb)"
        >
          <Download className="w-3.5 h-3.5 text-indigo-600" />
          <span className="hidden sm:inline">{exportingGlb ? 'Đang xuất...' : 'Tải GLB'}</span>
        </button>

        {/* Fullscreen / Zen Mode */}
        <button
          onClick={() => setIsZenMode(!isZenMode)}
          className="p-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 shadow-sm border border-slate-200 text-xs font-medium transition cursor-pointer"
          title={isZenMode ? 'Thu nhỏ' : 'Toàn màn hình'}
        >
          {isZenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Snapshot Confirmation Toast */}
      {snapshotToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-4 py-2 rounded-2xl shadow-xl border border-emerald-500/30 flex items-center gap-2 animate-in fade-in z-30">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{snapshotToast}</span>
        </div>
      )}

      {/* GLB Fallback / Inspection Warning Banner */}
      {glbError && (
        <div className="absolute bottom-3 left-3 right-3 bg-amber-50 border border-amber-300 text-amber-900 text-xs px-3 py-2 rounded-xl shadow-md flex items-center gap-2 z-20">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{glbError}</span>
        </div>
      )}

      {/* Selected Component Hotspot Detail Card Popup */}
      {selectedHotspot && (
        <div className="absolute top-20 right-3 bg-white p-4 rounded-3xl shadow-2xl border border-emerald-200 text-xs space-y-2.5 max-w-xs z-20">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100">
            <span className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5 text-emerald-800">
              <Info className="w-4 h-4 text-emerald-600" />
              <span>{selectedHotspot.name}</span>
            </span>
            <button
              onClick={() => setSelectedHotspot(null)}
              className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div>
              <span className="font-semibold text-slate-500 block">Chất liệu thực tế:</span>
              <span className="font-medium text-slate-800">{selectedHotspot.material}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500 block">Công dụng / Vai trò:</span>
              <span className="text-slate-700">{selectedHotspot.role}</span>
            </div>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-900 border border-emerald-100">
              <span className="font-bold block mb-0.5">Cách chế tạo thủ công:</span>
              <span>{selectedHotspot.howToMake}</span>
            </div>
            {selectedHotspot.safetyNotice && (
              <div className="p-2 rounded-xl bg-amber-50 text-amber-900 border border-amber-200">
                <span className="font-bold block mb-0.5 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3 text-amber-600" />
                  <span>Lưu ý an toàn:</span>
                </span>
                <span>{selectedHotspot.safetyNotice}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Zen Mode Floating Controls Bar (Chỉ hiển thị khi phóng to toàn màn hình) */}
      {isZenMode && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[95%] w-fit bg-white px-4 py-2.5 rounded-2xl shadow-2xl border border-slate-200 flex items-center flex-wrap justify-center gap-2 sm:gap-3 text-xs z-30">
          <div className="flex items-center gap-1 font-mono font-bold text-slate-800">
            <button
              onClick={() => onStepChange && onStepChange(Math.max(0, currentStepIndex - 1))}
              disabled={currentStepIndex === 0}
              className="p-1 rounded-lg bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>{currentStepIndex + 1}/{safeSteps.length}</span>
            <button
              onClick={() => onStepChange && onStepChange(Math.min(safeSteps.length - 1, currentStepIndex + 1))}
              disabled={currentStepIndex === safeSteps.length - 1}
              className="p-1 rounded-lg bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="w-[1px] h-4 bg-slate-200" />
          <button
            onClick={() => setIsAutoRotating(!isAutoRotating)}
            className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 ${
              isAutoRotating ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAutoRotating ? 'animate-spin' : ''}`} />
            <span>360°</span>
          </button>
          <button
            onClick={() => animateExplodeTo(explodedFactor > 0.5 ? 0 : 1)}
            className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 ${
              explodedFactor > 0.5 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Split className="w-3.5 h-3.5" />
            <span>{explodedFactor > 0.5 ? 'Lắp ráp' : 'Tách chi tiết'}</span>
          </button>
          <button
            onClick={() => setShowDecorations(!showDecorations)}
            className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 ${
              showDecorations ? 'bg-pink-500 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Decor</span>
          </button>
          <button
            onClick={() => setIsZenMode(false)}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
            title="Thu nhỏ màn hình"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>

    {/* ========================================================
        BẢNG ĐIỀU KHIỂN & CÔNG CỤ TƯƠNG TÁC 3D (ĐẶT HOÀN TOÀN BÊN NGOÀI MÀN HÌNH 3D)
        Giúp màn hình 3D rộng rãi 100%, không bị che khuất tầm nhìn của người dùng
        ======================================================== */}
    {!isZenMode && (
      <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-3.5">
        {/* HÀNG 1: ĐIỀU HƯỚNG CÔNG ĐOẠN & THAO TÁC CẤU TẠO CHÍNH */}
        <div className="flex items-center justify-between flex-wrap gap-2.5 pb-3 border-b border-slate-100">
          {/* Step Navigation Pill */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 p-1 rounded-2xl">
            <button
              onClick={() => onStepChange && onStepChange(Math.max(0, currentStepIndex - 1))}
              disabled={currentStepIndex === 0}
              className="p-1.5 rounded-xl hover:bg-white text-slate-700 disabled:opacity-30 transition cursor-pointer shadow-2xs"
              title="Công đoạn trước"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="font-bold text-slate-800 px-2 text-xs font-mono">
              Bước {currentStepIndex + 1}/{safeSteps.length}
            </span>

            <button
              onClick={() =>
                onStepChange && onStepChange(Math.min(safeSteps.length - 1, currentStepIndex + 1))
              }
              disabled={currentStepIndex === safeSteps.length - 1}
              className="p-1.5 rounded-xl hover:bg-white text-slate-700 disabled:opacity-30 transition cursor-pointer shadow-2xs"
              title="Công đoạn tiếp theo"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Main Interactive Action Buttons */}
          <div className="flex items-center flex-wrap gap-2 text-xs">
            {/* Play/Pause Simulation Autoplay */}
            <button
              onClick={() => setIsSimulating(!isSimulating)}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs ${
                isSimulating
                  ? 'bg-amber-500 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
              }`}
              title="Tự động mô phỏng quy trình qua từng công đoạn"
            >
              {isSimulating ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Dừng</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Mô phỏng</span>
                </>
              )}
            </button>

            {/* Dedicated 360-degree Turntable continuous auto-spin button */}
            <button
              onClick={() => setIsAutoRotating(!isAutoRotating)}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs ${
                isAutoRotating
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
              title="Bật/Tắt chế độ tự động xoay 360 độ quanh sản phẩm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAutoRotating ? 'animate-spin' : ''}`} />
              <span>{isAutoRotating ? 'Dừng xoay 360°' : 'Xoay 360°'}</span>
            </button>

            {/* Exploded View Action Button & Distance Slider */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 px-2.5 py-1.5 rounded-xl">
              <button
                onClick={() => animateExplodeTo(explodedFactor > 0.5 ? 0 : 1)}
                className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition cursor-pointer ${
                  explodedFactor > 0.5
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                }`}
                title="Tách rời các bộ phận lên không trung để quan sát cấu tạo bên trong"
              >
                <Split className="w-3.5 h-3.5" />
                <span>{explodedFactor > 0.5 ? 'Lắp ráp lại' : 'Tách cấu tạo'}</span>
              </button>

              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={explodedFactor}
                onChange={(e) => setExplodedFactor(parseFloat(e.target.value))}
                className="w-16 sm:w-24 accent-indigo-600 cursor-pointer"
                title="Kéo trượt để nâng và bung khoảng cách chi tiết"
              />
            </div>

            {/* Toggle Cute Handcrafted Decorations */}
            <button
              onClick={() => setShowDecorations(!showDecorations)}
              className={`px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs ${
                showDecorations
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title="Bật/Tắt các chi tiết trang trí thủ công dễ thương (nơ thừng, mặt cười kawaii, hoa nở, tem đua...)"
            >
              <Palette className="w-3.5 h-3.5" />
              <span>{showDecorations ? 'Decor: Bật' : 'Decor: Tắt'}</span>
            </button>

            {/* Zoom In / Out & Reset Model */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => zoomCamera(0.8)}
                className="p-1.5 rounded-lg hover:bg-white text-slate-700 transition cursor-pointer"
                title="Phóng to (Zoom In)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => zoomCamera(1.25)}
                className="p-1.5 rounded-lg hover:bg-white text-slate-700 transition cursor-pointer"
                title="Thu nhỏ (Zoom Out)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={resetModelToInitialState}
                className="px-2 py-1 rounded-lg hover:bg-white text-slate-700 text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                title="Khôi phục vị trí ban đầu, hiện tất cả bộ phận & đặt lại góc nhìn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Khôi phục</span>
              </button>
            </div>
          </div>
        </div>

        {/* HÀNG 2: GÓC NHÌN NHANH 360° & PHÔNG NỀN STUDIO CHUYÊN NGHIỆP */}
        <div className="flex items-center justify-between flex-wrap gap-3 text-xs">
          {/* Dải nút Góc nhìn Camera 3D */}
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-indigo-500" />
              <span>Góc nhìn 3D:</span>
            </span>
            <button
              onClick={() => setCameraAngle('iso')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-semibold text-slate-700 transition cursor-pointer text-[11px]"
            >
              Phối cảnh
            </button>
            <button
              onClick={() => setCameraAngle('front')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-medium text-slate-700 transition cursor-pointer text-[11px]"
            >
              Chính diện
            </button>
            <button
              onClick={() => setCameraAngle('back')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-medium text-slate-700 transition cursor-pointer text-[11px]"
            >
              Mặt sau
            </button>
            <button
              onClick={() => setCameraAngle('left')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-medium text-slate-700 transition cursor-pointer text-[11px]"
            >
              Trái
            </button>
            <button
              onClick={() => setCameraAngle('right')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-medium text-slate-700 transition cursor-pointer text-[11px]"
            >
              Phải
            </button>
            <button
              onClick={() => setCameraAngle('top')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-medium text-slate-700 transition cursor-pointer text-[11px]"
            >
              Trên đỉnh
            </button>
            <button
              onClick={() => setCameraAngle('bottom')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 font-medium text-slate-700 transition cursor-pointer text-[11px]"
            >
              Dưới đáy
            </button>
          </div>

          {/* Dải nút Chọn Phông Nền Studio */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 px-2 py-1 rounded-2xl">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
              Phông nền:
            </span>
            <button
              onClick={() => setStudioBackdrop('studio_white')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                studioBackdrop === 'studio_white'
                  ? 'bg-slate-800 text-white shadow-2xs'
                  : 'bg-white hover:bg-slate-100 text-slate-600'
              }`}
              title="Phông nền Studio Trắng"
            >
              Trắng
            </button>
            <button
              onClick={() => setStudioBackdrop('workshop_wood')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                studioBackdrop === 'workshop_wood'
                  ? 'bg-amber-800 text-white shadow-2xs'
                  : 'bg-white hover:bg-slate-100 text-slate-600'
              }`}
              title="Bàn Gỗ Xưởng Tái Chế"
            >
              Gỗ
            </button>
            <button
              onClick={() => setStudioBackdrop('studio_dark')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                studioBackdrop === 'studio_dark'
                  ? 'bg-indigo-950 text-white shadow-2xs'
                  : 'bg-white hover:bg-slate-100 text-slate-600'
              }`}
              title="Studio Tối Sang Trọng"
            >
              Tối
            </button>
          </div>
        </div>

        {/* HÀNG 3: CHẾ ĐỘ SO SÁNH IMAGE-TO-3D (.GLB) & PARAMETRIC (PHASE 5) */}
        <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-indigo-500" />
              <span>Nguồn mô hình 3D:</span>
            </span>
            <button
              type="button"
              onClick={() => setCraftViewMode('craft')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                craftViewMode === 'craft'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Chế tác PBR
            </button>
            {sourceMaterial && (
              <button
                type="button"
                onClick={() => setCraftViewMode('source_parametric')}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                  craftViewMode === 'source_parametric'
                    ? 'bg-teal-600 text-white shadow-2xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <Box className="w-3 h-3" />
                <span>Phôi Parametric</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => activeSourceGlbUrl && setCraftViewMode('source_glb')}
              disabled={!activeSourceGlbUrl}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer disabled:opacity-40 flex items-center gap-1 ${
                craftViewMode === 'source_glb'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title={activeSourceGlbUrl ? 'Xem trực tiếp Mesh AI Image-to-3D (.glb)' : 'Nạp hoặc dựng .GLB để xem'}
            >
              <Cpu className="w-3 h-3" />
              <span>Mesh AI (.GLB)</span>
            </button>
            <button
              type="button"
              onClick={() => activeSourceGlbUrl && setCraftViewMode('compare_glb')}
              disabled={!activeSourceGlbUrl}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer disabled:opacity-40 ${
                craftViewMode === 'compare_glb'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title={activeSourceGlbUrl ? 'So sánh song song Chế tác 3D ↔ Mesh AI GLB' : 'Cần có tệp .GLB để so sánh'}
            >
              So sánh Song song
            </button>
            <label className="px-2.5 py-1 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer">
              <Upload className="w-3 h-3" />
              <span>Nạp .GLB</span>
              <input type="file" accept=".glb,.gltf" className="hidden" onChange={handleUploadSourceGlb} />
            </label>
          </div>

          {glbInspection && (
            <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">
              GLB: {glbInspection.meshCount} mesh • {glbInspection.materialCount} mat • {glbInspection.textureCount} tex
              {glbInspection.boundingBoxCm
                ? ` • ${glbInspection.boundingBoxCm.x}×${glbInspection.boundingBoxCm.y}×${glbInspection.boundingBoxCm.z}cm`
                : ''}
            </span>
          )}
        </div>

        {/* HÀNG 4: PHASE 6 — HIỂN THỊ LƯỚI, TEXTURE & SO SÁNH BẢN GỐC ↔ TỐI ƯU PBR */}
        <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-teal-600" />
              <span>Chất lượng P6:</span>
            </span>
            <button
              type="button"
              onClick={() => setQualityEnhancement('optimized')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                qualityEnhancement === 'optimized'
                  ? 'bg-teal-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title="Áp dụng tinh chỉnh hình học + bản đồ PBR & UV Phase 6"
            >
              Tối ưu PBR
            </button>
            <button
              type="button"
              onClick={() => setQualityEnhancement('raw')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                qualityEnhancement === 'raw'
                  ? 'bg-slate-700 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title="Xem mô hình gốc thô trước khi tối ưu Phase 6"
            >
              Gốc thô
            </button>
            <button
              type="button"
              onClick={() => setQualityEnhancement('compare_quality')}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                qualityEnhancement === 'compare_quality'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title="Đặt cạnh nhau Bản gốc thô ↔ Bản tối ưu Phase 6"
            >
              So sánh Gốc↔Tối ưu
            </button>

            <div className="w-[1px] h-4 bg-slate-200 mx-0.5" />

            <button
              type="button"
              onClick={() => setWireframeMode((w) => !w)}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                wireframeMode
                  ? 'bg-violet-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title="Bật/Tắt chế độ xem khung dây (Wireframe)"
            >
              <Grid className="w-3 h-3" />
              <span>Lưới</span>
            </button>

            <button
              type="button"
              onClick={() => setTexturesEnabled((t) => !t)}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                texturesEnabled
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-slate-100 text-slate-500 border border-slate-200'
              }`}
              title="Bật/Tắt Texture & Normal/Roughness Map"
            >
              <ImageIcon className="w-3 h-3" />
              <span>{texturesEnabled ? 'Texture: Bật' : 'Texture: Tắt'}</span>
            </button>
          </div>

          {refinementSummary && (
            <span className="text-[10px] font-medium text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg">
              {refinementSummary.materialsEnhanced} vật liệu PBR • UV [0..1]: {Math.round(refinementSummary.after.uvCoverageRatio * 100)}%
              {refinementSummary.degenerateRemoved > 0 ? ` • Khử ${refinementSummary.degenerateRemoved} Δ lỗi` : ''}
            </span>
          )}
        </div>

        {/* HÀNG 5: PHASE 8 — QUẢN LÝ BỘ PHẬN 3D, PHÂN CẤP & MÔ PHỎNG LẮP RÁP */}
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 text-xs font-bold">
              <button
                type="button"
                onClick={() => setPhase8PanelTab('components')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                  phase8PanelTab === 'components'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5 text-sky-600" />
                <span>Bộ phận 3D ({components3D.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setPhase8PanelTab('assembly')}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer ${
                  phase8PanelTab === 'assembly'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ListChecks className="w-3.5 h-3.5 text-amber-600" />
                <span>Mô phỏng lắp ráp ({assemblyPlan?.steps.length || 0})</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              {hiddenComponentIds.length > 0 && (
                <button
                  type="button"
                  onClick={showAllComponents}
                  className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold border border-sky-200 flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  <span>Hiện tất cả ({hiddenComponentIds.length} đang ẩn)</span>
                </button>
              )}
              {selectedComponentId && (
                <button
                  type="button"
                  onClick={() => selectComponent3D(null)}
                  className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold cursor-pointer"
                >
                  Bỏ chọn
                </button>
              )}
            </div>
          </div>

          {phase8PanelTab === 'components' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
              {/* Component Hierarchy List */}
              <div className="md:col-span-7 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {components3D.map((comp) => {
                  const isHidden = hiddenComponentIds.includes(comp.id);
                  const isSelected = selectedComponentId === comp.id;
                  const distObj = separationDistances.find((d) => d.componentId === comp.id);
                  const hasParent = Boolean(comp.parentId);

                  return (
                    <div
                      key={comp.id}
                      className={`p-2 rounded-xl border transition flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-sky-50 border-sky-300 shadow-2xs'
                          : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/80'
                      } ${hasParent ? 'ml-4' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => selectComponent3D(comp.id)}
                        className="flex-1 text-left flex items-center gap-2 min-w-0 cursor-pointer"
                      >
                        <span
                          className="w-3 h-3 rounded-sm border border-slate-300 shrink-0"
                          style={{ backgroundColor: comp.colorHex }}
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 truncate flex items-center gap-1.5">
                            <span>{comp.name}</span>
                            {hasParent && (
                              <span className="text-[9px] font-mono text-slate-400">↳ con</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {comp.geometryTypes[0]} • {comp.triangleCount} Δ
                            {distObj && (explodedFactor > 0.02 || assemblyModeActive)
                              ? ` • Cách điểm tựa: ${distObj.distanceUnits}u${
                                  distObj.estimatedCm !== null ? ` (~${distObj.estimatedCm} cm)` : ''
                                }`
                              : ''}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => focusCameraOnComponent(comp.id)}
                          className="p-1.5 rounded-lg bg-white hover:bg-sky-100 text-slate-600 hover:text-sky-700 border border-slate-200 cursor-pointer"
                          title="Focus camera vào bộ phận này"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleComponentVisibility(comp.id)}
                          className={`p-1.5 rounded-lg border cursor-pointer ${
                            isHidden
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                          title={isHidden ? 'Hiện bộ phận' : 'Ẩn bộ phận'}
                        >
                          {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Component Inspector Panel */}
              <div className="md:col-span-5 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-[11px]">
                {(() => {
                  const activeComp =
                    components3D.find((c) => c.id === selectedComponentId) || components3D[0] || null;
                  if (!activeComp) {
                    return (
                      <p className="text-slate-500">
                        Chạm trực tiếp lên mô hình 3D hoặc chọn một mục bên trái để kiểm tra thông số bộ phận.
                      </p>
                    );
                  }
                  const parentObj = activeComp.parentId
                    ? components3D.find((p) => p.id === activeComp.parentId) || null
                    : null;
                  const sep = separationDistances.find((d) => d.componentId === activeComp.id);

                  return (
                    <>
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200">
                        <span className="font-extrabold text-slate-900 truncate">{activeComp.name}</span>
                        <span className="font-mono text-[10px] bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600">
                          {activeComp.id}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        <div>
                          <span className="text-slate-400 block">Hình học:</span>
                          <span className="font-semibold text-slate-700">{activeComp.geometrySummary}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Vật liệu PBR:</span>
                          <span className="font-semibold text-slate-700">{activeComp.materialSummary}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Vị trí (x,y,z):</span>
                          <span className="font-mono text-slate-700">
                            {activeComp.position.x}, {activeComp.position.y}, {activeComp.position.z}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Xoay / Tỉ lệ:</span>
                          <span className="font-mono text-slate-700">
                            ({activeComp.rotation.x},{activeComp.rotation.y},{activeComp.rotation.z}) / ×{activeComp.scale.y}
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] space-y-0.5 pt-1 border-t border-slate-200/80">
                        <div>
                          <span className="text-slate-400">Quan hệ cha-con: </span>
                          <span className="font-bold text-slate-800">
                            {parentObj ? `Thuộc "${parentObj.name}" (${parentObj.id})` : 'Khối gốc (Root)'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Liên kết: </span>
                          <span className="text-slate-700">{activeComp.connectionInfo}</span>
                        </div>
                        {sep && (explodedFactor > 0.02 || assemblyModeActive) && (
                          <div className="text-indigo-700 font-bold">
                            Khoảng cách tách hiện tại: {sep.distanceUnits} u
                            {sep.estimatedCm !== null ? ` (~${sep.estimatedCm} cm)` : ''}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {phase8PanelTab === 'assembly' && assemblyPlan && (
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between flex-wrap gap-2 p-2.5 rounded-2xl bg-slate-50 border border-slate-200">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-slate-800">
                      Trình tự lắp ráp từng bước ({assemblyPlan.steps.length} công đoạn)
                    </span>
                    {assemblyPlan.isSuggestedProcedure ? (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200 text-[10px] font-bold">
                        Quy trình đề xuất (thiếu dữ liệu khớp nối đầy đủ)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                        Theo cấu trúc phụ thuộc 3D
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    {assemblyPlan.uncertaintyReason || assemblyPlan.basisSummary}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (!assemblyModeActive) {
                        setExplodedFactor(0);
                        setAssemblyModeActive(true);
                        setAssemblyStepIdx(0);
                        setCompletedAssemblyStepIds([]);
                        setAssemblyPlaying(false);
                      } else {
                        setAssemblyModeActive(false);
                        setAssemblyPlaying(false);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-xl font-bold text-[11px] cursor-pointer transition ${
                      assemblyModeActive
                        ? 'bg-amber-600 text-white'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {assemblyModeActive ? 'Thoát mô phỏng' : 'Bắt đầu lắp ráp 3D'}
                  </button>
                  {assemblyModeActive && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setAssemblyPlaying(false);
                          setAssemblyStepIdx((p) => Math.max(0, p - 1));
                        }}
                        disabled={assemblyStepIdx === 0}
                        className="p-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer"
                        title="Bước trước"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssemblyPlaying((p) => !p)}
                        className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] flex items-center gap-1 cursor-pointer ${
                          assemblyPlaying
                            ? 'bg-amber-500 text-white'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {assemblyPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        <span>{assemblyPlaying ? 'Tạm dừng' : 'Phát'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAssemblyPlaying(false);
                          const curr = assemblyPlan.steps[assemblyStepIdx];
                          if (curr) {
                            setCompletedAssemblyStepIds((prev) =>
                              prev.includes(curr.stepId) ? prev : [...prev, curr.stepId]
                            );
                          }
                          setAssemblyStepIdx((p) =>
                            Math.min(assemblyPlan.steps.length - 1, p + 1)
                          );
                        }}
                        disabled={assemblyStepIdx >= assemblyPlan.steps.length - 1}
                        className="p-1.5 rounded-lg bg-white border border-slate-200 disabled:opacity-40 cursor-pointer"
                        title="Bước tiếp theo"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAssemblyPlaying(false);
                          setAssemblyStepIdx(0);
                          setCompletedAssemblyStepIds([]);
                        }}
                        className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                        title="Khởi động lại mô phỏng lắp ráp"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {assemblyPlan.steps.map((step, idx) => {
                  const isDone = completedAssemblyStepIds.includes(step.stepId);
                  const isCurrent = assemblyModeActive && idx === assemblyStepIdx;
                  return (
                    <div
                      key={step.stepId}
                      onClick={() => {
                        setAssemblyModeActive(true);
                        setAssemblyPlaying(false);
                        setAssemblyStepIdx(idx);
                        selectComponent3D(step.componentId);
                      }}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition space-y-1 ${
                        isCurrent
                          ? 'bg-amber-50 border-amber-300 shadow-2xs'
                          : isDone
                          ? 'bg-emerald-50/70 border-emerald-200'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 text-[10px]">
                        <span className="font-mono font-bold text-slate-500">
                          B{step.stepNumber} • {step.componentId}
                        </span>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setCompletedAssemblyStepIds((prev) =>
                              prev.includes(step.stepId)
                                ? prev.filter((x) => x !== step.stepId)
                                : [...prev, step.stepId]
                            );
                          }}
                          className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                            isDone
                              ? 'bg-emerald-600 text-white'
                              : isCurrent
                              ? 'bg-amber-200 text-amber-900'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isDone ? 'Đã lắp' : isCurrent ? 'Đang lắp' : 'Chờ'}
                        </button>
                      </div>
                      <div className="font-bold text-slate-900 text-[11px]">{step.action}</div>
                      <p className="text-[10px] text-slate-600 line-clamp-2">{step.description}</p>
                      <div className="text-[9px] font-mono text-slate-400">
                        Đích: ({step.targetPosition.x}, {step.targetPosition.y}, {step.targetPosition.z})
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* DÒNG HƯỚNG DẪN CỬ CHỈ & THÔNG SỐ GPU GỌN GÀNG */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span>Kéo để xoay 360°, cuộn để thu phóng, chạm vào từng bộ phận 3D để kiểm tra</span>
          </span>
          <span className="text-slate-400 text-[10px] font-mono">
            {gpuStats
              ? `WebGL: ${gpuStats.calls} calls • ${gpuStats.triangles} tris • ${gpuStats.textures} tex`
              : 'Chạm vào chi tiết 3D hoặc điểm tròn để xem thông tin'}
          </span>
        </div>
      </div>
    )}
  </div>
);
};

export type ResolvedCraftModelType =
  | 'bottle_pot'
  | 'pen_holder'
  | 'box_organizer'
  | 'lantern_lamp'
  | 'bird_feeder'
  | 'plastic_planter'
  | 'toy_car'
  | 'cardboard_house'
  | 'fabric_tote'
  | 'cap_mosaic';

export function resolveModelType(
  rawType?: string,
  title: string = '',
  description: string = ''
): ResolvedCraftModelType {
  const t = (rawType || '').toLowerCase().trim();
  const text = `${title} ${description} ${t}`.toLowerCase();

  // Prioritize explicit model3DType before fuzzy title/description matching
  if (t === 'plastic_planter' || t.includes('hydroponic')) return 'plastic_planter';
  if (t === 'bird_feeder') return 'bird_feeder';
  if (t === 'lantern_lamp' || t === 'tin_lamp') return 'lantern_lamp';
  if (t === 'cardboard_house') return 'cardboard_house';
  if (t === 'fabric_tote') return 'fabric_tote';
  if (t === 'cap_mosaic') return 'cap_mosaic';
  if (t === 'pen_holder') return 'pen_holder';
  if (t === 'box_organizer' || t === 'desk_organizer') return 'box_organizer';
  if (t === 'toy_car') return 'toy_car';
  if (t === 'bottle_pot' || t === 'planter') return 'bottle_pot';

  if (
    text.includes('thủy canh') ||
    text.includes('trồng rau') ||
    text.includes('chậu ngang') ||
    text.includes('chậu rau') ||
    text.includes('vườn rau')
  ) {
    return 'plastic_planter';
  }

  if (
    t === 'bird_feeder' ||
    text.includes('cho chim') ||
    text.includes('máng ăn') ||
    text.includes('nhà chim') ||
    text.includes('hộp sữa') ||
    text.includes('bird feeder') ||
    text.includes('chim ăn')
  ) {
    return 'bird_feeder';
  }

  if (
    t === 'lantern_lamp' ||
    t === 'tin_lamp' ||
    text.includes('đèn') ||
    text.includes('lồng đèn') ||
    text.includes('lantern') ||
    text.includes('lamp') ||
    text.includes('phát sáng') ||
    text.includes('nến') ||
    text.includes('lon đục lỗ')
  ) {
    return 'lantern_lamp';
  }

  if (
    t === 'cardboard_house' ||
    text.includes('ngôi nhà bìa') ||
    text.includes('nhà bìa') ||
    text.includes('nhà mô hình') ||
    text.includes('nhà tiết kiệm')
  ) {
    return 'cardboard_house';
  }

  if (
    t === 'fabric_tote' ||
    text.includes('túi cá') ||
    text.includes('túi vải') ||
    text.includes('quần jean') ||
    text.includes('denim')
  ) {
    return 'fabric_tote';
  }

  if (
    t === 'cap_mosaic' ||
    text.includes('rùa nắp') ||
    text.includes('nắp chai') ||
    text.includes('mosaic')
  ) {
    return 'cap_mosaic';
  }

  if (
    t === 'pen_holder' ||
    text.includes('bút') ||
    text.includes('ống cắm') ||
    text.includes('hộp bút') ||
    text.includes('cắm viết') ||
    text.includes('pen')
  ) {
    return 'pen_holder';
  }

  if (
    t === 'box_organizer' ||
    t === 'desk_organizer' ||
    text.includes('kệ') ||
    text.includes('organizer') ||
    text.includes('nhiều ngăn') ||
    text.includes('bìa carton') ||
    text.includes('khay đựng') ||
    text.includes('ngăn kéo')
  ) {
    return 'box_organizer';
  }

  if (
    t === 'toy_car' ||
    text.includes('xe') ||
    text.includes('ô tô') ||
    text.includes('bánh xe') ||
    text.includes('toy car')
  ) {
    return 'toy_car';
  }

  if (
    t === 'bottle_pot' ||
    t === 'planter' ||
    text.includes('chậu') ||
    text.includes('chai') ||
    text.includes('tưới') ||
    text.includes('cây') ||
    text.includes('hoa') ||
    text.includes('pot')
  ) {
    return 'bottle_pot';
  }

  return 'bottle_pot';
}

// Generate 3D Interactive Hotspot Markers
function buildInteractiveHotspots(group: THREE.Group, craft: CraftProduct) {
  const resolvedType = resolveModelType(craft.model3DType, craft.title, craft.description);

  const hotspotsMap: Record<string, ComponentHotspot[]> = {
    bottle_pot: [
      {
        id: 'hp_reservoir',
        name: 'Khoang chứa nước tự dưỡng',
        material: 'Đáy chai nhựa PET trong suốt 5 khía hoa chịu lực',
        role: 'Chứa nước sạch cung cấp độ ẩm liên tục cho cây cảnh cả tuần.',
        howToMake: 'Cắt ngang 1/3 thân chai tính từ đáy lên bằng dao trổ hoặc kéo bén.',
        safetyNotice: 'Mài nhẹ viền cắt bằng giấy nhám mịn để mép chai trơn láng.',
        position: new THREE.Vector3(0, 0.4, 0.8),
      },
      {
        id: 'hp_funnel',
        name: 'Phễu giữ đất & bấc cotton mao dẫn',
        material: 'Phần miệng chai úp ngược + dây bấc cotton hoặc vải sợi',
        role: 'Hút nước theo nguyên lý mao dẫn tự nhiên, giữ độ ẩm cân bằng cho rễ.',
        howToMake: 'Khoét lỗ 4mm ở nắp chai, luồn dây cotton thắt nút giữ một đầu trong phễu.',
        safetyNotice: 'Dùi lỗ nắp nhựa cẩn thận bằng dùi nhọn nung nóng.',
        position: new THREE.Vector3(0, 1.4, 0.8),
      },
      {
        id: 'hp_plant',
        name: 'Cây mầm xanh sen đá & sỏi trang trí',
        material: 'Đất hữu cơ vi sinh + sỏi sông đa sắc',
        role: 'Thanh lọc không khí và tạo điểm nhấn sinh động trên bàn học.',
        howToMake: 'Cho đất vào phễu, đặt cây vào giữa và rải sỏi bề mặt giữ ẩm.',
        safetyNotice: 'Tưới đẫm nước lần đầu để kích hoạt bấc thấm.',
        position: new THREE.Vector3(0, 2.0, 0.4),
      },
    ],
    pen_holder: [
      {
        id: 'hp_holder_body',
        name: 'Thân ống cắm bút tai mèo thủ công',
        material: 'Chai nhựa PET sơn màu pastel hoặc lon nhôm',
        role: 'Đựng bút, thước, compa, kéo gọn gàng trên bàn làm việc.',
        howToMake: 'Vẽ phác thảo hình 2 tai mèo lên thân chai trước khi cắt lượn theo viền.',
        safetyNotice: 'Cắt chậm rãi theo đường vòng cung của tai để không bị phạm.',
        position: new THREE.Vector3(0, 1.0, 0.72),
      },
      {
        id: 'hp_stationery',
        name: 'Bộ dụng cụ học tập bên trong',
        material: 'Bút gel mực xanh, bút chì gỗ vàng & thước kẻ trong suốt',
        role: 'Phục vụ học tập và ghi chép hàng ngày.',
        howToMake: 'Sắp xếp bút cao ở phía sau và gôm tẩy thỏ nhỏ ở phía trước.',
        safetyNotice: '',
        position: new THREE.Vector3(0.2, 1.6, 0.2),
      },
      {
        id: 'hp_bell',
        name: 'Vòng cổ chuông vàng may mắn',
        material: 'Dây ruy băng đỏ + chuông kim loại mạ vàng',
        role: 'Tạo điểm nhấn phong cách Kawaii đáng yêu cho bàn học.',
        howToMake: 'Buộc quanh cổ lọ và đính chuông nhỏ bằng keo nến.',
        safetyNotice: '',
        position: new THREE.Vector3(0, 0.55, 0.76),
      },
    ],
    box_organizer: [
      {
        id: 'hp_tiers',
        name: 'Kệ 3 bậc bìa carton chịu lực',
        material: 'Bìa carton sóng 3 lớp cứng cáp',
        role: 'Phân tầng không gian lưu trữ từ thấp đến cao, không bị che khuất đồ.',
        howToMake: 'Cắt các mảnh vách ngăn chữ U theo độ cao 5cm - 9cm - 13cm rồi dán ghép.',
        safetyNotice: 'Dùng keo nến hoặc keo sữa dán kỹ các khớp nối chịu tải.',
        position: new THREE.Vector3(0, 0.55, 0.5),
      },
      {
        id: 'hp_slots',
        name: 'Ngăn đứng để sổ tay & điện thoại',
        material: 'Vách ngăn carton bọc giấy kraft vintage',
        role: 'Giữ sổ ghi chép, phong bì thư và điện thoại đứng vững.',
        howToMake: 'Tạo khe trượt 2mm để lồng các vách ngăn vuông góc với nhau.',
        safetyNotice: '',
        position: new THREE.Vector3(0, 1.1, -0.45),
      },
      {
        id: 'hp_postit',
        name: 'Khay giấy nhớ Post-it & kẹp giấy',
        material: 'Tập giấy note vàng + kẹp ghim kim loại bọc nhựa màu',
        role: 'Lưu trữ các vật dụng văn phòng phẩm nhỏ hay bị thất lạc.',
        howToMake: 'Dán nẹp chặn thấp ở tầng trước mặt kệ.',
        safetyNotice: '',
        position: new THREE.Vector3(-0.45, 0.65, 0.45),
      },
    ],
    lantern_lamp: [
      {
        id: 'hp_light_core',
        name: 'Lõi đèn LED phát sáng ấm áp',
        material: 'Nến điện tử LED pin cúc áo hoặc chuỗi đèn fairy lights',
        role: 'Phát nguồn sáng ấm cúng an toàn tuyệt đối, không gây khói hay cháy.',
        howToMake: 'Đặt đế nến LED vào đáy lon hoặc chai thủy tinh.',
        safetyNotice: 'Không sử dụng nến sáp lửa thật với vật liệu nhựa kín.',
        position: new THREE.Vector3(0, 0.45, 0),
      },
      {
        id: 'hp_can_holes',
        name: 'Họa tiết lỗ đục tán sắc nghệ thuật',
        material: 'Thân lon nhôm hoặc chai thủy tinh đục lỗ hình chòm sao',
        role: 'Tạo hiệu ứng ánh sáng lung linh rọi bóng lên tường xung quanh.',
        howToMake: 'Đổ nước vào lon rồi bỏ ngăn đá tủ lạnh trước khi dùi lỗ để lon không bị móp.',
        safetyNotice: 'Cẩn thận đầu đinh nhọn khi đóng lỗ tán quang.',
        position: new THREE.Vector3(0, 1.0, 0.68),
      },
      {
        id: 'hp_wire_handle',
        name: 'Quai xách dây thép uốn rustic',
        material: 'Dây kẽm bọc nhựa hoặc dây đồng cổ điển',
        role: 'Dùng để treo lồng đèn lên cành cây, ban công hoặc xách tay.',
        howToMake: 'Uốn cong hình bán nguyệt và móc vào 2 lỗ đối xứng ở miệng lon.',
        safetyNotice: 'Bẻ gập đầu dây thép vào trong để không bị xước tay.',
        position: new THREE.Vector3(0, 1.9, 0),
      },
    ],
    bird_feeder: [
      {
        id: 'hp_portal',
        name: 'Cửa vòm đón chim ăn & khay sâu',
        material: 'Hộp sữa tiệt trùng 1L hoặc can nhựa lớn cắt khoét',
        role: 'Cửa mở rộng thoáng đãng cho các chú chim sẻ, chích bông dễ dàng bay vào.',
        howToMake: 'Vẽ hình vòm tròn cách đáy hộp 4cm và khoét bỏ mảng phía trước.',
        safetyNotice: 'Dán băng keo giấy quanh mép cắt để chim không bị trầy chân.',
        position: new THREE.Vector3(0, 0.9, 0.6),
      },
      {
        id: 'hp_seeds',
        name: 'Khay hạt ngũ cốc dinh dưỡng',
        material: 'Hạt thóc vàng, hạt kê, hạt hướng dương',
        role: 'Cung cấp nguồn thức ăn giàu năng lượng cho chim hoang dã.',
        howToMake: 'Đổ đầy lớp hạt dày 3-4cm ở đáy hộp.',
        safetyNotice: 'Đục 2-3 lỗ nhỏ li ti dưới đáy để thoát nước mưa tránh ẩm mốc.',
        position: new THREE.Vector3(0, 0.5, 0.2),
      },
      {
        id: 'hp_perch',
        name: 'Cành đậu gỗ tre & chú chim nhỏ',
        material: 'Que đũa tre hoặc cành cây tự nhiên đường kính 8mm',
        role: 'Giúp chim có điểm tựa vững chãi để đậu trước khi vào ăn.',
        howToMake: 'Đục lỗ xuyên qua 2 vách đối diện và luồn que tre thò ra ngoài 8cm.',
        safetyNotice: 'Cố định điểm nối bằng keo nến chắc chắn.',
        position: new THREE.Vector3(0, 0.52, 0.95),
      },
    ],
    plastic_planter: [
      {
        id: 'hp_stand',
        name: 'Giá đỡ chữ X chống lật bằng gỗ',
        material: 'Thanh gỗ tre / que kem lắp chéo hình chữ X',
        role: 'Giữ thân chai tròn nằm ngang thăng bằng vững chãi trên bàn.',
        howToMake: 'Dán chéo 2 cặp thanh gỗ và liên kết bằng thanh giằng ngang.',
        safetyNotice: 'Dán keo nến đều tay để 4 chân tiếp đất cân bằng.',
        position: new THREE.Vector3(0, 0.35, 0.6),
      },
      {
        id: 'hp_leca',
        name: 'Lớp sỏi đất nung LECA giữ ẩm',
        material: 'Viên đất nung xốp kích thước 8-12mm',
        role: 'Tạo khoảng thở thoáng khí cho rễ và giữ độ ẩm tối ưu cho rau mầm.',
        howToMake: 'Rải một lớp sỏi LECA đều khắp đáy chai nằm ngang.',
        safetyNotice: 'Rửa sạch bụi sỏi trước khi cho vào chậu.',
        position: new THREE.Vector3(0, 0.65, 0),
      },
      {
        id: 'hp_sprouts',
        name: 'Mầm rau thơm & bạc hà thủy canh',
        material: 'Cây giống rau mầm, xà lách hoặc ngò gai',
        role: 'Cung cấp rau sạch tươi ngon cho bữa ăn gia đình ngay tại bàn.',
        howToMake: 'Cắm rễ cây xen giữa các viên sỏi và châm nước dinh dưỡng loãng.',
        safetyNotice: 'Đặt chậu ở nơi có nhiều ánh sáng mặt trời gián tiếp.',
        position: new THREE.Vector3(0, 1.25, 0),
      },
    ],
    toy_car: [
      {
        id: 'hp_body',
        name: 'Khung gầm thân xe nhựa PET',
        material: 'Thân chai nhựa PET 500ml nguyên bản',
        role: 'Tạo thân chịu lực và cabin khoét mui cho xe.',
        howToMake: 'Cắt khoét ô chữ nhật trên mui, dùi 4 lỗ trục đối xứng xuyên qua thân.',
        safetyNotice: 'Dùi nhẹ tay tránh làm bẹp mép chai.',
        position: new THREE.Vector3(0, 0.9, 0),
      },
      {
        id: 'hp_wheels',
        name: 'Bánh xe nắp chai HDPE & Trục tre',
        material: '4 nắp chai nhựa HDPE + 2 que tăm tre + keo nến',
        role: 'Giúp xe lăn mượt mà trên mặt sàn phẳng.',
        howToMake: 'Đục lỗ tâm nắp chai, xỏ tăm tre qua thân chai và chấm keo nến chặn hai đầu.',
        safetyNotice: 'Không để keo dính chặt vào thân chai làm kẹt trục.',
        position: new THREE.Vector3(0.9, 0.35, 0.7),
      },
    ],
    cardboard_house: [
      {
        id: 'hp_walls',
        name: 'Khung tường bìa carton 3 lớp',
        material: 'Bìa carton sóng cứng cắt ghép hình ngôi nhà',
        role: 'Tạo khối hộp kiến trúc và cửa sổ đón sáng.',
        howToMake: 'Đo và rọc 4 mặt tường, trổ khung cửa sổ rồi dán góc bằng keo nến.',
        safetyNotice: 'Dùng thước kim loại khi rọc dao dọc giấy.',
        position: new THREE.Vector3(-0.35, 0.85, 0.78),
      },
      {
        id: 'hp_roof',
        name: 'Mái ngói chữ A & đèn LED trang trí',
        material: 'Tấm bìa gập đôi + dây LED nhỏ 3V',
        role: 'Che mái và tạo ánh sáng ấm áp trang trí góc học tập.',
        howToMake: 'Gấp bìa thành mái dốc và gắn dây đèn theo viền mái.',
        safetyNotice: 'Không dùng lửa hoặc nến thật gần bìa giấy.',
        position: new THREE.Vector3(0, 1.7, 0.5),
      },
    ],
    fabric_tote: [
      {
        id: 'hp_pouch',
        name: 'Thân túi vải Jean tái chế',
        material: 'Ống quần jean cũ khâu viền chắc chắn',
        role: 'Tạo ngăn đựng bút viết, phụ kiện cá nhân bền đẹp.',
        howToMake: 'Cắt ống quần dài 22cm, lộn mặt trái may kín đáy rồi đính nút gỗ.',
        safetyNotice: 'Cẩn thận kim khâu tay khi may đường viền.',
        position: new THREE.Vector3(0, 1.2, 0.35),
      },
    ],
    cap_mosaic: [
      {
        id: 'hp_shell',
        name: 'Mai rùa & tranh ghép từ nắp chai HDPE',
        material: 'Nắp chai nhựa nhiều màu + tấm nền tái chế',
        role: 'Tạo hình nghệ thuật mosaic bền màu và giáo dục phân loại nhựa.',
        howToMake: 'Rửa sạch nắp chai, sắp xếp phối màu rồi cố định bằng keo sữa/keo nến.',
        safetyNotice: 'Dán keo ở nơi thông thoáng.',
        position: new THREE.Vector3(0, 0.65, 0.45),
      },
    ],
  };

  const currentHotspots = hotspotsMap[resolvedType] || hotspotsMap.bottle_pot;

  currentHotspots.forEach((hp) => {
    const ringGeo = new THREE.RingGeometry(0.08, 0.12, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(hp.position);
    ring.userData = hp;

    const dotGeo = new THREE.CircleGeometry(0.06, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(hp.position).add(new THREE.Vector3(0, 0, 0.001));
    dot.userData = hp;

    group.add(ring);
    group.add(dot);
  });
}

export function buildPhotorealisticCraftMesh(
  group: THREE.Group,
  craft: CraftProduct,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const resolved = resolveModelType(craft.model3DType, craft.title, craft.description);

  switch (resolved) {
    case 'plastic_planter':
      buildPhotorealPlasticPlanterCraft(group, subparts, showDecorations);
      break;
    case 'bird_feeder':
      buildPhotorealBirdFeederCraft(group, subparts, showDecorations);
      break;
    case 'lantern_lamp':
      buildPhotorealLanternLampCraft(group, subparts, showDecorations);
      break;
    case 'pen_holder':
      buildPhotorealPenHolderCraft(group, subparts, showDecorations);
      break;
    case 'box_organizer':
      buildPhotorealBoxOrganizerCraft(group, subparts, showDecorations);
      break;
    case 'cardboard_house':
      buildPhotorealCardboardHouseCraft(group, subparts, showDecorations);
      break;
    case 'fabric_tote':
      buildPhotorealFabricToteCraft(group, subparts, showDecorations);
      break;
    case 'cap_mosaic':
      buildPhotorealCapMosaicCraft(group, subparts, showDecorations);
      break;
    case 'toy_car':
      buildPhotorealToyCarCraft(group, subparts, showDecorations);
      break;
    case 'bottle_pot':
    default:
      buildPhotorealPlanterCraft(group, subparts, showDecorations);
      break;
  }
}

/**
 * Adapts primary recycled container appearance & subtle proportional scale inside the 3D workshop
 * using the scanned MaterialItem reconstruction payload when available.
 */
function applySourceMaterialAdaptation(
  craftGroup: THREE.Group,
  sourceMaterial?: MaterialItem | null
) {
  if (!sourceMaterial) return;
  const recon = sourceMaterial.reconstruction;
  const rawHex = recon?.appearance?.primaryColor || sourceMaterial.color;
  if (!rawHex) return;

  const targetColor = new THREE.Color(normalizeHexColor(rawHex, '#94a3b8'));
  const targetRoughness = recon?.appearance?.roughness;
  const targetMetalness = recon?.appearance?.metalness;

  const primaryContainerNames = new Set([
    'bottom_reservoir',
    'assembly_funnel',
    'body',
    'can_body',
    'box_base',
    'bottle_body',
  ]);

  craftGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    let isContainer = primaryContainerNames.has(mesh.name);
    let p: THREE.Object3D | null = mesh.parent;
    while (!isContainer && p) {
      if (primaryContainerNames.has(p.name)) isContainer = true;
      p = p.parent;
    }
    if (!isContainer) return;

    const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
    if (!mat || !('color' in mat)) return;
    // Gently blend scanned material tint without erasing texture detail or water/soil/plant hues
    if (mesh.name === 'bottom' || mesh.name.includes('water') || mesh.name.includes('plant')) return;
    mat.color.lerp(targetColor, 0.45);
    if (typeof targetRoughness === 'number' && !mat.map) {
      mat.roughness = THREE.MathUtils.lerp(mat.roughness, targetRoughness, 0.35);
    }
    if (typeof targetMetalness === 'number' && !mat.map) {
      mat.metalness = THREE.MathUtils.lerp(mat.metalness, targetMetalness, 0.35);
    }
    mat.needsUpdate = true;
  });

  // Gentle proportional aspect adaptation based on scanned dimensions
  const h = recon?.dimensions?.heightCm ?? sourceMaterial.dimensions?.heightCm;
  const w = recon?.dimensions?.widthCm ?? sourceMaterial.dimensions?.widthCm;
  if (h && w && h > 0 && w > 0) {
    const ratio = h / w;
    const clampedY = THREE.MathUtils.clamp(ratio / 2.2, 0.85, 1.22);
    craftGroup.scale.set(1, clampedY, 1);
  }
}

// -------------------------------------------------------------
// Decorative Handcrafted Helpers (Thủ công mỹ nghệ)
// -------------------------------------------------------------

// Cute expressive glossy eye with shine reflection
function createCuteKawaiiEye(radius: number = 0.045): THREE.Group {
  const eyeGroup = new THREE.Group();
  const pupilGeo = new THREE.CircleGeometry(radius, 24);
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
  const pupil = new THREE.Mesh(pupilGeo, pupilMat);
  eyeGroup.add(pupil);

  // Big sparkle shine dot
  const shineGeo = new THREE.CircleGeometry(radius * 0.42, 16);
  const shineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const shine1 = new THREE.Mesh(shineGeo, shineMat);
  shine1.position.set(radius * 0.32, radius * 0.32, 0.001);
  eyeGroup.add(shine1);

  // Tiny catchlight dot
  const shine2Geo = new THREE.CircleGeometry(radius * 0.2, 12);
  const shine2 = new THREE.Mesh(shine2Geo, shineMat);
  shine2.position.set(-radius * 0.3, -radius * 0.28, 0.001);
  eyeGroup.add(shine2);

  return eyeGroup;
}

// Vintage rustic jute twine bow knot with dangling wooden beads
function createJuteTwineBow(twineMat: THREE.Material, woodMat: THREE.Material): THREE.Group {
  const bow = new THREE.Group();
  bow.name = 'decorations';
  bow.userData = { isDecoration: true };

  // Center knot
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 12), twineMat);
  bow.add(knot);

  // Left loop
  const loopL = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.024, 12, 24), twineMat);
  loopL.rotation.z = 0.45;
  loopL.position.set(-0.13, 0.04, 0);
  bow.add(loopL);

  // Right loop
  const loopR = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.024, 12, 24), twineMat);
  loopR.rotation.z = -0.45;
  loopR.position.set(0.13, 0.04, 0);
  bow.add(loopR);

  // Dangling tails with wooden beads
  for (let s of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 8), twineMat);
    tail.rotation.z = s * 0.35;
    tail.position.set(s * 0.08, -0.16, 0);
    bow.add(tail);

    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 12), woodMat);
    bead.position.set(s * 0.13, -0.3, 0);
    bead.castShadow = true;
    bow.add(bead);
  }

  return bow;
}

// 1. Photorealistic Self-Watering Planter (Chậu cây tự dưỡng từ chai nhựa PET thực tế + Decor xinh xắn)
function buildPhotorealPlanterCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const petMat = createRecycledPETMaterial();
  const cutLipMat = createHandCutLipMaterial();
  const capMat = createHDPECapMaterial(0x0284c7); // Vivid blue HDPE bottle cap
  const soilMat = createPottingSoilMaterial();
  const woodMat = createBambooAxleMaterial();

  const plantLeafMat = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    roughness: 0.28,
    metalness: 0.04,
  });

  const wickMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.85,
    metalness: 0.02,
  });

  const juteMat = new THREE.MeshStandardMaterial({
    color: 0xd97706, // Natural warm burlap twine
    roughness: 0.92,
    metalness: 0.02,
  });

  // -------------------------------------------------------------
  // PART 1: Bottom Reservoir (Chân chai 5 khía cánh hoa thực tế)
  // -------------------------------------------------------------
  const reservoirGroup = new THREE.Group();
  reservoirGroup.name = 'bottom_reservoir';
  reservoirGroup.position.set(0, 0, 0);

  // Main lower cylindrical wall with realistic reinforcement rib indentations
  const baseCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.76, 1.1, 48, 1, true), petMat);
  baseCylinder.position.set(0, 0.55, 0);
  baseCylinder.castShadow = true;
  baseCylinder.receiveShadow = true;
  reservoirGroup.add(baseCylinder);

  // Real bottle waistline reinforcement rib (gân chịu lực lõm ngang trên chai nước)
  const ribGeo = new THREE.TorusGeometry(0.74, 0.035, 16, 48);
  const ribMesh = new THREE.Mesh(ribGeo, petMat);
  ribMesh.rotation.x = Math.PI / 2;
  ribMesh.position.set(0, 0.5, 0);
  reservoirGroup.add(ribMesh);

  // Handcrafted cut lip (gờ cắt kéo thủ công có viền mịn phản chiếu)
  const cutLipGeo = new THREE.TorusGeometry(0.78, 0.024, 16, 48);
  const cutLipMesh = new THREE.Mesh(cutLipGeo, cutLipMat);
  cutLipMesh.rotation.x = Math.PI / 2;
  cutLipMesh.position.set(0, 1.1, 0);
  reservoirGroup.add(cutLipMesh);

  // 5-Lobed Petal Base (Đáy chai 5 khía hoa chịu lực đặc trưng của chai PET ngoài đời)
  const baseFloor = new THREE.Mesh(new THREE.CircleGeometry(0.76, 32), petMat);
  baseFloor.rotation.x = Math.PI / 2;
  baseFloor.position.set(0, 0.03, 0);
  reservoirGroup.add(baseFloor);

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const footMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), petMat);
    footMesh.scale.set(1.0, 0.45, 1.4);
    footMesh.rotation.y = angle;
    footMesh.position.set(Math.cos(angle) * 0.52, 0.05, Math.sin(angle) * 0.52);
    footMesh.castShadow = true;
    reservoirGroup.add(footMesh);
  }

  // Pure Water level with refractive surface
  const waterGeo = new THREE.CylinderGeometry(0.75, 0.73, 0.52, 40);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    roughness: 0.04,
    transmission: 0.92,
    thickness: 0.8,
    ior: 1.33,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'bottom';
  waterMesh.position.set(0, 0.32, 0);
  reservoirGroup.add(waterMesh);

  // --- DECORATION 1: Cute Hand-painted Kawaii Face on Lower Pot Wall ---
  const faceGroup = new THREE.Group();
  faceGroup.name = 'decorations';
  faceGroup.userData = { isDecoration: true };
  faceGroup.visible = showDecorations;

  // Eyes
  const eyeLeft = createCuteKawaiiEye(0.045);
  eyeLeft.position.set(-0.2, 0.72, 0.78);
  faceGroup.add(eyeLeft);

  const eyeRight = createCuteKawaiiEye(0.045);
  eyeRight.position.set(0.2, 0.72, 0.78);
  faceGroup.add(eyeRight);

  // Soft Peach-Pink Blushing Cheeks
  const blushMat = new THREE.MeshBasicMaterial({
    color: 0xfda4af,
    transparent: true,
    opacity: 0.75,
  });
  const blushL = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blushMat);
  blushL.position.set(-0.31, 0.64, 0.75);
  faceGroup.add(blushL);

  const blushR = new THREE.Mesh(new THREE.CircleGeometry(0.055, 16), blushMat);
  blushR.position.set(0.31, 0.64, 0.75);
  faceGroup.add(blushR);

  // Happy Smile Arc
  const smileCurve = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.012, 8, 24, Math.PI * 0.7),
    new THREE.MeshBasicMaterial({ color: 0x1e293b })
  );
  smileCurve.rotation.z = Math.PI * 0.65;
  smileCurve.position.set(0, 0.64, 0.78);
  faceGroup.add(smileCurve);

  reservoirGroup.add(faceGroup);

  group.add(reservoirGroup);
  subparts.push({
    id: 'bottom_reservoir',
    mesh: reservoirGroup,
    basePos: reservoirGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.4, 0),
    label: 'Khoang chứa nước tự dưỡng (đáy chai)',
    partRole: 'bottom',
    parentKey: null,
    connectionInfo: 'Đế 5 khía đặt trực tiếp lên mặt bàn làm bệ đỡ cho toàn bộ chậu.',
  });

  // -------------------------------------------------------------
  // PART 2: Inverted Funnel (Miệng chai lộn ngược & nắp đục lỗ)
  // -------------------------------------------------------------
  const funnelGroup = new THREE.Group();
  funnelGroup.name = 'assembly_funnel';
  funnelGroup.position.set(0, 1.35, 0);

  // Inverted conical bottle shoulder
  const funnelGeo = new THREE.CylinderGeometry(0.76, 0.34, 1.05, 48, 1, true);
  const funnelMesh = new THREE.Mesh(funnelGeo, petMat);
  funnelMesh.name = 'body';
  funnelMesh.castShadow = true;
  funnelMesh.receiveShadow = true;
  funnelGroup.add(funnelMesh);

  // Upper cut lip on the funnel top
  const funnelLip = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.024, 16, 48), cutLipMat);
  funnelLip.rotation.x = Math.PI / 2;
  funnelLip.position.set(0, 0.52, 0);
  funnelGroup.add(funnelLip);

  // Bottle screw threads on neck
  const neckCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.3, 32), petMat);
  neckCylinder.position.y = -0.55;
  funnelGroup.add(neckCylinder);

  const threadRing1 = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.015, 12, 32), petMat);
  threadRing1.rotation.x = Math.PI / 2;
  threadRing1.position.y = -0.50;
  funnelGroup.add(threadRing1);

  const threadRing2 = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.015, 12, 32), petMat);
  threadRing2.rotation.x = Math.PI / 2;
  threadRing2.position.y = -0.56;
  funnelGroup.add(threadRing2);

  // Screwed Blue HDPE Bottle Cap with hole
  const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 32), capMat);
  capMesh.name = 'assembly';
  capMesh.position.y = -0.68;
  capMesh.castShadow = true;
  funnelGroup.add(capMesh);

  // Braided Cotton Wick passing through cap hole
  const wickGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.0, 16);
  const wickMesh = new THREE.Mesh(wickGeo, wickMat);
  wickMesh.name = 'assembly';
  wickMesh.position.y = -0.75;
  wickMesh.castShadow = true;
  funnelGroup.add(wickMesh);

  // Potting Soil inside the funnel with granular surface
  const soilGeo = new THREE.CylinderGeometry(0.72, 0.35, 0.8, 36);
  const soilMesh = new THREE.Mesh(soilGeo, soilMat);
  soilMesh.name = 'body';
  soilMesh.position.y = 0.06;
  soilMesh.receiveShadow = true;
  funnelGroup.add(soilMesh);

  // --- DECORATION 2: Vintage Jute Twine Bow around the Planter Lip ---
  const twineGroup = new THREE.Group();
  twineGroup.name = 'decorations';
  twineGroup.userData = { isDecoration: true };
  twineGroup.visible = showDecorations;

  const twineRing = new THREE.Mesh(new THREE.TorusGeometry(0.77, 0.022, 12, 48), juteMat);
  twineRing.rotation.x = Math.PI / 2;
  twineRing.position.set(0, 0.49, 0);
  twineGroup.add(twineRing);

  const twineBow = createJuteTwineBow(juteMat, woodMat);
  twineBow.position.set(0, 0.49, 0.78);
  twineGroup.add(twineBow);
  funnelGroup.add(twineGroup);

  // --- DECORATION 3: Smooth Polished River Pebbles on Soil Surface ---
  const pebblesGroup = new THREE.Group();
  pebblesGroup.name = 'decorations';
  pebblesGroup.userData = { isDecoration: true };
  pebblesGroup.visible = showDecorations;

  const pebbleColors = [0xf8fafc, 0xfbcfe8, 0xa7f3d0, 0xfde68a, 0xe0e7ff, 0xfef08a, 0xffedd5];
  for (let p = 0; p < 8; p++) {
    const angle = (p / 8) * Math.PI * 2 + 0.3;
    const rad = 0.42 + (p % 3) * 0.08;
    const pMat = new THREE.MeshStandardMaterial({
      color: pebbleColors[p % pebbleColors.length],
      roughness: 0.18,
      metalness: 0.08,
    });
    const pebble = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), pMat);
    pebble.scale.set(1.2, 0.45, 0.9);
    pebble.rotation.y = angle * 1.5;
    pebble.position.set(Math.cos(angle) * rad, 0.47, Math.sin(angle) * rad);
    pebble.castShadow = true;
    pebblesGroup.add(pebble);
  }
  funnelGroup.add(pebblesGroup);

  // --- DECORATION 4: Tiny Eco Garden Flag Tag ("Eco ♥") ---
  const flagGroup = new THREE.Group();
  flagGroup.name = 'decorations';
  flagGroup.userData = { isDecoration: true };
  flagGroup.visible = showDecorations;

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 8), woodMat);
  stick.position.set(0.42, 0.65, -0.2);
  stick.rotation.z = -0.2;
  flagGroup.add(stick);

  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.14, 0.01),
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 })
  );
  flag.position.set(0.48, 0.76, -0.2);
  flag.rotation.z = -0.2;
  flagGroup.add(flag);

  // Tiny red heart on flag
  const heartDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 })
  );
  heartDot.position.set(0.48, 0.76, -0.19);
  flagGroup.add(heartDot);

  funnelGroup.add(flagGroup);

  // Succulent Plant rosette with organic gradient petals
  const plantGroup = new THREE.Group();
  plantGroup.name = 'top_plant';
  plantGroup.position.y = 0.46;

  // Concentric fleshy succulent leaves
  for (let ring = 0; ring < 2; ring++) {
    const leafCount = ring === 0 ? 8 : 6;
    const ringRadius = ring === 0 ? 0.26 : 0.16;
    const leafScale = ring === 0 ? 1.0 : 0.75;

    for (let i = 0; i < leafCount; i++) {
      const angle = (i / leafCount) * Math.PI * 2 + ring * 0.4;
      const leafGeo = new THREE.ConeGeometry(0.18 * leafScale, 0.48 * leafScale, 8);
      const leafMesh = new THREE.Mesh(leafGeo, plantLeafMat);
      leafMesh.rotation.z = 0.72;
      leafMesh.rotation.y = angle;
      leafMesh.position.set(Math.cos(angle) * ringRadius, 0.08 + ring * 0.08, Math.sin(angle) * ringRadius);
      leafMesh.castShadow = true;
      plantGroup.add(leafMesh);
    }
  }

  // --- DECORATION 5: Blooming Coral-Pink Flower with Golden Pollen Center ---
  const flowerGroup = new THREE.Group();
  flowerGroup.name = 'decorations';
  flowerGroup.userData = { isDecoration: true };
  flowerGroup.visible = showDecorations;

  // Slender flower stalk
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), plantLeafMat);
  stalk.position.set(0.04, 0.24, 0.02);
  stalk.rotation.z = -0.12;
  flowerGroup.add(stalk);

  // Bright warm yellow pollen sphere
  const pollenMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.3,
    roughness: 0.3,
  });
  const pollen = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), pollenMat);
  pollen.position.set(0.07, 0.4, 0.02);
  flowerGroup.add(pollen);

  // 5 delicate coral-pink petals
  const petalMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    roughness: 0.4,
  });
  for (let i = 0; i < 5; i++) {
    const pAngle = (i / 5) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), petalMat);
    petal.position.set(0.07 + Math.cos(pAngle) * 0.07, 0.4, 0.02 + Math.sin(pAngle) * 0.07);
    petal.rotation.z = Math.PI / 2;
    petal.rotation.y = pAngle;
    flowerGroup.add(petal);
  }

  plantGroup.add(flowerGroup);
  funnelGroup.add(plantGroup);

  group.add(funnelGroup);
  subparts.push({
    id: 'assembly_funnel',
    mesh: funnelGroup,
    basePos: funnelGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.5, 0),
    label: 'Phễu ngược, nắp đục lỗ & bấc cotton',
    partRole: 'assembly',
    parentKey: 'bottom_reservoir',
    connectionInfo: 'Lồng úp ngược khít lên miệng khoang chứa nước ở dưới.',
  });
  subparts.push({
    id: 'top_plant',
    mesh: plantGroup,
    basePos: plantGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.8, 0),
    label: 'Cụm cây sen đá & hoa trang trí',
    partRole: 'top',
    parentKey: 'assembly_funnel',
    connectionInfo: 'Trồng bám rễ trong lớp đất hữu cơ phía trên phễu ngược.',
  });

  // Cutting Guideline marker
  const cutLineGeo = new THREE.TorusGeometry(0.82, 0.02, 16, 64);
  const cutLineMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
  const cutLine = new THREE.Mesh(cutLineGeo, cutLineMat);
  cutLine.name = 'cut_guide_line';
  cutLine.rotation.x = Math.PI / 2;
  cutLine.position.y = 1.1;
  group.add(cutLine);
  subparts.push({
    id: 'cut_guide_line',
    mesh: cutLine,
    basePos: cutLine.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.12, 0),
    label: 'Đường cắt ngang 1/3 thân chai',
    partRole: 'cut_line',
    parentKey: 'bottom_reservoir',
    connectionInfo: 'Ranh giới cắt tách phần đáy chứa nước và phần phễu úp ngược.',
  });
}

// 2. Photorealistic Toy Car (Xe Đua Bánh Nắp Chai Tái Chế 100% + Tem Đua #7, Vô Lăng & Spoiler)
function buildPhotorealToyCarCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const petMat = createRecycledPETMaterial();
  const cutLipMat = createHandCutLipMaterial();
  const capMatBlue = createHDPECapMaterial(0x1d4ed8);
  const capMatRed = createHDPECapMaterial(0xdc2626);
  const bambooMat = createBambooAxleMaterial();
  const glueMat = createHotGlueMaterial();
  const chromeMat = createBrushedAluminumMaterial();

  // -------------------------------------------------------------
  // CAR BODY: Horizontal PET bottle with handcrafted cockpit
  // -------------------------------------------------------------
  const carBody = new THREE.Group();
  carBody.name = 'body';
  carBody.position.set(0, 0.65, 0);

  // Main horizontal bottle cylinder
  const mainCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.2, 48), petMat);
  mainCylinder.rotation.x = Math.PI / 2;
  mainCylinder.castShadow = true;
  mainCylinder.receiveShadow = true;
  carBody.add(mainCylinder);

  // Horizontal reinforcement ribs on car body
  for (let z of [-0.6, 0.1, 0.7]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.025, 12, 40), petMat);
    ring.position.set(0, 0, z);
    carBody.add(ring);
  }

  // Front tapered bottle neck & threaded nose
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.48, 0.5, 32), petMat);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, 0, 1.35);
  neck.castShadow = true;
  carBody.add(neck);

  // Front nose cap
  const frontCap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.22, 32), capMatBlue);
  frontCap.rotation.x = Math.PI / 2;
  frontCap.position.set(0, 0, 1.65);
  frontCap.castShadow = true;
  carBody.add(frontCap);

  // Hand-cut cockpit opening with curled lip border
  const cockpitHole = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.85), cutLipMat);
  cockpitHole.name = 'cut_guide_line';
  cockpitHole.position.set(0, 0.56, -0.2);
  carBody.add(cockpitHole);

  // Folded seat backrest inside cockpit
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.05), petMat);
  seatBack.position.set(0, 0.35, -0.55);
  seatBack.rotation.x = -0.25;
  carBody.add(seatBack);

  // --- CAR DECORATION 1: Twin Racing Stripes along the Hood & Roof ---
  const stripesGroup = new THREE.Group();
  stripesGroup.name = 'decorations';
  stripesGroup.userData = { isDecoration: true };
  stripesGroup.visible = showDecorations;

  const whiteStripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const yellowStripeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

  const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.01, 1.6), whiteStripeMat);
  stripeL.position.set(-0.06, 0.56, 0.3);
  stripesGroup.add(stripeL);

  const stripeR = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.01, 1.6), yellowStripeMat);
  stripeR.position.set(0.06, 0.56, 0.3);
  stripesGroup.add(stripeR);

  // --- CAR DECORATION 2: Racing Number Plate "#7" Roundel on Hood ---
  const numBadgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const numBadge = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), numBadgeMat);
  numBadge.rotation.x = -Math.PI / 2 + 0.2;
  numBadge.position.set(0, 0.53, 0.92);
  stripesGroup.add(numBadge);

  // "#7" digit decal
  const digitH = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.005), new THREE.MeshBasicMaterial({ color: 0x1d4ed8 }));
  digitH.rotation.x = -Math.PI / 2 + 0.2;
  digitH.position.set(0, 0.535, 0.97);
  stripesGroup.add(digitH);

  const digitDiag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.005), new THREE.MeshBasicMaterial({ color: 0x1d4ed8 }));
  digitDiag.rotation.x = -Math.PI / 2 + 0.2;
  digitDiag.rotation.z = -0.7;
  digitDiag.position.set(-0.02, 0.535, 0.92);
  stripesGroup.add(digitDiag);

  // --- CAR DECORATION 3: Twin Amber Headlights with Chrome Bezels ---
  const headlampMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.6,
    roughness: 0.1,
  });

  for (let s of [-1, 1]) {
    const lampBezel = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 12, 24), chromeMat);
    lampBezel.position.set(s * 0.36, 0.15, 1.48);
    stripesGroup.add(lampBezel);

    const lampLens = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), headlampMat);
    lampLens.scale.set(1, 1, 0.5);
    lampLens.position.set(s * 0.36, 0.15, 1.5);
    stripesGroup.add(lampLens);
  }

  // --- CAR DECORATION 4: Twin Red Sport Tail-lights ---
  const taillampMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.5,
    roughness: 0.2,
  });
  for (let s of [-1, 1]) {
    const tailLens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16), taillampMat);
    tailLens.rotation.x = Math.PI / 2;
    tailLens.position.set(s * 0.38, 0.12, -1.1);
    stripesGroup.add(tailLens);
  }

  // --- CAR DECORATION 5: Mini Cockpit Steering Wheel ---
  const steeringGroup = new THREE.Group();
  steeringGroup.position.set(0, 0.28, 0.05);

  const steerCol = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), bambooMat);
  steerCol.rotation.x = 0.5;
  steeringGroup.add(steerCol);

  const steerWheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 12, 24), capMatBlue);
  steerWheel.rotation.x = 0.5;
  steerWheel.position.set(0, 0.1, 0.05);
  steeringGroup.add(steerWheel);

  stripesGroup.add(steeringGroup);

  // --- CAR DECORATION 6: Aerodynamic Rear Spoiler Wing ---
  const spoilerGroup = new THREE.Group();
  spoilerGroup.position.set(0, 0.5, -0.95);

  // Upright struts
  for (let s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.06), cutLipMat);
    strut.position.set(s * 0.42, 0.14, 0);
    spoilerGroup.add(strut);
  }

  // Horizontal Aerofoil
  const aerofoil = new THREE.Mesh(
    new THREE.BoxGeometry(1.22, 0.035, 0.26),
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35 })
  );
  aerofoil.position.set(0, 0.28, 0);
  aerofoil.castShadow = true;
  spoilerGroup.add(aerofoil);

  // Endplates in vibrant yellow
  for (let s of [-1, 1]) {
    const endplate = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.14, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 })
    );
    endplate.position.set(s * 0.61, 0.28, 0);
    spoilerGroup.add(endplate);
  }

  stripesGroup.add(spoilerGroup);

  // --- CAR DECORATION 7: Dual Chrome Exhaust Pipes ---
  for (let s of [-1, 1]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 16, 1, true), chromeMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(s * 0.18, -0.15, -1.18);
    stripesGroup.add(exhaust);
  }

  carBody.add(stripesGroup);

  group.add(carBody);
  subparts.push({
    id: 'car_body',
    mesh: carBody,
    basePos: carBody.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.5, 0),
    label: 'Khung thân xe chai nhựa PET',
    partRole: 'body',
    parentKey: null,
    connectionInfo: 'Khung chính nâng đỡ khoang lái, nắp mũi và 2 cụm trục bánh xe.',
  });

  // -------------------------------------------------------------
  // FRONT AXLE & WHEELS (Bamboo skewer + Blue HDPE Caps + Glue beads)
  // -------------------------------------------------------------
  const frontAxleGroup = new THREE.Group();
  frontAxleGroup.name = 'assembly_front_wheels';
  frontAxleGroup.position.set(0, 0.35, 0.7);

  const axleFront = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 16), bambooMat);
  axleFront.rotation.z = Math.PI / 2;
  axleFront.castShadow = true;
  frontAxleGroup.add(axleFront);

  // Left wheel (Blue cap)
  const wheelFL = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 32), capMatBlue);
  wheelFL.rotation.z = Math.PI / 2;
  wheelFL.position.set(0.92, 0, 0);
  wheelFL.castShadow = true;
  frontAxleGroup.add(wheelFL);

  const glueFL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), glueMat);
  glueFL.position.set(1.04, 0, 0);
  frontAxleGroup.add(glueFL);

  // Right wheel (Blue cap)
  const wheelFR = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 32), capMatBlue);
  wheelFR.rotation.z = Math.PI / 2;
  wheelFR.position.set(-0.92, 0, 0);
  wheelFR.castShadow = true;
  frontAxleGroup.add(wheelFR);

  const glueFR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), glueMat);
  glueFR.position.set(-1.04, 0, 0);
  frontAxleGroup.add(glueFR);

  group.add(frontAxleGroup);
  subparts.push({
    id: 'assembly_front_wheels',
    mesh: frontAxleGroup,
    basePos: frontAxleGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.4, 0.4),
    label: 'Cụm trục tre & 2 bánh trước (nắp xanh)',
    partRole: 'assembly',
    parentKey: 'car_body',
    connectionInfo: 'Xỏ xuyên ngang qua 2 lỗ đối xứng phần đầu khung chai PET.',
  });

  // -------------------------------------------------------------
  // REAR AXLE & WHEELS (Bamboo skewer + Red HDPE Caps + Glue beads)
  // -------------------------------------------------------------
  const rearAxleGroup = new THREE.Group();
  rearAxleGroup.name = 'assembly_rear_wheels';
  rearAxleGroup.position.set(0, 0.35, -0.7);

  const axleRear = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 16), bambooMat);
  axleRear.rotation.z = Math.PI / 2;
  axleRear.castShadow = true;
  rearAxleGroup.add(axleRear);

  // Left rear wheel (Red cap)
  const wheelRL = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 32), capMatRed);
  wheelRL.rotation.z = Math.PI / 2;
  wheelRL.position.set(0.92, 0, 0);
  wheelRL.castShadow = true;
  rearAxleGroup.add(wheelRL);

  const glueRL = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), glueMat);
  glueRL.position.set(1.04, 0, 0);
  rearAxleGroup.add(glueRL);

  // Right rear wheel (Red cap)
  const wheelRR = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 32), capMatRed);
  wheelRR.rotation.z = Math.PI / 2;
  wheelRR.position.set(-0.92, 0, 0);
  wheelRR.castShadow = true;
  rearAxleGroup.add(wheelRR);

  const glueRR = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), glueMat);
  glueRR.position.set(-1.04, 0, 0);
  rearAxleGroup.add(glueRR);

  group.add(rearAxleGroup);
  subparts.push({
    id: 'assembly_rear_wheels',
    mesh: rearAxleGroup,
    basePos: rearAxleGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.4, -0.4),
    label: 'Cụm trục tre & 2 bánh sau (nắp đỏ)',
    partRole: 'assembly',
    parentKey: 'car_body',
    connectionInfo: 'Xỏ xuyên ngang qua 2 lỗ đối xứng phần đuôi khung chai PET.',
  });
}

// 3. Photorealistic Cute Cat-Ear Pen Holder (Hộp cắm bút tai mèo + Chuông Vàng, Thước Kẻ & Gôm Thỏ)
function buildPhotorealPenHolderCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const petMat = createRecycledPETMaterial({ tintColor: 0xfef08a, roughness: 0.3 });
  const cutLipMat = createHandCutLipMaterial();
  const woodMat = createBambooAxleMaterial();

  const bodyH = 1.6;
  const bodyGeo = new THREE.CylinderGeometry(0.66, 0.64, bodyH, 48, 1, true);
  const bodyMesh = new THREE.Mesh(bodyGeo, petMat);
  bodyMesh.name = 'body';
  bodyMesh.position.y = bodyH / 2;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);
  subparts.push({
    id: 'pen_holder_body',
    mesh: bodyMesh,
    basePos: bodyMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.2, 0),
    label: 'Thân ống cắm bút PET',
    partRole: 'body',
    parentKey: 'pen_holder_bottom',
    connectionInfo: 'Thành ống đứng gắn liền phần đáy, viền cắt hình tai mèo ở miệng trên.',
  });

  // 5-lobed base
  const baseMesh = new THREE.Mesh(new THREE.CircleGeometry(0.64, 32), petMat);
  baseMesh.name = 'bottom';
  baseMesh.rotation.x = Math.PI / 2;
  baseMesh.position.y = 0.02;
  group.add(baseMesh);
  subparts.push({
    id: 'pen_holder_bottom',
    mesh: baseMesh,
    basePos: baseMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.35, 0),
    label: 'Mặt đáy chịu lực ống bút',
    partRole: 'bottom',
    parentKey: null,
    connectionInfo: 'Đáy chai giữ thăng bằng cho toàn bộ ống cắm bút.',
  });

  // Hand-cut Cat Ears at the top rim
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.38, 4), cutLipMat);
  earL.name = 'top';
  earL.position.set(-0.35, bodyH + 0.12, 0.45);
  earL.rotation.z = -0.22;
  earL.castShadow = true;
  group.add(earL);

  const earR = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.38, 4), cutLipMat);
  earR.name = 'top';
  earR.position.set(0.35, bodyH + 0.12, 0.45);
  earR.rotation.z = 0.22;
  earR.castShadow = true;
  group.add(earR);

  // --- PEN HOLDER DECORATION 1: Soft Pastel Pink Inner Ears ---
  const earsDecorGroup = new THREE.Group();
  earsDecorGroup.name = 'decorations';
  earsDecorGroup.userData = { isDecoration: true };
  earsDecorGroup.visible = showDecorations;

  const innerEarMat = new THREE.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.7 });
  const innerEarL = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 4), innerEarMat);
  innerEarL.position.set(-0.35, bodyH + 0.1, 0.48);
  innerEarL.rotation.z = -0.22;
  earsDecorGroup.add(innerEarL);

  const innerEarR = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 4), innerEarMat);
  innerEarR.position.set(0.35, bodyH + 0.1, 0.48);
  innerEarR.rotation.z = 0.22;
  earsDecorGroup.add(innerEarR);

  // --- PEN HOLDER DECORATION 2: Kawaii Cat Face Details ---
  // Cute glossy anime eyes
  const catEyeL = createCuteKawaiiEye(0.05);
  catEyeL.position.set(-0.24, 1.15, 0.66);
  earsDecorGroup.add(catEyeL);

  const catEyeR = createCuteKawaiiEye(0.05);
  catEyeR.position.set(0.24, 1.15, 0.66);
  earsDecorGroup.add(catEyeR);

  // Pink triangle heart nose
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.04, 0.05, 3),
    new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.3 })
  );
  nose.rotation.z = Math.PI;
  nose.position.set(0, 1.05, 0.67);
  earsDecorGroup.add(nose);

  // Soft peach blush cheeks
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xfda4af, transparent: true, opacity: 0.75 });
  const catBlushL = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), blushMat);
  catBlushL.position.set(-0.38, 1.02, 0.62);
  earsDecorGroup.add(catBlushL);

  const catBlushR = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), blushMat);
  catBlushR.position.set(0.38, 1.02, 0.62);
  earsDecorGroup.add(catBlushR);

  // Hand-drawn marker whiskers on the front
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x1f2937 });
  for (let s of [-1, 1]) {
    for (let w = 0; w < 3; w++) {
      const whisker = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.01), markerMat);
      whisker.position.set(s * 0.32, 0.95 + (w - 1) * 0.06, 0.65);
      whisker.rotation.z = s * (w - 1) * 0.12;
      earsDecorGroup.add(whisker);
    }
  }

  // --- PEN HOLDER DECORATION 3: Crimson Collar with Golden Bell ---
  const collarRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.665, 0.026, 16, 48),
    new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.5 })
  );
  collarRing.rotation.x = Math.PI / 2;
  collarRing.position.set(0, 0.55, 0);
  earsDecorGroup.add(collarRing);

  // Golden Bell Sphere
  const bellMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    metalness: 0.88,
    roughness: 0.16,
  });
  const goldenBell = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 16), bellMat);
  goldenBell.position.set(0, 0.53, 0.74);
  goldenBell.castShadow = true;
  earsDecorGroup.add(goldenBell);

  // Small slit on bell
  const bellSlit = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.02), new THREE.MeshBasicMaterial({ color: 0x78350f }));
  bellSlit.position.set(0, 0.5, 0.79);
  earsDecorGroup.add(bellSlit);

  group.add(earsDecorGroup);

  // -------------------------------------------------------------
  // Stationery inside (gel pen, pencil, 15cm ruler, bunny eraser)
  // -------------------------------------------------------------
  const penGroup = new THREE.Group();
  penGroup.name = 'assembly_pens';
  penGroup.position.set(0, bodyH * 0.6, 0);

  // Clear gel pen with blue ink core
  const penBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 1.45, 16),
    new THREE.MeshPhysicalMaterial({ transmission: 0.9, roughness: 0.1, thickness: 0.4 })
  );
  penBarrel.position.set(0.18, 0.4, 0);
  penBarrel.rotation.z = -0.15;
  penBarrel.castShadow = true;
  penGroup.add(penBarrel);

  const penInk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1.1, 12),
    new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.2 })
  );
  penInk.position.set(0.18, 0.35, 0);
  penInk.rotation.z = -0.15;
  penGroup.add(penInk);

  // Yellow wooden pencil with pink eraser
  const pencilBody = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.55, 6), woodMat);
  pencilBody.position.set(-0.16, 0.45, 0.1);
  pencilBody.rotation.z = 0.18;
  pencilBody.castShadow = true;
  penGroup.add(pencilBody);

  // --- PEN HOLDER DECORATION 4: Cute Pink Bunny Eraser Topper ---
  const bunnyGroup = new THREE.Group();
  bunnyGroup.name = 'decorations';
  bunnyGroup.userData = { isDecoration: true };
  bunnyGroup.visible = showDecorations;
  bunnyGroup.position.set(-0.16, 1.25, 0.1);
  bunnyGroup.rotation.z = 0.18;

  const bunnyMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.7 });
  const bunnyBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.12), bunnyMat);
  bunnyGroup.add(bunnyBody);

  const earBL = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), bunnyMat);
  earBL.position.set(-0.04, 0.14, 0);
  bunnyGroup.add(earBL);

  const earBR = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 8), bunnyMat);
  earBR.position.set(0.04, 0.14, 0);
  bunnyGroup.add(earBR);
  penGroup.add(bunnyGroup);

  // --- PEN HOLDER DECORATION 5: Translucent Yellow 15cm School Ruler ---
  const rulerGroup = new THREE.Group();
  rulerGroup.name = 'decorations';
  rulerGroup.userData = { isDecoration: true };
  rulerGroup.visible = showDecorations;

  const rulerMat = new THREE.MeshPhysicalMaterial({
    color: 0xfde047,
    roughness: 0.15,
    transmission: 0.85,
    thickness: 0.2,
    transparent: true,
    opacity: 0.9,
  });
  const rulerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.55, 0.02), rulerMat);
  rulerMesh.position.set(-0.02, 0.5, -0.12);
  rulerMesh.rotation.z = -0.08;
  rulerMesh.rotation.x = -0.15;
  rulerMesh.castShadow = true;
  rulerGroup.add(rulerMesh);

  // Ruler tick marks
  const tickMat = new THREE.MeshBasicMaterial({ color: 0x854d0e });
  for (let t = 0; t < 12; t++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.022), tickMat);
    tick.position.set(0.03, -0.6 + t * 0.11, 0);
    rulerMesh.add(tick);
  }
  penGroup.add(rulerGroup);

  group.add(penGroup);
  subparts.push({
    id: 'assembly_pens',
    mesh: penGroup,
    basePos: penGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.8, 0),
    label: 'Bộ bút, thước kẻ & gôm bên trong',
    partRole: 'assembly',
    parentKey: 'pen_holder_body',
    connectionInfo: 'Đặt gọn vào lòng ống cắm bút sau khi hoàn thiện mép cắt.',
  });
}

// 4. Photorealistic Cardboard Miniature House (Ngôi Nhà Bìa Carton + Bồn Hoa Bậu Cửa & Dây Đèn LED)
function buildPhotorealCardboardHouseCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const kraftMat = createKraftCardboardMaterial();
  const glueMat = createHotGlueMaterial();
  const woodMat = createBambooAxleMaterial();

  const houseW = 1.8;
  const houseH = 1.3;
  const houseD = 1.5;

  // Main Kraft walls box
  const wallsGeo = new THREE.BoxGeometry(houseW, houseH, houseD);
  const wallsMesh = new THREE.Mesh(wallsGeo, kraftMat);
  wallsMesh.name = 'body';
  wallsMesh.position.y = houseH / 2;
  wallsMesh.castShadow = true;
  wallsMesh.receiveShadow = true;
  group.add(wallsMesh);
  subparts.push({
    id: 'house_walls',
    mesh: wallsMesh,
    basePos: wallsMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.2, 0),
    label: 'Khung tường bìa carton 4 mặt',
    partRole: 'body',
    parentKey: null,
    connectionInfo: 'Khối tường chịu lực chính đặt trên nền bàn, nâng đỡ mái ngói chữ A.',
  });

  // --- HOUSE DECORATION 1: Window Flower Planter Box with Blooming Daisies ---
  const houseDecorGroup = new THREE.Group();
  houseDecorGroup.name = 'decorations';
  houseDecorGroup.userData = { isDecoration: true };
  houseDecorGroup.visible = showDecorations;

  // Window frame cut
  const windowFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.55, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
  );
  windowFrame.position.set(-0.35, 0.82, houseD / 2 + 0.01);
  houseDecorGroup.add(windowFrame);

  // Planter box under window
  const planterBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.14, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 })
  );
  planterBox.position.set(-0.35, 0.5, houseD / 2 + 0.1);
  planterBox.castShadow = true;
  houseDecorGroup.add(planterBox);

  // Soil inside window box
  const boxSoil = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.04, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x3f2e1e, roughness: 0.95 })
  );
  boxSoil.position.set(-0.35, 0.56, houseD / 2 + 0.1);
  houseDecorGroup.add(boxSoil);

  // 5 mini blooming flowers (white daisies with yellow centers)
  const daisyYellowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3 });
  const daisyWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  for (let f = 0; f < 5; f++) {
    const fx = -0.58 + f * 0.11;
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), daisyYellowMat);
    center.position.set(fx, 0.62, houseD / 2 + 0.1 + (f % 2) * 0.03);
    houseDecorGroup.add(center);

    const petals = new THREE.Mesh(new THREE.CircleGeometry(0.045, 6), daisyWhiteMat);
    petals.rotation.x = -0.3;
    petals.position.set(fx, 0.62, houseD / 2 + 0.1 + (f % 2) * 0.03);
    houseDecorGroup.add(petals);
  }

  // --- HOUSE DECORATION 2: Front Porch Wooden Step & Brass Doorknob ---
  const doorstep = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.28), woodMat);
  doorstep.position.set(0.45, 0.03, houseD / 2 + 0.14);
  doorstep.castShadow = true;
  houseDecorGroup.add(doorstep);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.8, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.7 })
  );
  door.position.set(0.45, 0.44, houseD / 2 + 0.01);
  houseDecorGroup.add(door);

  const doorknob = new THREE.Mesh(
    new THREE.SphereGeometry(0.032, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.85, roughness: 0.2 })
  );
  doorknob.position.set(0.6, 0.44, houseD / 2 + 0.03);
  houseDecorGroup.add(doorknob);

  // Tiny craft picket fence beside porch
  for (let p = 0; p < 3; p++) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.32, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
    );
    post.position.set(0.75 + p * 0.08, 0.16, houseD / 2 + 0.15);
    houseDecorGroup.add(post);
  }

  group.add(houseDecorGroup);

  // -------------------------------------------------------------
  // Corrugated Gable Roof with exposed fluting edge & Fairy Lights
  // -------------------------------------------------------------
  const roofGroup = new THREE.Group();
  roofGroup.name = 'top_roof';
  roofGroup.position.set(0, houseH, 0);

  const roofGeo = new THREE.ConeGeometry(1.3, 0.9, 4);
  const roofMesh = new THREE.Mesh(roofGeo, kraftMat);
  roofMesh.rotation.y = Math.PI / 4;
  roofMesh.scale.set(1.12, 1.0, 0.92);
  roofMesh.position.y = 0.45;
  roofMesh.castShadow = true;
  roofGroup.add(roofMesh);

  // Chimney made from folded carton
  const chimGeo = new THREE.BoxGeometry(0.26, 0.62, 0.26);
  const chimMesh = new THREE.Mesh(chimGeo, kraftMat);
  chimMesh.position.set(0.45, 0.6, 0.2);
  chimMesh.castShadow = true;
  roofGroup.add(chimMesh);

  // Visible hot glue bead along the roof ridge
  for (let z of [-0.3, 0, 0.3]) {
    const glueDrop = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), glueMat);
    glueDrop.position.set(0, 0.9, z);
    roofGroup.add(glueDrop);
  }

  // --- HOUSE DECORATION 3: Fairy String Lights with Glowing Colorful LEDs ---
  const fairyGroup = new THREE.Group();
  fairyGroup.name = 'decorations';
  fairyGroup.userData = { isDecoration: true };
  fairyGroup.visible = showDecorations;

  // Draped catenary wire along the front roof eaves
  const wireGeo = new THREE.CylinderGeometry(0.008, 0.008, 1.6, 16);
  const wireMesh = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({ color: 0x334155 }));
  wireMesh.rotation.z = Math.PI / 2;
  wireMesh.position.set(0, 0.08, houseD / 2 + 0.05);
  fairyGroup.add(wireMesh);

  // 7 colorful glowing mini LED droplets
  const ledColors = [0xfef08a, 0xfbcfe8, 0xa7f3d0, 0xbae6fd, 0xfde047, 0xf472b6, 0x6ee7b7];
  for (let i = 0; i < 7; i++) {
    const lx = -0.65 + i * 0.21;
    const ly = 0.04 - Math.sin((i / 6) * Math.PI) * 0.06; // catenary sag
    const col = ledColors[i % ledColors.length];
    const bulbMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.9,
      roughness: 0.1,
    });
    bulbMat.userData.preserveEmissive = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 10), bulbMat);
    bulb.scale.set(1.0, 1.35, 1.0);
    bulb.position.set(lx, ly, houseD / 2 + 0.06);
    fairyGroup.add(bulb);
  }

  roofGroup.add(fairyGroup);

  group.add(roofGroup);
  subparts.push({
    id: 'top_roof',
    mesh: roofGroup,
    basePos: roofGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.8, 0),
    label: 'Mái ngói chữ A, ống khói & đèn LED',
    partRole: 'top',
    parentKey: 'house_walls',
    connectionInfo: 'Gắn cố định bằng keo nến lên mép trên khung tường nhà carton.',
  });
}

// 4. Photorealistic Decorative Lantern / Tin Lamp (Đèn Lồng Tái Chế Phát Sáng Ấm Áp + PointLight Thật)
function buildPhotorealLanternLampCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const metalMat = createBrushedAluminumMaterial(0xc0c8d4);
  const woodMat = createBambooAxleMaterial();
  const wireMat = createRusticWireMaterial(0xb45309);
  const glowCoreMat = createWarmLanternLightMaterial();
  glowCoreMat.userData.preserveEmissive = true;

  const canH = 1.6;
  const canGeo = new THREE.CylinderGeometry(0.65, 0.65, canH, 48, 1, true);
  const canMesh = new THREE.Mesh(canGeo, metalMat);
  canMesh.name = 'body';
  canMesh.position.y = canH / 2;
  canMesh.castShadow = true;
  canMesh.receiveShadow = true;
  group.add(canMesh);
  subparts.push({
    id: 'lantern_body',
    mesh: canMesh,
    basePos: canMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.15, 0),
    label: 'Thân lồng đèn đục lỗ tán quang',
    partRole: 'body',
    parentKey: 'lantern_bottom',
    connectionInfo: 'Thành trụ kim loại bao quanh lõi đèn LED và nâng quai xách phía trên.',
  });

  // Stamped bottom rim
  const baseMesh = new THREE.Mesh(new THREE.CircleGeometry(0.65, 32), metalMat);
  baseMesh.name = 'bottom';
  baseMesh.rotation.x = Math.PI / 2;
  baseMesh.position.y = 0.01;
  group.add(baseMesh);
  subparts.push({
    id: 'lantern_bottom',
    mesh: baseMesh,
    basePos: baseMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.35, 0),
    label: 'Đế lon kim loại đỡ nến LED',
    partRole: 'bottom',
    parentKey: null,
    connectionInfo: 'Đáy chịu lực giữ thăng bằng cho thân lon và nến LED bên trong.',
  });

  // Warm LED Candle inside
  const ledMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.35, 24), glowCoreMat);
  ledMesh.name = 'assembly';
  ledMesh.position.y = 0.25;
  group.add(ledMesh);
  subparts.push({
    id: 'lantern_led_core',
    mesh: ledMesh,
    basePos: ledMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.55, 0.45),
    label: 'Lõi đèn nến điện tử LED an toàn',
    partRole: 'assembly',
    parentKey: 'lantern_bottom',
    connectionInfo: 'Đặt vào tâm đáy bên trong lòng lồng đèn.',
  });

  // Flame droplet
  const flameMesh = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 12), glowCoreMat);
  flameMesh.position.set(0, 0.5, 0);
  group.add(flameMesh);

  // REAL Three.js Point Light emanating from inside the lantern
  const lanternLight = new THREE.PointLight(0xffaa33, 2.8, 5.5, 1.2);
  lanternLight.position.set(0, 0.52, 0);
  lanternLight.castShadow = true;
  lanternLight.shadow.bias = -0.002;
  group.add(lanternLight);

  // Punched holes pattern forming constellation / stars
  const holeMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
  for (let i = 0; i < 36; i++) {
    const angle = (i / 36) * Math.PI * 2;
    const y = 0.32 + ((i * 7) % 24) * 0.045;
    const dotGeo = new THREE.SphereGeometry(0.034, 8, 8);
    const dot = new THREE.Mesh(dotGeo, holeMat);
    dot.position.set(Math.cos(angle) * 0.655, y, Math.sin(angle) * 0.655);
    group.add(dot);
  }

  // --- LANTERN DECORATION: Rustic Jute Ribbon & 4-Hole Wooden Button ---
  const tinDecorGroup = new THREE.Group();
  tinDecorGroup.name = 'decorations';
  tinDecorGroup.userData = { isDecoration: true };
  tinDecorGroup.visible = showDecorations;

  const ribbonMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.655, 0.024, 12, 48),
    new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.9 })
  );
  ribbonMesh.rotation.x = Math.PI / 2;
  ribbonMesh.position.set(0, canH - 0.18, 0);
  tinDecorGroup.add(ribbonMesh);

  const buttonMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 24), woodMat);
  buttonMesh.rotation.x = Math.PI / 2;
  buttonMesh.position.set(0, canH - 0.18, 0.68);
  tinDecorGroup.add(buttonMesh);

  // Button thread cross
  const threadMat = new THREE.MeshBasicMaterial({ color: 0x92400e });
  const thread1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.01), threadMat);
  thread1.position.set(0, canH - 0.18, 0.7);
  tinDecorGroup.add(thread1);

  group.add(tinDecorGroup);

  // Rustic twisted wire handle arching overhead
  const handleGeo = new THREE.TorusGeometry(0.58, 0.022, 16, 32, Math.PI);
  const handleMesh = new THREE.Mesh(handleGeo, wireMat);
  handleMesh.name = 'top';
  handleMesh.position.set(0, canH, 0);
  handleMesh.castShadow = true;
  group.add(handleMesh);
  subparts.push({
    id: 'lantern_handle',
    mesh: handleMesh,
    basePos: handleMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.65, 0),
    label: 'Quai xách dây thép uốn vòm',
    partRole: 'top',
    parentKey: 'lantern_body',
    connectionInfo: 'Móc vào 2 lỗ đối xứng sát miệng trên thân lon.',
  });
}

// 5. Photorealistic Tiered Desk Box Organizer (Kệ Bìa Carton Nhiều Ngăn Cứng Cáp + Post-it & Kẹp Giấy)
function buildPhotorealBoxOrganizerCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const kraftMat = createKraftCardboardMaterial();

  // Bottom Base Board
  const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.4), kraftMat);
  baseMesh.name = 'bottom';
  baseMesh.position.set(0, 0.05, 0);
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  group.add(baseMesh);
  subparts.push({
    id: 'organizer_base',
    mesh: baseMesh,
    basePos: baseMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.35, 0),
    label: 'Tấm đáy chịu lực bìa carton',
    partRole: 'bottom',
    parentKey: null,
    connectionInfo: 'Mặt đế phẳng đỡ toàn bộ 3 tầng hộp phân ngăn phía trên.',
  });

  // Tier 1 (Front shallow tray)
  const tier1 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.4), kraftMat);
  tier1.name = 'body';
  tier1.position.set(0, 0.35, 0.45);
  tier1.castShadow = true;
  group.add(tier1);
  subparts.push({
    id: 'tier1_front',
    mesh: tier1,
    basePos: tier1.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.1, 0.55),
    label: 'Ngăn trước thấp (giấy nhớ & ghim)',
    partRole: 'body',
    parentKey: 'organizer_base',
    connectionInfo: 'Dán cố định lên mép trước tấm đáy carton.',
  });

  // Front lip washi tape decoration
  const orgDecorGroup = new THREE.Group();
  orgDecorGroup.name = 'decorations';
  orgDecorGroup.userData = { isDecoration: true };
  orgDecorGroup.visible = showDecorations;

  // Canary Yellow Post-it Sticky Pad
  const postIt = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.045, 0.38),
    new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.6 })
  );
  postIt.position.set(-0.45, 0.62, 0.45);
  orgDecorGroup.add(postIt);

  // 3 Colorful Metallic Paperclips
  const clipColors = [0xec4899, 0x3b82f6, 0x10b981];
  for (let c = 0; c < 3; c++) {
    const clip = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.008, 8, 16, Math.PI),
      new THREE.MeshStandardMaterial({ color: clipColors[c], metalness: 0.7, roughness: 0.3 })
    );
    clip.position.set(0.28 + c * 0.14, 0.62, 0.45);
    clip.rotation.x = -Math.PI / 2;
    orgDecorGroup.add(clip);
  }
  tier1.add(orgDecorGroup);

  // Tier 2 (Middle slot)
  const tier2 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 0.4), kraftMat);
  tier2.name = 'body';
  tier2.position.set(0, 0.55, 0);
  tier2.castShadow = true;
  group.add(tier2);
  subparts.push({
    id: 'tier2_middle',
    mesh: tier2,
    basePos: tier2.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.45, 0),
    label: 'Ngăn giữa (điện thoại & bút)',
    partRole: 'assembly',
    parentKey: 'organizer_base',
    connectionInfo: 'Ghép tiếp giáp sau ngăn trước trên tấm đáy.',
  });

  // Smartphone / Notepad resting in middle tier
  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.68, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.2 })
  );
  phone.rotation.x = -0.15;
  phone.position.set(0.42, 1.15, 0);
  phone.castShadow = true;
  tier2.add(phone);

  // Tier 3 (Back tall section for notebooks and letters)
  const tier3 = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.35, 0.4), kraftMat);
  tier3.name = 'assembly';
  tier3.position.set(0, 0.78, -0.45);
  tier3.castShadow = true;
  group.add(tier3);
  subparts.push({
    id: 'tier3_back',
    mesh: tier3,
    basePos: tier3.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.2, -0.55),
    label: 'Ngăn sau cao (sổ tay & tài liệu)',
    partRole: 'top',
    parentKey: 'organizer_base',
    connectionInfo: 'Dán sát cạnh sau tấm đáy làm vách tựa cao nhất.',
  });

  // Spiral A5 Kraft Notebook inside back slot
  const book = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 1.1, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 })
  );
  book.rotation.z = -0.05;
  book.rotation.x = -0.08;
  book.position.set(-0.25, 1.45, -0.45);
  book.castShadow = true;
  tier3.add(book);
}

// 6. Photorealistic Bird Feeder Craft (Ngôi Nhà / Máng Cho Chim Ăn Từ Hộp Sữa Giấy Có Chú Chim Nhỏ Đậu Cành)
function buildPhotorealBirdFeederCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const cartonMat = createKraftCardboardMaterial();
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.65 }); // Sky blue carton paint
  const woodMat = createBambooAxleMaterial();
  const seedMat = createBirdSeedMaterial();
  const wireMat = createRusticWireMaterial(0xb45309);
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 });
  const birdBodyMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.4 }); // Cute cyan songbird
  const birdWingMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });

  // 1. MAIN FEEDER CARTON BODY
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'carton_feeder_body';
  bodyGroup.position.set(0, 0.9, 0);

  const cartonW = 1.3;
  const cartonH = 1.5;
  const cartonD = 1.1;
  const wallsMesh = new THREE.Mesh(new THREE.BoxGeometry(cartonW, cartonH, cartonD), cartonMat);
  wallsMesh.castShadow = true;
  wallsMesh.receiveShadow = true;
  bodyGroup.add(wallsMesh);

  // Large circular feeding portal hole cut on the front wall
  const portalR = 0.38;
  const portalRim = new THREE.Mesh(
    new THREE.TorusGeometry(portalR, 0.035, 16, 32),
    createHandCutLipMaterial()
  );
  portalRim.position.set(0, 0.1, cartonD / 2 + 0.01);
  bodyGroup.add(portalRim);

  // Dark inside hole mesh
  const holeVoid = new THREE.Mesh(
    new THREE.CircleGeometry(portalR - 0.01, 32),
    new THREE.MeshBasicMaterial({ color: 0x292524 })
  );
  holeVoid.position.set(0, 0.1, cartonD / 2 + 0.005);
  bodyGroup.add(holeVoid);

  // SEED TRAY & GOLDEN GRAIN PILE
  const seedTrayGroup = new THREE.Group();
  seedTrayGroup.position.set(0, -cartonH / 2 + 0.18, 0);

  const seedPile = new THREE.Mesh(
    new THREE.BoxGeometry(cartonW - 0.12, 0.22, cartonD - 0.12),
    seedMat
  );
  seedTrayGroup.add(seedPile);

  // Exposed grains sticking out near the portal rim
  for (let i = 0; i < 24; i++) {
    const gx = (Math.random() - 0.5) * 0.7;
    const gz = cartonD / 2 - 0.08 + (Math.random() - 0.5) * 0.12;
    const grain = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), seedMat);
    grain.scale.set(1.4, 0.9, 0.9);
    grain.position.set(gx, 0.14 + Math.random() * 0.06, gz);
    seedTrayGroup.add(grain);
  }
  bodyGroup.add(seedTrayGroup);

  // WOODEN PERCH DOWEL (extending out the front)
  const perchDowel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.4, 16), woodMat);
  perchDowel.rotation.x = Math.PI / 2;
  perchDowel.position.set(0, -0.38, cartonD / 2 + 0.35);
  perchDowel.castShadow = true;
  bodyGroup.add(perchDowel);

  // ADORABLE PROCEDURAL 3D BIRDIES PERCHED ON THE DOWEL
  const birdGroup = new THREE.Group();
  birdGroup.name = 'decorations';
  birdGroup.userData = { isDecoration: true };
  birdGroup.visible = showDecorations;
  birdGroup.position.set(0.18, -0.22, cartonD / 2 + 0.38);
  birdGroup.rotation.y = -0.35;

  // Bird plump body
  const birdBody = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), birdBodyMat);
  birdBody.scale.set(1.0, 1.15, 1.25);
  birdBody.castShadow = true;
  birdGroup.add(birdBody);

  // Bird head
  const birdHead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), birdBodyMat);
  birdHead.position.set(0, 0.15, 0.14);
  birdHead.castShadow = true;
  birdGroup.add(birdHead);

  // Little golden cone beak
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 8), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.14, 0.3);
  birdGroup.add(beak);

  // Shiny glossy bird eyes
  for (let s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), eyeMat);
    eye.position.set(s * 0.09, 0.18, 0.22);
    birdGroup.add(eye);

    // Eye catchlight
    const catchlight = new THREE.Mesh(new THREE.CircleGeometry(0.008, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    catchlight.position.set(s * 0.095, 0.19, 0.245);
    birdGroup.add(catchlight);
  }

  // Folded side wings
  for (let s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 6), birdWingMat);
    wing.scale.set(0.4, 1.0, 1.2);
    wing.rotation.x = -1.2;
    wing.rotation.z = s * 0.35;
    wing.position.set(s * 0.18, 0.02, -0.04);
    wing.castShadow = true;
    birdGroup.add(wing);
  }

  // Tail feathers
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.22), birdWingMat);
  tail.rotation.x = -0.4;
  tail.position.set(0, -0.06, -0.28);
  birdGroup.add(tail);

  // Claws gripping the dowel
  for (let s of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.06), beakMat);
    foot.position.set(s * 0.06, -0.18, 0);
    birdGroup.add(foot);
  }

  bodyGroup.add(birdGroup);

  group.add(bodyGroup);
  subparts.push({
    id: 'carton_feeder_body',
    mesh: bodyGroup,
    basePos: bodyGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.15, 0),
    label: 'Thân hộp sữa, cửa vòm & khay hạt',
    partRole: 'body',
    parentKey: null,
    connectionInfo: 'Khối hộp chính chứa hạt ngũ cốc và xuyên thanh cành đậu bằng gỗ tre.',
  });

  // 2. GABLE ROOF & HANGING ROPE
  const roofGroup = new THREE.Group();
  roofGroup.name = 'carton_roof';
  roofGroup.position.set(0, 0.9 + cartonH / 2, 0);

  // Folded gable roof
  const roofSlopeGeo = new THREE.ConeGeometry(1.25, 0.75, 4);
  const roofSlope = new THREE.Mesh(roofSlopeGeo, roofMat);
  roofSlope.rotation.y = Math.PI / 4;
  roofSlope.scale.set(1.18, 1.0, 0.95);
  roofSlope.position.set(0, 0.35, 0);
  roofSlope.castShadow = true;
  roofGroup.add(roofSlope);

  // Spout cap on roof peak
  const spoutCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16),
    createHDPECapMaterial(0xffffff)
  );
  spoutCap.position.set(0.3, 0.75, 0.1);
  roofGroup.add(spoutCap);

  // Hanging Jute / Wire Loop
  const ropeLoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.028, 12, 32, Math.PI),
    wireMat
  );
  ropeLoop.position.set(0, 0.74, 0);
  roofGroup.add(ropeLoop);

  // Dangling hanging rope up to the tree
  const longRope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.9, 12),
    wireMat
  );
  longRope.position.set(0, 1.45, 0);
  roofGroup.add(longRope);

  group.add(roofGroup);
  subparts.push({
    id: 'carton_roof',
    mesh: roofGroup,
    basePos: roofGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.8, 0),
    label: 'Mái che dốc & dây treo hộp chim',
    partRole: 'top',
    parentKey: 'carton_feeder_body',
    connectionInfo: 'Gập kín và dán phủ lên đỉnh hộp sữa, móc dây treo chịu tải.',
  });
}

// 7. Photorealistic Horizontal Hydroponic Plastic Planter (Chậu Trồng Rau Thủy Canh Ngang Từ Chai Nhựa + Giá Gỗ Chữ X)
function buildPhotorealPlasticPlanterCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const petMat = createRecycledPETMaterial({ tintColor: 0xf0fdf4, roughness: 0.18, transmission: 0.88 });
  const cutLipMat = createHandCutLipMaterial();
  const capMat = createHDPECapMaterial(0x16a34a); // Green HDPE bottle cap
  const woodMat = createBambooAxleMaterial();
  const lecaMat = createHydroponicLECAMaterial();
  const leafMat = createLushLeafMaterial(0x22c55e);
  const stemMat = createLushLeafMaterial(0x4ade80);

  // BASE CRADLE: Wooden X-Stand cradles front and back so the bottle doesn't roll
  const cradleGroup = new THREE.Group();
  cradleGroup.name = 'wooden_stand';
  cradleGroup.position.set(0, 0, 0);

  for (let z of [-0.6, 0.6]) {
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.08), woodMat);
    leg1.rotation.z = 0.42;
    leg1.position.set(-0.14, 0.32, z);
    leg1.castShadow = true;
    cradleGroup.add(leg1);

    const leg2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.08), woodMat);
    leg2.rotation.z = -0.42;
    leg2.position.set(0.14, 0.32, z);
    leg2.castShadow = true;
    cradleGroup.add(leg2);

    // Crossbar connector pin
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 12), woodMat);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(0, 0.28, z);
    cradleGroup.add(pin);
  }

  // Horizontal stretcher beam connecting the two X stands
  const stretcher = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.35, 12), woodMat);
  stretcher.rotation.x = Math.PI / 2;
  stretcher.position.set(0, 0.18, 0);
  stretcher.castShadow = true;
  cradleGroup.add(stretcher);

  group.add(cradleGroup);
  subparts.push({
    id: 'wooden_stand',
    mesh: cradleGroup,
    basePos: cradleGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, -0.4, 0),
    label: 'Giá đỡ gỗ chữ X chống lăn',
    partRole: 'bottom',
    parentKey: null,
    connectionInfo: 'Khung đế 2 cặp chân chữ X đặt trên bàn nâng đỡ thân chai nằm ngang.',
  });

  // HORIZONTAL BOTTLE MAIN BODY
  const bottleGroup = new THREE.Group();
  bottleGroup.name = 'horizontal_bottle';
  bottleGroup.position.set(0, 0.75, 0);

  // Main horizontal cylinder (Z axis)
  const bottleRadius = 0.62;
  const bottleLength = 2.0;
  const cylinderGeo = new THREE.CylinderGeometry(bottleRadius, bottleRadius, bottleLength, 48, 1, true);
  const bottleMesh = new THREE.Mesh(cylinderGeo, petMat);
  bottleMesh.rotation.x = Math.PI / 2;
  bottleMesh.castShadow = true;
  bottleMesh.receiveShadow = true;
  bottleGroup.add(bottleMesh);

  // Bottle Base (closed end at back Z = -1.0)
  const baseFloor = new THREE.Mesh(new THREE.CircleGeometry(bottleRadius, 32), petMat);
  baseFloor.position.set(0, 0, -bottleLength / 2);
  bottleGroup.add(baseFloor);

  // Bottle Shoulder taper at front Z = +1.0
  const shoulderGeo = new THREE.CylinderGeometry(bottleRadius, 0.28, 0.45, 36, 1, true);
  const shoulderMesh = new THREE.Mesh(shoulderGeo, petMat);
  shoulderMesh.rotation.x = -Math.PI / 2;
  shoulderMesh.position.set(0, 0, bottleLength / 2 + 0.225);
  bottleGroup.add(shoulderMesh);

  // Spout neck and HDPE threaded cap
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 24), petMat);
  neckMesh.rotation.x = Math.PI / 2;
  neckMesh.position.set(0, 0, bottleLength / 2 + 0.55);
  bottleGroup.add(neckMesh);

  const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 24), capMat);
  capMesh.rotation.x = Math.PI / 2;
  capMesh.position.set(0, 0, bottleLength / 2 + 0.7);
  capMesh.castShadow = true;
  bottleGroup.add(capMesh);

  // CUTOUT WINDOW ON TOP: Rectangular opening with smooth cut lip
  const lipLength = 1.35;
  const lipWidth = 0.58;
  const cutFrameMat = cutLipMat;

  const cutLipLong1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, lipLength), cutFrameMat);
  cutLipLong1.position.set(lipWidth / 2, bottleRadius * 0.92, -0.05);
  bottleGroup.add(cutLipLong1);

  const cutLipLong2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, lipLength), cutFrameMat);
  cutLipLong2.position.set(-lipWidth / 2, bottleRadius * 0.92, -0.05);
  bottleGroup.add(cutLipLong2);

  const cutLipShort1 = new THREE.Mesh(new THREE.BoxGeometry(lipWidth, 0.04, 0.04), cutFrameMat);
  cutLipShort1.position.set(0, bottleRadius * 0.92, -0.05 + lipLength / 2);
  bottleGroup.add(cutLipShort1);

  const cutLipShort2 = new THREE.Mesh(new THREE.BoxGeometry(lipWidth, 0.04, 0.04), cutFrameMat);
  cutLipShort2.position.set(0, bottleRadius * 0.92, -0.05 - lipLength / 2);
  bottleGroup.add(cutLipShort2);

  // WATER RESERVOIR INSIDE THE BOTTLE
  const waterGeo = new THREE.BoxGeometry(0.85, 0.22, 1.55);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    transmission: 0.92,
    roughness: 0.05,
    ior: 1.33,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.set(0, -0.32, -0.05);
  bottleGroup.add(waterMesh);

  // HYDROPONIC LECA CLAY PEBBLES LAYER
  const lecaGroup = new THREE.Group();
  lecaGroup.name = 'leca_pebbles';
  for (let i = 0; i < 48; i++) {
    const rx = (Math.random() - 0.5) * 0.65;
    const rz = -0.65 + Math.random() * 1.25;
    const ry = -0.22 + Math.random() * 0.26;
    const size = 0.07 + Math.random() * 0.045;
    const pebble = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), lecaMat);
    pebble.scale.set(1.0 + Math.random() * 0.2, 0.85 + Math.random() * 0.2, 1.0 + Math.random() * 0.2);
    pebble.position.set(rx, ry, rz);
    pebble.castShadow = true;
    lecaGroup.add(pebble);
  }
  bottleGroup.add(lecaGroup);

  group.add(bottleGroup);
  subparts.push({
    id: 'horizontal_bottle',
    mesh: bottleGroup,
    basePos: bottleGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.25, 0),
    label: 'Thân chai ngang, cửa khoét & sỏi LECA',
    partRole: 'body',
    parentKey: 'wooden_stand',
    connectionInfo: 'Đặt lọt lòng trong rãnh chữ V của giá đỡ gỗ chữ X.',
  });

  // SPROUTED HERB SEEDLINGS (MINT / SALAD HERBS GROWING UPWARD)
  const plantsGroup = new THREE.Group();
  plantsGroup.name = 'hydroponic_plants';
  plantsGroup.position.set(0, 0.75, 0);

  const plantPositions = [-0.45, -0.15, 0.15, 0.45];
  plantPositions.forEach((pz, idx) => {
    const seedling = new THREE.Group();
    seedling.position.set((idx % 2 === 0 ? 0.08 : -0.08), 0.05, pz);

    // Stem
    const stemH = 0.65 + (idx % 3) * 0.15;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, stemH, 8), stemMat);
    stem.position.y = stemH / 2;
    stem.rotation.z = (idx % 2 === 0 ? 0.08 : -0.08);
    seedling.add(stem);

    // Leaves pairs along the stem
    for (let l = 0; l < 3; l++) {
      const ly = 0.2 + l * 0.22;
      const leafScale = 0.14 + l * 0.03;
      for (let s of [-1, 1]) {
        const leafGeo = new THREE.ConeGeometry(leafScale * 0.7, leafScale * 1.8, 6);
        const leafMesh = new THREE.Mesh(leafGeo, leafMat);
        leafMesh.rotation.z = s * 0.95;
        leafMesh.rotation.y = l * 0.8;
        leafMesh.position.set(s * 0.12, ly, 0);
        leafMesh.castShadow = true;
        seedling.add(leafMesh);
      }
    }

    // Top leaf crown
    const crown1 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 6), leafMat);
    crown1.position.set(0, stemH + 0.08, 0.04);
    crown1.rotation.x = 0.35;
    crown1.castShadow = true;
    seedling.add(crown1);

    const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 6), leafMat);
    crown2.position.set(0, stemH + 0.08, -0.04);
    crown2.rotation.x = -0.35;
    crown2.castShadow = true;
    seedling.add(crown2);

    plantsGroup.add(seedling);
  });

  // DECORATION: Wooden Plant Label Marker ("Mint / Rau Thơm ♥")
  const decorGroup = new THREE.Group();
  decorGroup.name = 'decorations';
  decorGroup.userData = { isDecoration: true };
  decorGroup.visible = showDecorations;

  const labelStake = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.85, 8), woodMat);
  labelStake.position.set(0.24, 0.45, 0.58);
  decorGroup.add(labelStake);

  const labelSign = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.2, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 })
  );
  labelSign.position.set(0.24, 0.85, 0.58);
  decorGroup.add(labelSign);

  const heartBadge = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.3 })
  );
  heartBadge.position.set(0.24, 0.85, 0.6);
  decorGroup.add(heartBadge);

  plantsGroup.add(decorGroup);

  group.add(plantsGroup);
  subparts.push({
    id: 'hydroponic_plants',
    mesh: plantsGroup,
    basePos: plantsGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.75, 0),
    label: 'Cụm rau mầm thủy canh & thẻ tên',
    partRole: 'top',
    parentKey: 'horizontal_bottle',
    connectionInfo: 'Gieo cố định rễ giữa lớp viên sỏi LECA qua ô cửa khoét trên thân chai.',
  });
}

// 7. Photorealistic Denim Fish Bag (Túi Cá Vải Jean Cũ + Vây Bơi 3D & Má Hồng Thêu)
function buildPhotorealFabricToteCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const denimDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.88 });
  const denimLightMat = new THREE.MeshStandardMaterial({ color: 0x60a5fa, roughness: 0.88 });
  const woodButtonMat = createBambooAxleMaterial();

  const pouchGroup = new THREE.Group();
  pouchGroup.name = 'body';
  pouchGroup.position.set(0, 1.2, 0);

  const mainPouch = new THREE.Mesh(new THREE.CapsuleGeometry(0.65, 1.2, 16, 32), denimDarkMat);
  mainPouch.scale.set(1.0, 1.2, 0.5);
  mainPouch.castShadow = true;
  pouchGroup.add(mainPouch);

  for (let row = 0; row < 4; row++) {
    const y = -0.5 + row * 0.3;
    const isEven = row % 2 === 0;
    const count = isEven ? 3 : 2;
    for (let c = 0; c < count; c++) {
      const x = (c - (count - 1) / 2) * 0.38;
      const scaleMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16, 1, false, 0, Math.PI),
        isEven ? denimLightMat : denimDarkMat
      );
      scaleMesh.rotation.x = Math.PI / 2;
      scaleMesh.position.set(x, y, 0.28);
      pouchGroup.add(scaleMesh);
    }
  }

  // Wooden button eyes
  const eyeL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), woodButtonMat);
  eyeL.rotation.x = Math.PI / 2;
  eyeL.position.set(0.35, 0.7, 0.26);
  pouchGroup.add(eyeL);

  const eyeR = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), woodButtonMat);
  eyeR.rotation.x = Math.PI / 2;
  eyeR.position.set(-0.35, 0.7, 0.26);
  pouchGroup.add(eyeR);

  // --- FABRIC FISH DECORATION: 3D Swimming Side Fins & Tail Fin ---
  const fishDecorGroup = new THREE.Group();
  fishDecorGroup.name = 'decorations';
  fishDecorGroup.userData = { isDecoration: true };
  fishDecorGroup.visible = showDecorations;

  // Pair of side fins
  for (let s of [-1, 1]) {
    const sideFin = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 3), denimLightMat);
    sideFin.scale.set(1.0, 1.0, 0.15);
    sideFin.rotation.z = s * 0.9;
    sideFin.rotation.y = s * 0.2;
    sideFin.position.set(s * 0.78, 0.1, 0.1);
    sideFin.castShadow = true;
    fishDecorGroup.add(sideFin);
  }

  // Cute embroidered blush stitches under eyes
  const stitchMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
  for (let s of [-1, 1]) {
    const blushStitch = new THREE.Mesh(new THREE.CircleGeometry(0.065, 16), stitchMat);
    blushStitch.position.set(s * 0.35, 0.52, 0.28);
    fishDecorGroup.add(blushStitch);
  }

  pouchGroup.add(fishDecorGroup);

  group.add(pouchGroup);
  subparts.push({
    id: 'fabric_tote_body',
    mesh: pouchGroup,
    basePos: pouchGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.3, 0),
    label: 'Thân túi vải Jean khâu vảy cá',
    partRole: 'body',
    parentKey: null,
    connectionInfo: 'Khối túi vải may kín đáy cùng cúc gỗ và vây bơi khâu tay.',
  });
}

// 8. Photorealistic Bottle Cap Turtle Figure (Chú Rùa Nắp Chai Nhựa + Hoa Văn Lục Giác & Nơ Xinh)
function buildPhotorealCapMosaicCraft(
  group: THREE.Group,
  subparts: SubpartRegistration[],
  showDecorations: boolean = true
) {
  const capMatGreen = createHDPECapMaterial(0x15803d);
  const foamMat = new THREE.MeshStandardMaterial({ color: 0x86efac, roughness: 0.85 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });

  const turtleGroup = new THREE.Group();
  turtleGroup.name = 'body';
  turtleGroup.position.set(0, 0.4, 0);

  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.42, 32), capMatGreen);
  shell.castShadow = true;
  turtleGroup.add(shell);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), foamMat);
  head.position.set(0, 0.05, 0.85);
  head.castShadow = true;
  turtleGroup.add(head);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
  eyeL.position.set(0.14, 0.22, 0.98);
  turtleGroup.add(eyeL);

  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
  eyeR.position.set(-0.14, 0.22, 0.98);
  turtleGroup.add(eyeR);

  // --- TURTLE DECORATION: Hexagonal Gold Shell Plates & Sweet Pink Head Bow ---
  const turtleDecorGroup = new THREE.Group();
  turtleDecorGroup.name = 'decorations';
  turtleDecorGroup.userData = { isDecoration: true };
  turtleDecorGroup.visible = showDecorations;

  // Center gold hexagonal emblem
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4, metalness: 0.1 });
  const centerPlate = new THREE.Mesh(new THREE.CircleGeometry(0.24, 6), plateMat);
  centerPlate.rotation.x = -Math.PI / 2;
  centerPlate.position.set(0, 0.22, 0);
  turtleDecorGroup.add(centerPlate);

  // 5 surrounding shell plates
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const ringPlate = new THREE.Mesh(new THREE.CircleGeometry(0.15, 6), plateMat);
    ringPlate.rotation.x = -Math.PI / 2;
    ringPlate.position.set(Math.cos(a) * 0.45, 0.22, Math.sin(a) * 0.45);
    turtleDecorGroup.add(ringPlate);
  }

  // Sweet bow on turtle's head
  const bowMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.5 });
  const bowL = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 4), bowMat);
  bowL.position.set(0.18, 0.35, 0.85);
  bowL.rotation.z = -0.5;
  turtleDecorGroup.add(bowL);

  const bowR = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 4), bowMat);
  bowR.position.set(0.28, 0.35, 0.85);
  bowR.rotation.z = 0.5;
  turtleDecorGroup.add(bowR);

  turtleGroup.add(turtleDecorGroup);

  group.add(turtleGroup);
  subparts.push({
    id: 'cap_mosaic_body',
    mesh: turtleGroup,
    basePos: turtleGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.4, 0),
    label: 'Mô hình rùa nắp chai HDPE & xốp',
    partRole: 'body',
    parentKey: null,
    connectionInfo: 'Khối ghép mai nắp chai và đầu xốp cố định thành mô hình hoàn chỉnh.',
  });
}

