import React from 'react';
import { Check, ChevronRight } from 'lucide-react';
import {
  WORKFLOW_STAGES,
  isWorkflowStageUnlocked,
  resolveActiveWorkflowStage,
  type WorkflowStageId,
  useWorkflow,
} from '../context/WorkflowContext';
import type { ActiveTab } from './Navbar';

interface WorkflowStepperProps {
  activeTab: ActiveTab;
  onSelectStage: (stage: WorkflowStageId) => void;
}

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({
  activeTab,
  onSelectStage,
}) => {
  const wf = useWorkflow();

  const hasIdeas = Boolean(
    wf.analysisTask.data?.recommendations ||
      wf.ideasTask.data?.group100Percent?.length ||
      wf.ideasTask.data?.groupWithAddedMaterials?.length
  );

  const progressInput = {
    activeTab,
    wizardStep: wf.wizardStep,
    viewsCount: wf.views.length,
    hasConfirmedMaterial: Boolean(wf.confirmedMaterial),
    hasIdeas,
    hasActiveCraft: Boolean(wf.activeCraftForGuide),
    isAssemblyFocused: wf.isAssemblyFocused,
  };

  const activeStageId = resolveActiveWorkflowStage(progressInput);
  const activeStageIdx = WORKFLOW_STAGES.findIndex((s) => s.id === activeStageId);

  return (
    <nav
      aria-label="Tiến trình quy trình 7 bước"
      className="bg-white border border-emerald-200/80 rounded-2xl p-2 sm:p-2.5 shadow-2xs"
    >
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {WORKFLOW_STAGES.map((stage, idx) => {
          const unlocked = isWorkflowStageUnlocked(stage.id, progressInput);
          const isCurrent = stage.id === activeStageId;
          const isCompleted = idx < activeStageIdx && unlocked;

          return (
            <React.Fragment key={stage.id}>
              <button
                type="button"
                disabled={!unlocked}
                onClick={() => unlocked && onSelectStage(stage.id)}
                title={stage.description}
                aria-current={isCurrent ? 'step' : undefined}
                className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                  isCurrent
                    ? 'eco-btn-primary text-white shadow-xs'
                    : isCompleted
                    ? 'bg-[#F0FDF4] text-[#0A5C36] border border-emerald-200/70 hover:bg-emerald-100/70'
                    : unlocked
                    ? 'bg-slate-50 text-slate-700 hover:bg-[#F0FDF4] hover:text-[#0A5C36]'
                    : 'text-slate-400'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center tabular-nums shrink-0 ${
                    isCurrent
                      ? 'bg-white text-[#0A5C36]'
                      : isCompleted
                      ? 'bg-[#10B981] text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : stage.order}
                </span>
                <span>{stage.shortLabel}</span>
              </button>
              {idx < WORKFLOW_STAGES.length - 1 && (
                <ChevronRight className="w-3.5 h-3.5 text-emerald-300 shrink-0 hidden md:block" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
};
