import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  Clock,
  Hammer,
  CheckCircle,
  PlusCircle,
  Box,
  Image as ImageIcon,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  Wrench,
  HelpCircle,
} from 'lucide-react';
import type { CraftProduct, MaterialItem } from '../../server/db';
import {
  CONCEPT_3D_PREVIEW_DISCLAIMER,
  type MaterialReusabilityAnalysis,
  type SafetyComplianceReport,
} from '../types/recycling';
import { CraftViewer3D } from '../three/CraftViewer3D';

interface CraftRecommendationListProps {
  group100Percent: CraftProduct[];
  groupWithAddedMaterials: CraftProduct[];
  reusabilityAnalysis?: MaterialReusabilityAnalysis | null;
  safetyCompliance?: SafetyComplianceReport | null;
  sourceMaterial?: MaterialItem | null;
  onSelectCraft: (craft: CraftProduct) => void;
  onUpdateCraft?: (updated: CraftProduct) => void;
}

export const CraftRecommendationList: React.FC<CraftRecommendationListProps> = ({
  group100Percent,
  groupWithAddedMaterials,
  reusabilityAnalysis = null,
  safetyCompliance = null,
  sourceMaterial = null,
  onSelectCraft,
  onUpdateCraft,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | '100_percent' | 'with_added'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recycled_ratio' | 'easiest' | 'fastest' | 'lowest_cost'>('recycled_ratio');

  const categories = [
    { id: 'all', label: 'Tất cả danh mục' },
    { id: 'garden', label: 'Làm vườn & Cây xanh' },
    { id: 'study', label: 'Đồ dùng học tập' },
    { id: 'decor', label: 'Trang trí phòng' },
    { id: 'stem_toy', label: 'Đồ chơi STEM' },
    { id: 'home', label: 'Gia đình & Tiện ích' },
  ];

  const filtered100 = useMemo(() => {
    let list = [...group100Percent];
    if (selectedCategory !== 'all') {
      list = list.filter((c) => c.category === selectedCategory);
    }
    return list;
  }, [group100Percent, selectedCategory]);

  const filteredAdded = useMemo(() => {
    let list = [...groupWithAddedMaterials];
    if (selectedCategory !== 'all') {
      list = list.filter((c) => c.category === selectedCategory);
    }
    return list;
  }, [groupWithAddedMaterials, selectedCategory]);

  const sortProducts = (products: CraftProduct[]) => {
    return [...products].sort((a, b) => {
      if (sortBy === 'recycled_ratio') {
        return b.recycledMaterialRatio - a.recycledMaterialRatio;
      }
      if (sortBy === 'fastest') {
        const timeA = parseInt(a.estimatedTime) || 30;
        const timeB = parseInt(b.estimatedTime) || 30;
        return timeA - timeB;
      }
      if (sortBy === 'easiest') {
        const diffRank: Record<string, number> = { Dễ: 1, 'Trung bình': 2, Khó: 3 };
        return (diffRank[a.difficulty] || 2) - (diffRank[b.difficulty] || 2);
      }
      if (sortBy === 'lowest_cost') {
        const costA = a.materialsNeededExtra.reduce((acc, m) => acc + m.estimatedCostVnd, 0);
        const costB = b.materialsNeededExtra.reduce((acc, m) => acc + m.estimatedCostVnd, 0);
        return costA - costB;
      }
      return 0;
    });
  };

  const sorted100 = useMemo(() => sortProducts(filtered100), [filtered100, sortBy]);
  const sortedAdded = useMemo(() => sortProducts(filteredAdded), [filteredAdded, sortBy]);

  const totalIdeasCount = group100Percent.length + groupWithAddedMaterials.length;
  const isBlockedOrInsufficient =
    reusabilityAnalysis &&
    (reusabilityAnalysis.suitabilityForManualCrafting === 'unsafe' ||
      reusabilityAnalysis.suitabilityForManualCrafting === 'insufficient_data');

  return (
    <div className="space-y-8 py-4">
      {/* Phase 7B: Material Reusability Analysis Panel */}
      {reusabilityAnalysis && (
        <div
          className={`p-5 sm:p-6 rounded-3xl border shadow-xs space-y-4 ${
            reusabilityAnalysis.suitabilityForManualCrafting === 'unsafe'
              ? 'bg-rose-50/80 border-rose-200'
              : reusabilityAnalysis.suitabilityForManualCrafting === 'insufficient_data'
              ? 'bg-slate-100 border-slate-300'
              : reusabilityAnalysis.suitabilityForManualCrafting === 'conditional'
              ? 'bg-amber-50/70 border-amber-200'
              : 'bg-emerald-50/70 border-emerald-200'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/5">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                  reusabilityAnalysis.suitabilityForManualCrafting === 'unsafe'
                    ? 'bg-rose-600 text-white'
                    : reusabilityAnalysis.suitabilityForManualCrafting === 'insufficient_data'
                    ? 'bg-slate-700 text-white'
                    : reusabilityAnalysis.suitabilityForManualCrafting === 'conditional'
                    ? 'bg-amber-500 text-white'
                    : 'bg-emerald-600 text-white'
                }`}
              >
                {reusabilityAnalysis.suitabilityForManualCrafting === 'unsafe' ? (
                  <ShieldAlert className="w-5 h-5" />
                ) : reusabilityAnalysis.suitabilityForManualCrafting === 'insufficient_data' ? (
                  <HelpCircle className="w-5 h-5" />
                ) : reusabilityAnalysis.suitabilityForManualCrafting === 'conditional' ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <ShieldCheck className="w-5 h-5" />
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  ĐÁNH GIÁ KHẢ NĂNG TÁI SỬ DỤNG VẬT LIỆU (PHASE 7)
                </p>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  {reusabilityAnalysis.suitabilityLabel}
                </h3>
                <p className="text-xs text-slate-700 mt-0.5">
                  {reusabilityAnalysis.suitabilitySummary}
                </p>
              </div>
            </div>

            <div className="text-left sm:text-right shrink-0">
              <span className="text-[11px] font-semibold text-slate-500 block">Vật liệu phân tích</span>
              <span className="text-xs font-extrabold text-slate-900">
                {reusabilityAnalysis.materialType}
              </span>
              <span className="block text-[11px] text-slate-600">
                Độ tin cậy: {Math.round(reusabilityAnalysis.materialConfidence * 100)}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-white/80 rounded-2xl p-3.5 border border-black/5 space-y-1.5">
              <span className="font-bold text-slate-800 block">Tình trạng & Bộ phận dùng được</span>
              <p className="text-slate-600 text-[11px]">{reusabilityAnalysis.objectCondition}</p>
              {reusabilityAnalysis.reusableComponents.length > 0 ? (
                <ul className="space-y-1 pt-1">
                  {reusabilityAnalysis.reusableComponents.map((comp, i) => (
                    <li key={i} className="text-[11px] text-emerald-800 flex items-start gap-1.5">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{comp}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-slate-500 italic">
                  Không xác nhận bộ phận phù hợp để cắt ghép thủ công.
                </p>
              )}
            </div>

            <div className="bg-white/80 rounded-2xl p-3.5 border border-black/5 space-y-1.5">
              <span className="font-bold text-slate-800 block">Hạn chế vật liệu cần lưu ý</span>
              <ul className="space-y-1">
                {reusabilityAnalysis.materialLimitations.map((lim, i) => (
                  <li key={i} className="text-[11px] text-slate-700 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>{lim}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white/80 rounded-2xl p-3.5 border border-black/5 space-y-1.5">
              <span className="font-bold text-slate-800 block">
                {reusabilityAnalysis.missingInformation.length > 0
                  ? 'Thông tin còn thiếu / Cần xác nhận'
                  : 'Khuyến nghị an toàn thao tác'}
              </span>
              {reusabilityAnalysis.missingInformation.length > 0 && (
                <ul className="space-y-1 pb-1">
                  {reusabilityAnalysis.missingInformation.map((m, i) => (
                    <li key={i} className="text-[11px] text-rose-700 font-medium">
                      • {m}
                    </li>
                  ))}
                </ul>
              )}
              <ul className="space-y-1">
                {reusabilityAnalysis.recommendedSafeActions.map((act, i) => (
                  <li key={i} className="text-[11px] text-slate-700">
                    • {act}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {safetyCompliance && safetyCompliance.blockedHazards.length > 0 && (
            <div className="p-3 rounded-2xl bg-amber-100/80 border border-amber-300 text-[11px] text-amber-950">
              <span className="font-bold block">Bộ lọc an toàn đã tự động loại bỏ phương pháp rủi ro:</span>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                {safetyCompliance.blockedHazards.map((b, idx) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* When material is unsafe or insufficient data, do not show synthetic ideas */}
      {isBlockedOrInsufficient ? (
        <div className="p-6 rounded-3xl bg-white border border-slate-200 text-center space-y-2 shadow-xs">
          <p className="text-sm font-bold text-slate-900">
            Chưa đề xuất sản phẩm tái chế cho vật thể này
          </p>
          <p className="text-xs text-slate-600 max-w-xl mx-auto">
            {reusabilityAnalysis?.suitabilityForManualCrafting === 'unsafe'
              ? 'Vật liệu thuộc nhóm không an toàn để cắt ghép thủ công tại nhà. Vui lòng phân loại vào đúng thùng thu hồi chuyên biệt.'
              : 'Dữ liệu hiện tại chưa đủ để đảm bảo gợi ý chính xác và an toàn. Hãy chụp bổ sung góc ảnh rõ hơn hoặc nhập đầy đủ loại vật liệu và kích thước.'}
          </p>
        </div>
      ) : (
        <>
          {/* Header & Disclaimer */}
          <div className="space-y-4">
            <div className="text-center max-w-3xl mx-auto space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>ĐỀ XUẤT TÁI CHẾ AN TOÀN & MÔ PHỎNG 3D DỰ KIẾN ({totalIdeasCount} Ý TƯỞNG)</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Ý tưởng tái chế phù hợp với vật liệu đầu vào
              </h2>
              <p className="text-xs text-slate-600 bg-slate-100 px-3.5 py-2 rounded-xl border border-slate-200 inline-flex items-center gap-2 text-left">
                <Info className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>{CONCEPT_3D_PREVIEW_DISCLAIMER}</span>
              </p>
            </div>

            {/* Filter Controls Bar */}
            <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 w-full md:w-auto">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`flex-1 md:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                    filterMode === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tất cả ({totalIdeasCount})
                </button>
                <button
                  onClick={() => setFilterMode('100_percent')}
                  className={`flex-1 md:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${
                    filterMode === '100_percent'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-emerald-700 hover:text-emerald-900'
                  }`}
                >
                  <span>100% Vật liệu sẵn có</span>
                  <span className="text-[10px] opacity-80">({group100Percent.length})</span>
                </button>
                <button
                  onClick={() => setFilterMode('with_added')}
                  className={`flex-1 md:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${
                    filterMode === 'with_added'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-indigo-700 hover:text-indigo-900'
                  }`}
                >
                  <span>Kết hợp phụ liệu</span>
                  <span className="text-[10px] opacity-80">({groupWithAddedMaterials.length})</span>
                </button>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="p-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>

                <select
                  value={sortBy}
                  onChange={(e: any) => setSortBy(e.target.value)}
                  className="p-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white"
                >
                  <option value="recycled_ratio">Tận dụng nhiều rác nhất (%)</option>
                  <option value="lowest_cost">Ít tốn chi phí mua thêm nhất</option>
                  <option value="easiest">Dễ thực hiện nhất</option>
                  <option value="fastest">Thời gian ngắn nhất</option>
                </select>
              </div>
            </div>
          </div>

          {/* SECTION 1: 100% RECYCLED MATERIALS */}
          {(filterMode === 'all' || filterMode === '100_percent') && (
            <section className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-emerald-200">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    1
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-lg">
                      Nhóm 1: Tận dụng 100% vật liệu đầu vào
                    </h3>
                    <p className="text-xs text-slate-500">
                      Không cần mua thêm vật tư phụ, thực hành nhanh và tiết kiệm.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-bold text-emerald-700 hidden sm:inline">
                  {sorted100.length} sản phẩm
                </span>
              </div>

              {sorted100.length === 0 ? (
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                  Không có ý tưởng phù hợp bộ lọc hiện tại trong nhóm này.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {sorted100.map((craft) => (
                    <CraftCard
                      key={craft.id}
                      craft={craft}
                      sourceMaterial={sourceMaterial}
                      onSelect={onSelectCraft}
                      onUpdateCraft={onUpdateCraft}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* SECTION 2: COMBINED WITH ADDED MATERIALS */}
          {(filterMode === 'all' || filterMode === 'with_added') && (
            <section className="space-y-4 pt-4">
              <div className="flex items-center justify-between pb-2 border-b border-indigo-200">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    2
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-lg">
                      Nhóm 2: Mở rộng sáng tạo với phụ liệu an toàn
                    </h3>
                    <p className="text-xs text-slate-500">
                      Kết hợp vật liệu gốc cùng phụ liệu dễ tìm (dây thừng, đèn LED pin 3V, dây bấc, đất trồng...).
                    </p>
                  </div>
                </div>
                <span className="text-xs font-bold text-indigo-700 hidden sm:inline">
                  {sortedAdded.length} sản phẩm
                </span>
              </div>

              {sortedAdded.length === 0 ? (
                <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                  Không có ý tưởng phù hợp bộ lọc hiện tại trong nhóm này.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {sortedAdded.map((craft) => (
                    <CraftCard
                      key={craft.id}
                      craft={craft}
                      sourceMaterial={sourceMaterial}
                      onSelect={onSelectCraft}
                      onUpdateCraft={onUpdateCraft}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

const CraftCard: React.FC<{
  craft: CraftProduct;
  sourceMaterial?: MaterialItem | null;
  onSelect: (craft: CraftProduct) => void;
  onUpdateCraft?: (craft: CraftProduct) => void;
}> = ({ craft, sourceMaterial = null, onSelect }) => {
  const is100 = craft.type === '100_percent_recycled';
  const totalExtraCost = craft.materialsNeededExtra.reduce((acc, m) => acc + m.estimatedCostVnd, 0);

  const [currentCraft, setCurrentCraft] = useState<CraftProduct>(craft);
  const [viewMode, setViewMode] = useState<'3d' | 'image'>('3d');

  React.useEffect(() => {
    setCurrentCraft(craft);
  }, [craft]);

  return (
    <div className="flex flex-col rounded-3xl bg-white border border-slate-200/90 overflow-hidden shadow-xs hover:shadow-xl hover:border-emerald-300 transition duration-300 group">
      {/* 3D Concept Model Interactive Viewport */}
      <div className="relative h-64 w-full bg-slate-950 overflow-hidden flex items-center justify-center">
        {viewMode === '3d' ? (
          <div className="w-full h-full relative">
            <CraftViewer3D
              craft={currentCraft}
              sourceMaterial={sourceMaterial}
              currentStepIndex={0}
              height="256px"
            />
            <div className="absolute bottom-2 left-3 z-10 bg-slate-950/80 text-white text-[10px] px-2.5 py-1 rounded-md font-mono flex items-center gap-1.5 pointer-events-none">
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>Mô phỏng ý tưởng 3D • Xoay 360°</span>
            </div>
          </div>
        ) : (
          <div className="w-full h-full relative">
            {currentCraft.imageUrl ? (
              <img
                src={currentCraft.imageUrl}
                alt={currentCraft.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-slate-900 text-center space-y-2">
                <Box className="w-10 h-10 text-emerald-400" />
                <span className="text-white text-xs font-bold block">Bản vẽ ý tưởng 3D</span>
              </div>
            )}
          </div>
        )}

        <div className="absolute top-3 left-3 flex flex-col gap-1 z-10 pointer-events-none">
          <span
            className={`px-3 py-1 rounded-xl text-[11px] font-extrabold shadow-sm ${
              is100 ? 'bg-emerald-600 text-white' : 'bg-indigo-600 text-white'
            }`}
          >
            {is100 ? '100% Vật liệu sẵn có' : 'Kết hợp phụ liệu'}
          </span>
        </div>

        {currentCraft.imageUrl && (
          <div className="absolute top-3 right-3 z-10">
            <button
              type="button"
              onClick={() => setViewMode(viewMode === '3d' ? 'image' : '3d')}
              className="px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white text-[11px] font-bold border border-white/20 shadow-md flex items-center gap-1.5 transition cursor-pointer"
            >
              {viewMode === '3d' ? (
                <>
                  <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Hình minh họa</span>
                </>
              ) : (
                <>
                  <Box className="w-3.5 h-3.5 text-teal-400" />
                  <span>Xem 3D</span>
                </>
              )}
            </button>
          </div>
        )}

        <div className="absolute bottom-3 right-3 bg-slate-900/85 text-white text-[11px] px-2.5 py-1 rounded-lg font-medium flex items-center gap-1.5 z-10 pointer-events-none">
          <Clock className="w-3.5 h-3.5 text-emerald-400" />
          <span>{currentCraft.estimatedTime}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-500 uppercase">
              {currentCraft.categoryLabel} • {currentCraft.difficulty}
            </span>
            <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
              {currentCraft.recycledMaterialRatio}% Tái chế
            </span>
          </div>

          <h3 className="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition">
            {currentCraft.title}
          </h3>

          <p className="text-xs text-slate-600 leading-relaxed">{currentCraft.description}</p>

          <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100 text-[11px] text-emerald-950">
            <span className="font-bold block">Độ phù hợp:</span>
            <span>{currentCraft.whySuitable}</span>
          </div>
        </div>

        {/* Materials & Tools Summary */}
        <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
          <p className="font-semibold text-slate-700 text-[11px] flex items-center justify-between">
            <span>Vật liệu cần chuẩn bị:</span>
            {totalExtraCost > 0 ? (
              <span className="text-amber-700 font-bold">
                Phụ liệu: ~{totalExtraCost.toLocaleString('vi-VN')} đ
              </span>
            ) : (
              <span className="text-emerald-700 font-bold">0 đ bổ sung</span>
            )}
          </p>

          <div className="space-y-1">
            {currentCraft.materialsUsed.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5 text-slate-600 text-[11px]">
                <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="truncate">{m.name}</span>
              </div>
            ))}

            {currentCraft.materialsNeededExtra.map((extra, idx) => (
              <div key={idx} className="flex items-center gap-1.5 text-indigo-700 text-[11px]">
                <PlusCircle className="w-3 h-3 text-indigo-500 shrink-0" />
                <span className="truncate">{extra.name}</span>
              </div>
            ))}
          </div>

          <div className="pt-1 flex items-start gap-1.5 text-[11px] text-slate-600">
            <Wrench className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
            <span>Dụng cụ: {currentCraft.toolsRequired.join(', ')}</span>
          </div>

          {currentCraft.adultSupervisionRequired && (
            <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>Có bước cắt/ghép cần người lớn hỗ trợ an toàn.</span>
            </div>
          )}
        </div>

        <button
          onClick={() => onSelect(currentCraft)}
          className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-xs shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
        >
          <Hammer className="w-4 h-4" />
          <span>Mở Hướng Dẫn 6 Giai Đoạn & 3D ({currentCraft.steps.length} bước)</span>
        </button>
      </div>
    </div>
  );
};
