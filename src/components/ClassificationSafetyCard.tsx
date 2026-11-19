import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  Info,
  CheckCircle2,
  Trash2,
  Edit3,
  Droplets,
  Scissors,
  Check,
  Tag
} from 'lucide-react';
import { MaterialItem } from '../../server/db';

interface ClassificationSafetyCardProps {
  material: MaterialItem;
  onConfirmClassification: (updatedMaterial: MaterialItem) => void;
  onAddToInventory?: (material: MaterialItem) => void;
}

export const ClassificationSafetyCard: React.FC<ClassificationSafetyCardProps> = ({
  material,
  onConfirmClassification,
  onAddToInventory,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(material.name);
  const [editedCategory, setEditedCategory] = useState(material.category);
  const [editedStatus, setEditedStatus] = useState(material.status);
  const [editedCondition, setEditedCondition] = useState(material.condition);
  const [isSavedToInventory, setIsSavedToInventory] = useState(false);

  useEffect(() => {
    setEditedName(material.name);
    setEditedCategory(material.category);
    setEditedStatus(material.status);
    setEditedCondition(material.condition);
    setIsSavedToInventory(false);
    setIsEditing(false);
  }, [material.id]);

  const categoryConfig: Record<
    MaterialItem['category'],
    { label: string; bg: string; text: string; icon: string }
  > = {
    plastic: { label: 'Rác thải nhựa', bg: 'bg-blue-100', text: 'text-blue-800', icon: '🧴' },
    paper: { label: 'Rác thải giấy & carton', bg: 'bg-amber-100', text: 'text-amber-800', icon: '📦' },
    metal: { label: 'Rác thải kim loại', bg: 'bg-slate-200', text: 'text-slate-800', icon: '🥫' },
    glass: { label: 'Rác thải thủy tinh', bg: 'bg-cyan-100', text: 'text-cyan-800', icon: '🍶' },
    fabric: { label: 'Vải & Dệt may', bg: 'bg-purple-100', text: 'text-purple-800', icon: '👕' },
    organic: { label: 'Rác thải hữu cơ', bg: 'bg-emerald-100', text: 'text-emerald-800', icon: '🍃' },
    electronic: { label: 'Rác thải điện tử', bg: 'bg-rose-100', text: 'text-rose-800', icon: '⚡' },
    other: { label: 'Rác thải khác', bg: 'bg-gray-100', text: 'text-gray-800', icon: '♻️' },
  };

  const statusConfig: Record<
    MaterialItem['status'],
    { label: string; badgeBg: string; border: string; desc: string; icon: any }
  > = {
    safe_to_use: {
      label: 'Có thể sử dụng',
      badgeBg: 'bg-emerald-100 text-emerald-800',
      border: 'border-emerald-300',
      desc: 'Vật liệu an toàn, nguyên vẹn, thích hợp trực tiếp làm đồ thủ công.',
      icon: ShieldCheck,
    },
    needs_cleaning: {
      label: 'Cần làm sạch',
      badgeBg: 'bg-amber-100 text-amber-800',
      border: 'border-amber-300',
      desc: 'Cần bóc nhãn, súc rửa xà phòng hoặc phơi khô trước khi chế tác.',
      icon: Droplets,
    },
    needs_special_handling: {
      label: 'Cần xử lý riêng',
      badgeBg: 'bg-purple-100 text-purple-800',
      border: 'border-purple-300',
      desc: 'Có cạnh sắc hoặc cấu trúc cần bảo hộ, người lớn hỗ trợ khi cắt.',
      icon: Scissors,
    },
    not_recommended: {
      label: 'Không nên tái sử dụng thủ công',
      badgeBg: 'bg-rose-100 text-rose-800',
      border: 'border-rose-300',
      desc: 'Vật liệu có nguy cơ độc hại hoặc sắc nhọn vỡ, nên chuyển đến điểm thu gom.',
      icon: AlertTriangle,
    },
  };

  const currentCategory = categoryConfig[material.category] || categoryConfig.other;
  const currentStatus = statusConfig[material.status] || statusConfig.needs_cleaning;
  const StatusIcon = currentStatus.icon;

  const handleSaveEdit = () => {
    const updated: MaterialItem = {
      ...material,
      name: editedName,
      category: editedCategory,
      categoryLabel: categoryConfig[editedCategory].label,
      status: editedStatus,
      statusLabel: statusConfig[editedStatus].label,
      condition: editedCondition,
    };
    onConfirmClassification(updated);
    setIsEditing(false);
  };

  const handleAddInventory = () => {
    if (onAddToInventory) {
      onAddToInventory(material);
      setIsSavedToInventory(true);
    }
  };

  return (
    <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="text-3xl p-2.5 rounded-2xl bg-slate-100">{currentCategory.icon}</div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${currentCategory.bg} ${currentCategory.text}`}
              >
                {currentCategory.label}
              </span>
              {material.recycleCode && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                  <Tag className="w-3 h-3 text-emerald-600" />
                  <span>{material.recycleCode}</span>
                </span>
              )}
              {material.reconstruction?.object?.material && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                  {material.reconstruction.object.material} (
                  {Math.round((material.reconstruction.object.materialConfidence || 0.7) * 100)}%)
                </span>
              )}
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 mt-1">
              {material.name}
            </h3>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isEditing ? 'Hủy sửa' : 'Chỉnh sửa phân loại'}</span>
          </button>

          {onAddToInventory && (
            <button
              onClick={handleAddInventory}
              disabled={isSavedToInventory}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                isSavedToInventory
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSavedToInventory ? 'Đã lưu vào kho' : 'Lưu vào Kho vật liệu'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Editing Form if active */}
      {isEditing ? (
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4 text-xs">
          <h4 className="font-bold text-slate-800">Hiệu chỉnh kết quả nhận diện AI</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Tên vật liệu</label>
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                className="w-full p-2 rounded-lg border border-slate-300 text-slate-800 bg-white"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Nhóm rác thải</label>
              <select
                value={editedCategory}
                onChange={(e: any) => setEditedCategory(e.target.value)}
                className="w-full p-2 rounded-lg border border-slate-300 text-slate-800 bg-white"
              >
                <option value="plastic">Rác thải nhựa (Chai, nắp, hộp...)</option>
                <option value="paper">Rác thải giấy & bìa carton</option>
                <option value="metal">Rác thải kim loại (Lon nhôm, nắp...)</option>
                <option value="glass">Rác thải thủy tinh</option>
                <option value="fabric">Vải & Dệt may (Quần áo cũ...)</option>
                <option value="organic">Rác thải hữu cơ</option>
                <option value="electronic">Rác thải điện tử</option>
                <option value="other">Rác thải khác</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Trạng thái an toàn</label>
              <select
                value={editedStatus}
                onChange={(e: any) => setEditedStatus(e.target.value)}
                className="w-full p-2 rounded-lg border border-slate-300 text-slate-800 bg-white"
              >
                <option value="safe_to_use">Có thể sử dụng ngay</option>
                <option value="needs_cleaning">Cần làm sạch trước khi dùng</option>
                <option value="needs_special_handling">Cần xử lý riêng (Cạnh sắc, cần người lớn)</option>
                <option value="not_recommended">Không nên tái sử dụng thủ công</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="font-semibold text-slate-700 block mb-1">Mô tả tình trạng thực tế (Không giới hạn)</label>
              <textarea
                rows={3}
                defaultValue={editedCondition}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.max(84, el.scrollHeight)}px`;
                  setEditedCondition(el.value);
                }}
                onBlur={(e) => setEditedCondition(e.currentTarget.value)}
                enterKeyHint="enter"
                inputMode="text"
                className="w-full min-h-[84px] p-2.5 rounded-lg border border-slate-300 text-base sm:text-xs text-slate-800 bg-white resize-y focus:ring-2 focus:ring-emerald-500 touch-auto select-text whitespace-pre-wrap"
              />
            </div>
          </div>
          <button
            onClick={handleSaveEdit}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs"
          >
            Lưu thay đổi & Xác nhận
          </button>
        </div>
      ) : null}

      {/* Safety Evaluation Banner */}
      <div
        className={`p-4 sm:p-5 rounded-2xl border ${currentStatus.border} bg-slate-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}
      >
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-white shadow-xs">
            <StatusIcon className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 text-sm">Đánh giá khả năng sử dụng:</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${currentStatus.badgeBg}`}>
                {currentStatus.label}
              </span>
            </div>
            <p className="text-xs text-slate-600">{currentStatus.desc}</p>
          </div>
        </div>

        <div className="text-right text-xs text-slate-500 hidden sm:block max-w-xs">
          <p className="font-medium text-slate-700">Tình trạng:</p>
          <p className="italic whitespace-pre-wrap break-words">{material.condition}</p>
        </div>
      </div>

      {/* Preparation & Cleaning Instructions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cleaning steps */}
        <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100 space-y-2">
          <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
            <Droplets className="w-4 h-4 text-emerald-600" />
            <span>Hướng dẫn vệ sinh & xử lý trước khi làm:</span>
          </div>
          <ul className="space-y-1.5 text-xs text-slate-700">
            {material.cleaningInstructions.map((step, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-emerald-200 text-emerald-800 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Safety Warnings */}
        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-2">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>Lưu ý an toàn thủ công:</span>
          </div>
          <ul className="space-y-1.5 text-xs text-slate-700">
            {material.safetyWarnings.map((warn, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-amber-600 font-bold">•</span>
                <span>{warn}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
