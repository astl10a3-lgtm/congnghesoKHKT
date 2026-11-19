import * as THREE from 'three';
import type { CraftProduct, CraftStep, MaterialItem } from '../../server/db';
import type {
  AssemblySimulationPlan,
  AssemblyStep3D,
  ComponentMetadataSource,
  ComponentSeparationDistance,
  InteractiveComponent3D,
  Vec3Tuple,
} from '../types/assembly';
import type { ParametricPartEntry } from './GeometryReconstructionEngine';

export interface SubpartRegistration {
  id?: string;
  mesh: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeDir: THREE.Vector3;
  label?: string;
  partRole?: string;
  parentKey?: string | null;
  connectionInfo?: string;
  assemblyAction?: string;
  triangleCount?: number;
}

export interface ComponentRuntimeEntry {
  id: string;
  object3D: THREE.Object3D;
  basePos: THREE.Vector3;
  baseRot: THREE.Euler;
  baseScale: THREE.Vector3;
  explodeDir: THREE.Vector3;
  stagedPos: THREE.Vector3;
  centerOffset: THREE.Vector3;
  parentId: string | null;
}

export interface ExtractedComponentSystem {
  components: InteractiveComponent3D[];
  runtimeMap: Map<string, ComponentRuntimeEntry>;
}

const EXPLODE_DISTANCE_MULTIPLIER = 1.55;
const ASSEMBLY_STAGE_MULTIPLIER = 1.35;

function round3(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}

function toVec3Tuple(v: { x: number; y: number; z: number }): Vec3Tuple {
  return { x: round3(v.x), y: round3(v.y), z: round3(v.z) };
}

function inferPartRoleFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('cut_guide') || lower.includes('cut_line') || lower.includes('cockpit')) return 'cut_line';
  if (lower.includes('bottom') || lower.includes('base') || lower.includes('stand') || lower.includes('cradle') || lower.includes('reservoir')) {
    return 'bottom';
  }
  if (lower.includes('top') || lower.includes('roof') || lower.includes('plant') || lower.includes('handle') || lower.includes('ear') || lower.includes('sprout')) {
    return 'top';
  }
  if (
    lower.includes('wheel') ||
    lower.includes('axle') ||
    lower.includes('funnel') ||
    lower.includes('cap') ||
    lower.includes('wick') ||
    lower.includes('led') ||
    lower.includes('pen') ||
    lower.includes('leca') ||
    lower.includes('seed') ||
    lower.includes('assembly')
  ) {
    return 'assembly';
  }
  if (lower.includes('decor')) return 'decoration';
  return 'body';
}

