// Phase 8: Interactive 3D Components, Hierarchy, Exploded Distances & Assembly Simulation Types

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export type ComponentMetadataSource =
  | 'procedural_craft'
  | 'parametric_phase4'
  | 'glb_hierarchy'
  | 'glb_inferred';

export interface InteractiveComponent3D {
  id: string;
  name: string;
  partRole: string;
  geometrySummary: string;
  geometryTypes: string[];
  materialSummary: string;
  colorHex: string;
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  explodeDir: Vec3Tuple;
  parentId: string | null;
  connectionInfo: string;
  visible: boolean;
  confidence: number; // 0..1
  metadataSource: ComponentMetadataSource;
  triangleCount: number;
  worldCenterOffset: Vec3Tuple;
  assemblyActionHint?: string;
  isNestedInParent?: boolean;
}

export interface ComponentSeparationDistance {
  id: string;
  componentId: string;
  componentName: string;
  parentId: string | null;
  parentName: string;
  distanceUnits: number;
  displacementFromRestUnits: number;
  estimatedCm: number | null;
  anchorStart: Vec3Tuple;
  anchorEnd: Vec3Tuple;
}

export type AssemblyStepCompletionStatus = 'pending' | 'active' | 'completed';

export interface AssemblyStep3D {
  stepId: string;
  stepNumber: number;
  componentId: string;
  componentName: string;
  action: string;
  targetPosition: Vec3Tuple;
  stagedPosition: Vec3Tuple;
  description: string;
  completionStatus: AssemblyStepCompletionStatus;
  dependsOnComponentIds: string[];
  connectionNote: string;
}

export interface AssemblySimulationPlan {
  craftTitle: string;
  steps: AssemblyStep3D[];
  isSuggestedProcedure: boolean;
  basisSummary: string;
  uncertaintyReason?: string;
}

export interface Phase8SyncSelection {
  selectedComponentId: string | null;
  highlightedComponentIds: string[];
}
