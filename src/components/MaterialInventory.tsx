import React, { useState } from 'react';
import {
  Package,
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  ShieldCheck,
  Tag,
  CheckSquare,
  Square,
  ArrowRight,
  Filter,
  Search,
  Droplets,
  Scissors,
  Camera,
  ImageOff,
  AlertTriangle
} from 'lucide-react';
import { MaterialItem } from '../../server/db';

interface MaterialInventoryProps {
  materials: MaterialItem[];
  onSelectCombineMaterials: (selectedMaterials: MaterialItem[]) => void;
  onGenerateIdeasForMaterial?: (material: MaterialItem) => void;
  onDeleteMaterial: (id: string) => void;
  onUpdateMaterial: (material: MaterialItem) => void;
  onAddNewScan: () => void;
}

export const MaterialInventory: React.FC<MaterialInventoryProps> = ({
  materials,
  onSelectCombineMaterials,
  onGenerateIdeasForMaterial,
  onDeleteMaterial,
  onUpdateMaterial,
  onAddNewScan,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedIds.length === materials.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(materials.map((m) => m.id));
    }
  };

  const filteredMaterials = materials.filter((m) => {
    const matchesCategory = categoryFilter === 'all' || m.category === categoryFilter;
    const isPendingImage = m.imageStatus === 'pending' || !m.images || m.images.length === 0;

    let matchesStatus = true;
    if (statusFilter === 'pending_image') matchesStatus = isPendingImage;
    else if (statusFilter === 'has_image') matchesStatus = !isPendingImage;

    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.condition.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesCategory && matchesStatus && matchesSearch;
  });

  const selectedMaterials = materials.filter((m) => selectedIds.includes(m.id));

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-emerald-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#059669]">
              Quản lý vật liệu tái chế
            </span>
            <span className="text-xs text-slate-500">• {materials.length} loại vật liệu</span>
          </div>
          <h2 className="text-2xl font-black text-[#0A5C36] tracking-tight mt-1">
            Kho Vật Liệu Tái Chế Của Tôi
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Xem nhóm rác thải, tình trạng an toàn và chọn nhiều loại vật liệu cùng lúc để AI sáng tạo sản phẩm kết hợp.
          </p>
        </div>

        <button
          type="button"
          onClick={onAddNewScan}
          className="min-h-[42px] px-4 py-2.5 rounded-xl eco-btn-primary font-bold text-xs flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Quét thêm vật liệu mới</span>
        </button>
      </div>

      {/* Combine Materials Floating Action Bar */}
      {selectedIds.length > 0 && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center font-bold text-sm">
              {selectedIds.length}
            </div>
            <div>
              <p className="font-bold text-sm">Đã chọn {selectedIds.length} loại vật liệu kết hợp</p>
              <p className="text-xs text-emerald-100 truncate max-w-md">
                {selectedMaterials.map((m) => m.name).join(' + ')}
              </p>
            </div>
          </div>

          <button
            onClick={() => onSelectCombineMaterials(selectedMaterials)}
            className="px-5 py-2.5 rounded-xl bg-white text-emerald-800 font-extrabold text-xs shadow-sm hover:bg-emerald-50 flex items-center gap-2 transition"
          >
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span>Phối hợp tìm ý tưởng chế tạo AI</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-2xl bg-white border border-emerald-200/80 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên vật liệu..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-emerald-200 text-xs text-slate-800 bg-[#F0FDF4]/60 focus:bg-white focus:outline-hidden focus:border-[#059669]"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-between sm:justify-end">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="p-2 rounded-xl border border-emerald-200 text-xs font-semibold text-slate-700 bg-white"
          >
            <option value="all">Tất cả nhóm rác</option>
            <option value="plastic">Nhựa (Chai, nắp, ống hút)</option>
            <option value="paper">Giấy & Thùng Carton</option>
            <option value="fabric">Vải & Quần Jean</option>
            <option value="metal">Kim loại (Lon nhôm)</option>
            <option value="other">Rác khác (Dây thừng, que tre)</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-2 rounded-xl border border-emerald-200 text-xs font-semibold text-slate-700 bg-white"
          >
            <option value="all">Tất cả trạng thái ảnh</option>
            <option value="has_image">Đã có hình ảnh</option>
            <option value="pending_image">Chưa cập nhật hình ảnh</option>
          </select>

          <button
            type="button"
            onClick={selectAll}
            className="text-xs font-bold text-[#0284C7] hover:underline px-2 cursor-pointer"
          >
            {selectedIds.length === materials.length ? 'Bỏ chọn hết' : 'Chọn tất cả'}
          </button>
        </div>
      </div>

      {/* Material Cards Grid */}
      {filteredMaterials.length === 0 ? (
        <div className="p-12 rounded-2xl bg-[#F0FDF4] border border-emerald-200/80 text-center space-y-3">
          <Package className="w-12 h-12 text-emerald-300 mx-auto" />
          <p className="text-[#0A5C36] text-sm font-semibold">
            Không tìm thấy vật liệu phù hợp với bộ lọc.
          </p>
          <button
            type="button"
            onClick={onAddNewScan}
            className="px-4 py-2 rounded-xl eco-btn-primary font-bold text-xs cursor-pointer"
          >
            Chụp hoặc tải ảnh vật liệu ngay
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMaterials.map((mat) => {
            const isSelected = selectedIds.includes(mat.id);
            const isPendingImage = mat.imageStatus === 'pending' || !mat.images || mat.images.length === 0;

            return (
              <div
                key={mat.id}
                className={`eco-card flex flex-col overflow-hidden ${
                  isSelected ? '!border-[#059669] ring-2 ring-[#10B981]/25' : ''
                }`}
              >
                {/* Image & Select checkbox */}
                <div className="relative h-44 w-full bg-slate-100 overflow-hidden">
                  {!isPendingImage ? (
                    <img
                      src={mat.images[0]}
                      alt={mat.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-purple-50 p-4 text-center">
                      <Camera className="w-8 h-8 text-purple-400 mb-1" />
                      <span className="text-[10px] font-extrabold text-purple-800 bg-purple-100 px-2 py-0.5 rounded-md">
                        🖼️ Chưa cập nhật hình ảnh
                      </span>
                    </div>
                  )}

                  {/* Checkbox */}
                  <button
                    onClick={() => toggleSelect(mat.id)}
                    className="absolute top-3 left-3 p-1.5 rounded-xl bg-white/90 backdrop-blur-md text-slate-700 hover:text-emerald-700 shadow-sm transition"
                    title={isSelected ? 'Bỏ chọn' : 'Chọn để phối hợp'}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400" />
                    )}
                  </button>

                  {/* Pending Badge on top right */}
                  {isPendingImage && (
                    <span className="absolute top-3 right-3 bg-purple-600/90 text-white text-[10px] px-2 py-0.5 rounded-lg font-bold">
                      Chưa cập nhật ảnh
                    </span>
                  )}

                  {/* Quantity Badge */}
                  <span className="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-md text-white text-[11px] px-2.5 py-1 rounded-lg font-bold">
                    Số lượng: {mat.quantity} {mat.unit}
                  </span>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {mat.categoryLabel}
                      </span>
                      {mat.recycleCode && (
                        <span className="font-mono text-slate-500 text-[11px]">
                          {mat.recycleCode}
                        </span>
                      )}
                    </div>

                    <h3 className="font-bold text-slate-900 text-base line-clamp-1">{mat.name}</h3>
                    <p className="text-xs text-slate-500 line-clamp-2">{mat.condition}</p>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold">KÍCH THƯỚC</span>
                      <span className="font-mono text-slate-700 font-medium">
                        {mat.dimensions.shapeType === 'box'
                          ? `${mat.dimensions.lengthCm}×${mat.dimensions.widthCm}×${mat.dimensions.heightCm}cm`
                          : `Ø${mat.dimensions.diameterCm || 6.5}×${mat.dimensions.heightCm}cm`}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-semibold">KHẢ DỤNG</span>
                      <span className="font-bold text-emerald-700">
                        {mat.dimensions.usableRatioPercent}% tận dụng
                      </span>
                    </div>
                  </div>

                  {/* Safety Status & Actions */}
                  <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-slate-100">
                    <span
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] ${
                        mat.status === 'safe_to_use'
                          ? 'bg-emerald-100 text-emerald-800'
                          : mat.status === 'needs_cleaning'
                          ? 'bg-amber-100 text-amber-800'
                          : mat.status === 'needs_special_handling'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {mat.statusLabel}
                    </span>

                    <div className="flex items-center gap-1">
                      {onGenerateIdeasForMaterial && (
                        <button
                          onClick={() => onGenerateIdeasForMaterial(mat)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 transition cursor-pointer"
                          title="Phân tích tái sử dụng & gợi ý sản phẩm 3D"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Gợi ý 3D</span>
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteMaterial(mat.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 transition cursor-pointer"
                        title="Xóa vật liệu này"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