function humanizePartName(rawName: string, role: string, index: number): string {
  const key = rawName.toLowerCase();
  const knownLabels: Record<string, string> = {
    bottom_reservoir: 'Đế khoang chứa nước (đáy chai)',
    assembly_funnel: 'Phễu ngược & nắp đục lỗ mao dẫn',
    top_plant: 'Cụm cây xanh & đất hữu cơ',
    cut_guide_line: 'Đường cắt định hình',
    assembly_front_wheels: 'Cụm trục & 2 bánh xe trước',
    assembly_rear_wheels: 'Cụm trục & 2 bánh xe sau',
    wooden_stand: 'Chân giá đỡ gỗ chữ X',
    horizontal_bottle: 'Thân chai nằm ngang & lớp sỏi LECA',
    hydroponic_plants: 'Cụm rau mầm thủy canh',
    carton_feeder_body: 'Thân hộp & khay hạt chim ăn',
    carton_roof: 'Mái che & dây treo hộp chim',
    top_roof: 'Mái ngói chữ A & ống khói',
    assembly_pens: 'Bộ dụng cụ học tập bên trong',
    bottom: 'Đế chịu lực phía dưới',
    body: 'Thân cấu trúc chính',
    top: 'Phần đỉnh / mái / quai',
    assembly: 'Cụm linh kiện lắp ghép',
    base: 'Chân đế vật thể',
    cap: 'Nắp vặn bảo vệ',
    neck: 'Cổ & vai vật thể',
    handle: 'Quai cầm / tay nắm',
    label: 'Vùng tem nhãn tham chiếu',
  };

  if (knownLabels[key]) return knownLabels[key];
  if (rawName && rawName !== 'Mesh' && !/^object_\d+$/i.test(rawName)) {
    return rawName
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const roleLabel: Record<string, string> = {
    bottom: 'Đế chịu lực',
    body: 'Khối thân chính',
    top: 'Phần đỉnh / nắp',
    assembly: 'Cụm chi tiết lắp ghép',
    cut_line: 'Đường cắt dẫn hướng',
    decoration: 'Chi tiết trang trí',
  };
  return `${roleLabel[role] || 'Bộ phận'} #${index + 1}`;
}

function inspectObjectGeometryAndMaterial(obj: THREE.Object3D): {
  geometrySummary: string;
  geometryTypes: string[];
  materialSummary: string;
  colorHex: string;
  triangleCount: number;
  centerOffset: THREE.Vector3;
} {
  const geoTypes = new Set<string>();
  let totalTriangles = 0;
  let roughnessSum = 0;
  let metalnessSum = 0;
  let opacitySum = 0;
  let matCount = 0;
  let primaryHex = '#94A3B8';
  let transparentCount = 0;

  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let hasMeshBox = false;

  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) {
      const gType = mesh.geometry.type || 'BufferGeometry';
      geoTypes.add(gType);
      const posAttr = mesh.geometry.getAttribute('position');
      if (posAttr) {
        totalTriangles += mesh.geometry.index
          ? Math.round(mesh.geometry.index.count / 3)
          : Math.round(posAttr.count / 3);
      }
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const childBox = mesh.geometry.boundingBox.clone();
        childBox.applyMatrix4(mesh.matrixWorld);
        if (!hasMeshBox) {
          box.copy(childBox);
          hasMeshBox = true;
        } else {
          box.union(childBox);
        }
      }
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      matCount++;
      const std = mat as THREE.MeshStandardMaterial;
      if (matCount === 1 && std.color && typeof std.color.getHexString === 'function') {
        primaryHex = `#${std.color.getHexString().toUpperCase()}`;
      }
      roughnessSum += typeof std.roughness === 'number' ? std.roughness : 0.6;
      metalnessSum += typeof std.metalness === 'number' ? std.metalness : 0.05;
      opacitySum += typeof std.opacity === 'number' ? std.opacity : 1;
      if (std.transparent) transparentCount++;
    }
  });

  const size = new THREE.Vector3(0.4, 0.4, 0.4);
  const worldCenter = new THREE.Vector3();
  if (hasMeshBox && !box.isEmpty()) {
    box.getSize(size);
    box.getCenter(worldCenter);
  } else {
    obj.getWorldPosition(worldCenter);
  }

  const objWorldPos = new THREE.Vector3();
  obj.getWorldPosition(objWorldPos);
  const centerOffset = worldCenter.clone().sub(objWorldPos);

  const typeList = geoTypes.size > 0 ? Array.from(geoTypes) : ['Group'];
  const geometrySummary = `${typeList.slice(0, 2).join(' + ')} • ${totalTriangles} Δ • ${round3(size.x)}×${round3(
    size.y
  )}×${round3(size.z)} u`;

  const avgRough = matCount > 0 ? round3(roughnessSum / matCount) : 0.5;
  const avgMetal = matCount > 0 ? round3(metalnessSum / matCount) : 0.05;
  const avgOpacity = matCount > 0 ? round3(opacitySum / matCount) : 1;
  const translucencyTag = transparentCount > 0 || avgOpacity < 0.95 ? ' • Bán trong suốt' : '';
  const materialSummary = `Rough ${avgRough} • Metal ${avgMetal}${translucencyTag}`;

  return {
    geometrySummary,
    geometryTypes: typeList,
    materialSummary,
    colorHex: primaryHex,
    triangleCount: totalTriangles,
    centerOffset,
  };
}

function defaultConnectionInfo(role: string, parentName: string | null): string {
  if (!parentName) {
    return 'Khối nền tảng đặt trực tiếp lên mặt phẳng làm việc (gốc kết cấu).';
  }
  switch (role) {
    case 'bottom':
      return `Đỡ và cố định đáy cho "${parentName}".`;
    case 'assembly':
      return `Khớp nối cơ học / lồng ghép trực tiếp vào "${parentName}".`;
    case 'top':
      return `Gắn hoặc đậy phía trên "${parentName}".`;
    case 'cut_line':
      return `Đường đánh dấu ranh giới cắt gia công trên "${parentName}".`;
    case 'decoration':
      return `Gắn trang trí bề mặt bên ngoài "${parentName}".`;
    default:
      return `Liên kết cấu trúc với "${parentName}".`;
  }
}

export function extractComponentHierarchy(params: {
  rootGroup: THREE.Object3D;
  subparts?: SubpartRegistration[];
  parametricParts?: ParametricPartEntry[];
  sourceMaterial?: MaterialItem | null;
  viewMode: 'craft' | 'source_parametric' | 'source_glb' | 'compare_glb';
}): ExtractedComponentSystem {
  const { rootGroup, subparts = [], parametricParts = [], sourceMaterial, viewMode } = params;
  const components: InteractiveComponent3D[] = [];
  const runtimeMap = new Map<string, ComponentRuntimeEntry>();

  const reconComponents = sourceMaterial?.reconstruction?.geometry?.components || [];
  const reconConfidence = sourceMaterial?.reconstruction?.quality?.geometryConfidence ?? 0.72;

  // 1. Source Parametric Mode (Phase 4 structured components)
  if (viewMode === 'source_parametric' && parametricParts.length > 0) {
    const idLookup = new Map<string, string>();
    parametricParts.forEach((p, idx) => {
      idLookup.set(p.id, p.id || `param_part_${idx}`);
    });

    parametricParts.forEach((p, idx) => {
      const id = p.id || `param_part_${idx}`;
      const matchedSpec = reconComponents.find((c) => c.id === p.id || c.role === p.role);
      const inspected = inspectObjectGeometryAndMaterial(p.mesh);
      const parentId = p.parentId && idLookup.has(p.parentId) ? p.parentId : null;
      const parentPart = parentId ? parametricParts.find((x) => x.id === parentId) : null;
      const role = p.role || inferPartRoleFromName(p.name);

      p.mesh.userData._phase8ComponentId = id;
      p.mesh.traverse((child) => {
        if (!child.userData._phase8ComponentId) {
          child.userData._phase8ComponentId = id;
        }
      });

      const stagedOffset = p.explodeDir.clone();
      if (stagedOffset.lengthSq() < 0.01) stagedOffset.set(0, 0.7, 0);
      stagedOffset.normalize().multiplyScalar(ASSEMBLY_STAGE_MULTIPLIER);
      const stagedPos = p.basePos.clone().add(stagedOffset);

      components.push({
        id,
        name: p.label || matchedSpec?.name || humanizePartName(p.name, role, idx),
        partRole: role,
        geometrySummary: `${p.geometryMethod.toUpperCase()} • ${inspected.geometrySummary}`,
        geometryTypes: inspected.geometryTypes,
        materialSummary: inspected.materialSummary,
        colorHex: matchedSpec?.colorHex || inspected.colorHex,
        position: toVec3Tuple(p.basePos),
        rotation: toVec3Tuple(p.mesh.rotation),
        scale: toVec3Tuple(p.mesh.scale),
        explodeDir: toVec3Tuple(p.explodeDir),
        parentId,
        connectionInfo:
          sourceMaterial?.reconstruction?.object?.partConnections ||
          defaultConnectionInfo(role, parentPart?.label || null),
        visible: p.mesh.visible,
        confidence: matchedSpec?.confidence ?? reconConfidence,
        metadataSource: 'parametric_phase4',
        triangleCount: inspected.triangleCount,
        worldCenterOffset: toVec3Tuple(inspected.centerOffset),
        isNestedInParent: Boolean(parentPart && p.mesh.parent === parentPart.mesh),
      });

      runtimeMap.set(id, {
        id,
        object3D: p.mesh,
        basePos: p.basePos.clone(),
        baseRot: p.mesh.rotation.clone(),
        baseScale: p.mesh.scale.clone(),
        explodeDir: p.explodeDir.clone(),
        stagedPos,
        centerOffset: inspected.centerOffset.clone(),
        parentId,
      });
    });

    return { components, runtimeMap };
  }

  // 2. Procedural Craft PBR or Compare mode with registered subparts
  if (subparts.length > 0) {
    // Collect deduplicated entries keyed by Object3D uuid to avoid double-registration
    const uniqueSubparts: SubpartRegistration[] = [];
    const seenUuid = new Set<string>();
    for (const sp of subparts) {
      if (!sp.mesh || seenUuid.has(sp.mesh.uuid)) continue;
      seenUuid.add(sp.mesh.uuid);
      uniqueSubparts.push(sp);
    }

    // Build preliminary IDs and parent resolution
    const rawEntries = uniqueSubparts.map((sp, idx) => {
      const meta = (sp.mesh.userData?.componentMeta || {}) as {
        id?: string;
        label?: string;
        partRole?: string;
        parentKey?: string | null;
        connectionInfo?: string;
        assemblyAction?: string;
      };
      const rawName = sp.mesh.name || `part_${idx}`;
      const role = sp.partRole || meta.partRole || inferPartRoleFromName(rawName);
      const id = sp.id || meta.id || `comp_${idx}_${rawName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      const label = sp.label || meta.label || humanizePartName(rawName, role, idx);
      return {
        sp,
        meta,
        rawName,
        role,
        id,
        label,
      };
    });

    // Identify primary base or primary body anchor for sensible hierarchy inference when parentKey omitted
    const baseCandidate =
      rawEntries.find((e) => e.role === 'bottom') ||
      rawEntries.find((e) => e.role === 'body') ||
      rawEntries[0];

    const resolveParentEntry = (entry: (typeof rawEntries)[number]) => {
      if (entry.sp.parentKey === null || entry.meta.parentKey === null) return null;
      const requestedKey = entry.sp.parentKey || entry.meta.parentKey;
      if (requestedKey) {
        const match = rawEntries.find(
          (other) =>
            other.id !== entry.id &&
            (other.id === requestedKey ||
              other.rawName === requestedKey ||
              other.role === requestedKey)
        );
        if (match) return match;
      }

      // Check Three.js physical ancestor membership
      let cursor: THREE.Object3D | null = entry.sp.mesh.parent;
      while (cursor && cursor !== rootGroup) {
        const parentEntry = rawEntries.find((other) => other.sp.mesh === cursor && other.id !== entry.id);
        if (parentEntry) return parentEntry;
        cursor = cursor.parent;
      }

      // Structural fallback: top/assembly/cut_line attach to primary body or base
      if (baseCandidate && entry.id !== baseCandidate.id) {
        const bodyCandidate = rawEntries.find((e) => e.role === 'body' && e.id !== entry.id);
        if ((entry.role === 'top' || entry.role === 'cut_line' || entry.role === 'assembly') && bodyCandidate) {
          return bodyCandidate;
        }
        return baseCandidate;
      }
      return null;
    };

    const resolvedParents = new Map<string, string | null>();
    rawEntries.forEach((entry) => {
      const parent = resolveParentEntry(entry);
      resolvedParents.set(entry.id, parent ? parent.id : null);
    });

    // Prevent cycles strictly
    const hasCycle = (id: string): boolean => {
      const visited = new Set<string>();
      let curr: string | null | undefined = id;
      while (curr) {
        if (visited.has(curr)) return true;
        visited.add(curr);
        curr = resolvedParents.get(curr);
      }
      return false;
    };

    rawEntries.forEach((entry) => {
      if (hasCycle(entry.id)) {
        resolvedParents.set(entry.id, null);
      }
    });

    rawEntries.forEach((entry) => {
      const parentId = resolvedParents.get(entry.id) ?? null;
      const parentEntry = parentId ? rawEntries.find((e) => e.id === parentId) : null;
      const inspected = inspectObjectGeometryAndMaterial(entry.sp.mesh);

      // Assign component ownership cleanly for raycast clicks (inner children preserve specific subcomponent IDs if registered separately)
      entry.sp.mesh.userData._phase8ComponentId = entry.id;
      entry.sp.mesh.traverse((child) => {
        if (child === entry.sp.mesh) return;
        const alreadyOwned = rawEntries.some((other) => other !== entry && other.sp.mesh === child);
        if (!alreadyOwned && !child.userData._phase8ComponentId) {
          child.userData._phase8ComponentId = entry.id;
        }
      });

      const stagedOffset = entry.sp.explodeDir.clone();
      if (stagedOffset.lengthSq() < 0.01) {
        stagedOffset.set(0, entry.role === 'bottom' ? -0.35 : 0.75, 0);
      }
      stagedOffset.normalize().multiplyScalar(ASSEMBLY_STAGE_MULTIPLIER);
      const stagedPos = entry.sp.basePos.clone().add(stagedOffset);

      components.push({
        id: entry.id,
        name: entry.label,
        partRole: entry.role,
        geometrySummary: inspected.geometrySummary,
        geometryTypes: inspected.geometryTypes,
        materialSummary: inspected.materialSummary,
        colorHex: inspected.colorHex,
        position: toVec3Tuple(entry.sp.basePos),
        rotation: toVec3Tuple(entry.sp.mesh.rotation),
        scale: toVec3Tuple(entry.sp.mesh.scale),
        explodeDir: toVec3Tuple(entry.sp.explodeDir),
        parentId,
        connectionInfo:
          entry.sp.connectionInfo ||
          entry.meta.connectionInfo ||
          defaultConnectionInfo(entry.role, parentEntry?.label || null),
        visible: entry.sp.mesh.visible,
        confidence: 0.92,
        metadataSource: 'procedural_craft',
        triangleCount: inspected.triangleCount,
        worldCenterOffset: toVec3Tuple(inspected.centerOffset),
        assemblyActionHint: entry.sp.assemblyAction || entry.meta.assemblyAction,
        isNestedInParent: Boolean(parentEntry && entry.sp.mesh.parent === parentEntry.sp.mesh),
      });

      runtimeMap.set(entry.id, {
        id: entry.id,
        object3D: entry.sp.mesh,
        basePos: entry.sp.basePos.clone(),
        baseRot: entry.sp.mesh.rotation.clone(),
        baseScale: entry.sp.mesh.scale.clone(),
        explodeDir: entry.sp.explodeDir.clone(),
        stagedPos,
        centerOffset: inspected.centerOffset.clone(),
        parentId,
      });
    });

    return { components, runtimeMap };
  }

  // 3. Fallback: Direct Mesh / GLB Node Extraction (e.g., Image-to-3D .GLB without explicit metadata)
  const discoveredMeshes: THREE.Mesh[] = [];
  rootGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.name !== 'usableZoneHighlight' && mesh.name !== 'cut_guide_line') {
      discoveredMeshes.push(mesh);
    }
  });

  // Compute overall centroid to synthesize radial explode vectors for multi-mesh GLBs
  const overallBox = new THREE.Box3();
  if (discoveredMeshes.length > 0) {
    overallBox.setFromObject(rootGroup);
  }
  const rootCenter = new THREE.Vector3();
  if (!overallBox.isEmpty()) overallBox.getCenter(rootCenter);

  const hasMeaningfulNamedHierarchy =
    discoveredMeshes.length > 1 &&
    discoveredMeshes.some(
      (m) =>
        Boolean(m.name) &&
        !/^(mesh|node|primitive|object)[_-]?\d*$/i.test(m.name.trim())
    );

  discoveredMeshes.forEach((mesh, idx) => {
    const rawName = mesh.name || `glb_part_${idx}`;
    const role = idx === 0 && discoveredMeshes.length === 1 ? 'body' : inferPartRoleFromName(rawName);
    const id = `glb_${idx}_${rawName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const inspected = inspectObjectGeometryAndMaterial(mesh);

    const meshBox = new THREE.Box3().setFromObject(mesh);
    const meshCenter = new THREE.Vector3();
    if (!meshBox.isEmpty()) meshBox.getCenter(meshCenter);

    const explodeVec = meshCenter.clone().sub(rootCenter);
    if (explodeVec.lengthSq() < 0.01) {
      explodeVec.set(0, idx === 0 ? 0.3 : 0.65, 0);
    } else {
      explodeVec.normalize().multiplyScalar(0.65);
    }

    mesh.userData._phase8ComponentId = id;

    const parentId = idx > 0 && discoveredMeshes.length > 1 ? `glb_0_${(discoveredMeshes[0].name || 'glb_part_0').replace(/[^a-zA-Z0-9_]/g, '_')}` : null;
    const basePos = mesh.position.clone();
    const stagedPos = basePos.clone().add(explodeVec.clone().normalize().multiplyScalar(ASSEMBLY_STAGE_MULTIPLIER));

    components.push({
      id,
      name: humanizePartName(rawName, role, idx),
      partRole: role,
      geometrySummary: inspected.geometrySummary,
      geometryTypes: inspected.geometryTypes,
      materialSummary: inspected.materialSummary,
      colorHex: inspected.colorHex,
      position: toVec3Tuple(basePos),
      rotation: toVec3Tuple(mesh.rotation),
      scale: toVec3Tuple(mesh.scale),
      explodeDir: toVec3Tuple(explodeVec),
      parentId,
      connectionInfo:
        discoveredMeshes.length === 1
          ? 'Mesh hợp nhất (không tách khớp lắp ráp trong tệp .GLB).'
          : 'Mối liên kết suy luận theo vị trí không gian trong tệp .GLB (chưa có dữ liệu khớp nối CAD).',
      visible: mesh.visible,
      confidence: hasMeaningfulNamedHierarchy ? 0.65 : 0.42,
      metadataSource: hasMeaningfulNamedHierarchy ? 'glb_hierarchy' : 'glb_inferred',
      triangleCount: inspected.triangleCount,
      worldCenterOffset: toVec3Tuple(inspected.centerOffset),
    });

    runtimeMap.set(id, {
      id,
      object3D: mesh,
      basePos,
      baseRot: mesh.rotation.clone(),
      baseScale: mesh.scale.clone(),
      explodeDir: explodeVec,
      stagedPos,
      centerOffset: inspected.centerOffset.clone(),
      parentId,
    });
  });

  return { components, runtimeMap };
}

function getStructuralRoleWeight(role: string): number {
  switch (role) {
    case 'bottom':
    case 'base':
      return 0;
    case 'body':
    case 'label':
      return 1;
    case 'assembly':
    case 'neck':
    case 'handle':
    case 'cap':
      return 2;
    case 'top':
      return 3;
    case 'cut_line':
    case 'detail':
    case 'decoration':
      return 4;
    default:
      return 2;
  }
}

function buildStepActionAndDescription(
  comp: InteractiveComponent3D,
  parentComp: InteractiveComponent3D | null
): { action: string; description: string } {
  if (!parentComp) {
    if (comp.partRole === 'bottom' || comp.partRole === 'base') {
      return {
        action: 'Đặt & cố định phần đế nền tảng',
        description: `Đặt "${comp.name}" vững chắc trên mặt phẳng làm việc làm nền tảng chịu lực ban đầu.`,
      };
    }
    return {
      action: 'Định vị khối thân chính',
      description: `Cố định "${comp.name}" tại vị trí trung tâm để làm khung tham chiếu lắp ghép các chi tiết khác.`,
    };
  }

  switch (comp.partRole) {
    case 'assembly':
      return {
        action: `Lắp cụm chi tiết vào "${parentComp.name}"`,
        description: `Đưa "${comp.name}" khớp đúng vị trí trên "${parentComp.name}". ${comp.connectionInfo}`,
      };
    case 'top':
      return {
        action: `Gắn phần đỉnh lên "${parentComp.name}"`,
        description: `Lắp đặt "${comp.name}" lên phía trên "${parentComp.name}" đảm bảo cân bằng trục trọng tâm.`,
      };
    case 'cut_line':
      return {
        action: 'Kiểm tra đường cắt / mép hoàn thiện',
        description: `Đối chiếu "${comp.name}" trên "${parentComp.name}" để đảm bảo đường cắt khớp với kích thước.`,
      };
    case 'decoration':
      return {
        action: 'Hoàn thiện chi tiết trang trí',
        description: `Gắn "${comp.name}" lên mặt ngoài "${parentComp.name}" sau khi phần kết cấu chính đã vững.`,
      };
    default:
      return {
        action: `Ghép nối vào "${parentComp.name}"`,
        description: `Lắp "${comp.name}" liên kết với "${parentComp.name}". ${comp.connectionInfo}`,
      };
  }
}

export function buildAssemblySimulationPlan(params: {
  components: InteractiveComponent3D[];
  craft: CraftProduct;
  sourceMaterial?: MaterialItem | null;
}): AssemblySimulationPlan {
  const { components, craft, sourceMaterial } = params;

  if (components.length === 0) {
    return {
      craftTitle: craft.title,
      steps: [],
      isSuggestedProcedure: true,
      basisSummary: 'Chưa phát hiện bộ phận 3D độc lập để mô phỏng lắp ráp.',
      uncertaintyReason: 'Mô hình chưa có dữ liệu danh sách bộ phận.',
    };
  }

  const byId = new Map<string, InteractiveComponent3D>();
  components.forEach((c) => byId.set(c.id, c));

  // Topological sort (Kahn's algorithm) ordered by structural role weight at each unlocked level
  const inDegree = new Map<string, number>();
  const childrenMap = new Map<string, string[]>();

  components.forEach((c) => {
    inDegree.set(c.id, 0);
    childrenMap.set(c.id, []);
  });

  components.forEach((c) => {
    if (c.parentId && byId.has(c.parentId) && c.parentId !== c.id) {
      inDegree.set(c.id, (inDegree.get(c.id) || 0) + 1);
      childrenMap.get(c.parentId)!.push(c.id);
    }
  });

  const readyQueue: InteractiveComponent3D[] = components.filter((c) => (inDegree.get(c.id) || 0) === 0);
  const sortReady = () => {
    readyQueue.sort((a, b) => {
      const wDiff = getStructuralRoleWeight(a.partRole) - getStructuralRoleWeight(b.partRole);
      if (wDiff !== 0) return wDiff;
      return a.position.y - b.position.y;
    });
  };
  sortReady();

  const ordered: InteractiveComponent3D[] = [];
  const visited = new Set<string>();

  while (readyQueue.length > 0) {
    const current = readyQueue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    ordered.push(current);

    for (const childId of childrenMap.get(current.id) || []) {
      const nextDeg = (inDegree.get(childId) || 1) - 1;
      inDegree.set(childId, nextDeg);
      if (nextDeg <= 0) {
        const child = byId.get(childId);
        if (child && !visited.has(child.id)) {
          readyQueue.push(child);
        }
      }
    }
    sortReady();
  }

  // Fallback for any disconnected/residual nodes (should never happen since cycles are broken)
  for (const c of components) {
    if (!visited.has(c.id)) {
      ordered.push(c);
    }
  }

  // Check honestly if the assembly sequence lacks sufficient explicit joint/relationship data
  const hasGlbInferred = components.some((c) => c.metadataSource === 'glb_inferred');
  const isSingleMeshOnly = components.length <= 1;
  const lowReconConfidence =
    sourceMaterial?.reconstruction &&
    (sourceMaterial.reconstruction.quality.geometryConfidence < 0.65 ||
      (sourceMaterial.reconstruction.quality.uncertainties?.length || 0) > 0);
  const missingConnectionData = components.some((c) => !c.connectionInfo || c.connectionInfo.trim().length < 5);

  const isSuggestedProcedure = Boolean(
    hasGlbInferred || isSingleMeshOnly || lowReconConfidence || missingConnectionData
  );

  const uncertaintyReasons: string[] = [];
  if (isSingleMeshOnly) {
    uncertaintyReasons.push('Mô hình hiện chỉ có 1 khối liền duy nhất nên chưa thể tách lắp ráp nhiều khớp.');
  }
  if (hasGlbInferred) {
    uncertaintyReasons.push('Tệp .GLB đầu vào không chứa metadata khớp nối CAD, thứ tự được suy luận từ vị trí hình học.');
  }
  if (lowReconConfidence) {
    uncertaintyReasons.push('Dữ liệu phân tích vật thể ban đầu còn một số điểm chưa chắc chắn về cấu trúc chi tiết.');
  }

  const steps: AssemblyStep3D[] = ordered.map((comp, idx) => {
    const parentComp = comp.parentId ? byId.get(comp.parentId) || null : null;
    const { action, description } = buildStepActionAndDescription(comp, parentComp);
    const dir = new THREE.Vector3(comp.explodeDir.x, comp.explodeDir.y, comp.explodeDir.z);
    if (dir.lengthSq() < 0.01) dir.set(0, comp.partRole === 'bottom' ? -0.35 : 0.75, 0);
    dir.normalize().multiplyScalar(ASSEMBLY_STAGE_MULTIPLIER);

    return {
      stepId: `asm_step_${idx + 1}_${comp.id}`,
      stepNumber: idx + 1,
      componentId: comp.id,
      componentName: comp.name,
      action,
      targetPosition: { ...comp.position },
      stagedPosition: {
        x: round3(comp.position.x + dir.x),
        y: round3(comp.position.y + dir.y),
        z: round3(comp.position.z + dir.z),
      },
      description,
      completionStatus: idx === 0 ? 'active' : 'pending',
      dependsOnComponentIds: parentComp ? [parentComp.id] : [],
      connectionNote: comp.connectionInfo,
    };
  });

  return {
    craftTitle: craft.title,
    steps,
    isSuggestedProcedure,
    basisSummary: isSuggestedProcedure
      ? 'Quy trình đề xuất tham khảo theo cấu trúc phụ thuộc suy luận (cần đối chiếu thực tế).'
      : 'Thứ tự lắp ráp được xác định chặt chẽ theo cây phân cấp cha-con & điểm tựa kết cấu 3D.',
    uncertaintyReason: uncertaintyReasons.length > 0 ? uncertaintyReasons.join(' ') : undefined,
  };
}

export function computeSeparationDistances(params: {
  components: InteractiveComponent3D[];
  explodedFactor: number;
  currentPositions?: Map<string, Vec3Tuple>;
  scaleUnitsPerCm?: number | null;
}): ComponentSeparationDistance[] {
  const { components, explodedFactor, currentPositions, scaleUnitsPerCm = 0.1 } = params;
  const byId = new Map<string, InteractiveComponent3D>();
  components.forEach((c) => byId.set(c.id, c));

  const getEffectivePos = (comp: InteractiveComponent3D): Vec3Tuple => {
    const explicit = currentPositions?.get(comp.id);
    if (explicit) return explicit;
    return {
      x: comp.position.x + comp.explodeDir.x * explodedFactor * EXPLODE_DISTANCE_MULTIPLIER,
      y: comp.position.y + comp.explodeDir.y * explodedFactor * EXPLODE_DISTANCE_MULTIPLIER,
      z: comp.position.z + comp.explodeDir.z * explodedFactor * EXPLODE_DISTANCE_MULTIPLIER,
    };
  };

  const results: ComponentSeparationDistance[] = [];

  components.forEach((comp) => {
    const curr = getEffectivePos(comp);
    const parent = comp.parentId ? byId.get(comp.parentId) || null : null;
    const parentCurr = parent ? getEffectivePos(parent) : { x: 0, y: 0, z: 0 };
    const parentBase = parent ? parent.position : { x: 0, y: 0, z: 0 };

    const currCenter = {
      x: curr.x + comp.worldCenterOffset.x,
      y: curr.y + comp.worldCenterOffset.y,
      z: curr.z + comp.worldCenterOffset.z,
    };
    const anchorCenter = parent
      ? {
          x: parentCurr.x + parent.worldCenterOffset.x,
          y: parentCurr.y + parent.worldCenterOffset.y,
          z: parentCurr.z + parent.worldCenterOffset.z,
        }
      : { x: 0, y: 0, z: 0 };

    let relativeDeltaX = curr.x - comp.position.x;
    let relativeDeltaY = curr.y - comp.position.y;
    let relativeDeltaZ = curr.z - comp.position.z;

    if (parent && !comp.isNestedInParent) {
      relativeDeltaX -= parentCurr.x - parentBase.x;
      relativeDeltaY -= parentCurr.y - parentBase.y;
      relativeDeltaZ -= parentCurr.z - parentBase.z;
    }

    const displacementFromRest = Math.hypot(
      curr.x - comp.position.x,
      curr.y - comp.position.y,
      curr.z - comp.position.z
    );

    const netSeparation = round3(Math.hypot(relativeDeltaX, relativeDeltaY, relativeDeltaZ));
    const cmScale = scaleUnitsPerCm && scaleUnitsPerCm > 0 ? 1 / scaleUnitsPerCm : null;

    results.push({
      id: `dist_${comp.id}`,
      componentId: comp.id,
      componentName: comp.name,
      parentId: comp.parentId,
      parentName: parent ? parent.name : 'Mặt phẳng gốc (0,0,0)',
      distanceUnits: netSeparation,
      displacementFromRestUnits: round3(displacementFromRest),
      estimatedCm: cmScale ? round3(netSeparation * cmScale) : null,
      anchorStart: toVec3Tuple(anchorCenter),
      anchorEnd: toVec3Tuple(currCenter),
    });
  });

  return results;
}

export function resolveMatchingComponentIdsForGuideStep(
  step: CraftStep | null | undefined,
  components: InteractiveComponent3D[]
): string[] {
  if (!step || components.length === 0) return [];
  const target = (step.highlightPart || '').toLowerCase().trim();

  if (target === 'all') {
    return components.map((c) => c.id);
  }

  // Direct role or id substring match
  const matched = new Set<string>();
  if (target) {
    components.forEach((c) => {
      const hay = `${c.id} ${c.partRole} ${c.name}`.toLowerCase();
      if (c.partRole.toLowerCase() === target || hay.includes(target)) {
        matched.add(c.id);
      }
    });
  }

  // Vietnamese semantic fallback from step title & description
  if (matched.size === 0) {
    const stepText = `${step.title} ${step.description}`.toLowerCase();
    const keywordRules: Array<{ keywords: string[]; roles: string[] }> = [
      { keywords: ['đáy', 'chân', 'giá đỡ', 'khoang nước', 'đế'], roles: ['bottom', 'base'] },
      { keywords: ['phễu', 'nắp', 'bấc', 'bánh xe', 'trục', 'ngăn', 'đèn led', 'sỏi', 'hạt'], roles: ['assembly', 'cap'] },
      { keywords: ['mái', 'tai mèo', 'cây', 'rau', 'quai', 'đỉnh'], roles: ['top'] },
      { keywords: ['cắt', 'đánh dấu', 'khoét'], roles: ['cut_line', 'body'] },
      { keywords: ['thân', 'chai', 'hộp', 'khung', 'túi', 'vỏ'], roles: ['body'] },
    ];

    for (const rule of keywordRules) {
      if (rule.keywords.some((kw) => stepText.includes(kw))) {
        components.forEach((c) => {
          if (rule.roles.includes(c.partRole)) matched.add(c.id);
        });
        if (matched.size > 0) break;
      }
    }
  }

  // Final safety fallback to primary body or first component so highlight sync never fails silently
  if (matched.size === 0) {
    const primary = components.find((c) => c.partRole === 'body') || components[0];
    if (primary) matched.add(primary.id);
  }

  return Array.from(matched);
}
