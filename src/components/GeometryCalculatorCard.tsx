import React, { useState, useEffect } from 'react';
import {
  Ruler,
  Maximize2,
  Box,
  Layers,
  HelpCircle,
  Calculator,
  Percent,
  CheckCircle,
  Edit2
} from 'lucide-react';
import { MaterialItem } from '../../server/db';

interface GeometryCalculatorCardProps {
  material: MaterialItem;
  onUpdateDimensions?: (dimensions: MaterialItem['dimensions']) => void;
}

export const GeometryCalculatorCard: React.FC<GeometryCalculatorCardProps> = ({
  material,
  onUpdateDimensions,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [dims, setDims] = useState(material.dimensions);

  useEffect(() => {
    setDims(material.dimensions);
    setIsEditing(false);
  }, [material]);

  const isCylinder = dims.shapeType === 'cylinder';
  const isBox = dims.shapeType === 'box';
  const isSphere = dims.shapeType === 'sphere';
  const isCone = dims.shapeType === 'cone';
  const reconDims = material.reconstruction?.dimensions;

  const handleSave = () => {
    let vol = dims.volumeMl || 0;
    let totalS = dims.totalSurfaceCm2 || 0;
    let usableS = dims.usableSurfaceCm2 || 0;

    if (isCylinder && (dims.diameterCm || dims.widthCm) && dims.heightCm) {
      const d = dims.diameterCm || dims.widthCm || 6.5;
      const r = d / 2;
      const h = dims.heightCm;
      vol = Math.round(Math.PI * r * r * h);
      totalS = Math.round(2 * Math.PI * r * (r + h));
      usableS = Math.round(2 * Math.PI * r * h * 0.8);
    } else if (isSphere && (dims.diameterCm || dims.widthCm || dims.heightCm)) {
      const d = dims.diameterCm || dims.widthCm || dims.heightCm || 10;
      const r = d / 2;
      vol = Math.round((4 / 3) * Math.PI * r * r * r);
      totalS = Math.round(4 * Math.PI * r * r);
      usableS = Math.round(totalS * 0.78);
    } else if (isCone && (dims.diameterCm || dims.widthCm) && dims.heightCm) {
      const d = dims.diameterCm || dims.widthCm || 8;
      const r = d / 2;
      const h = dims.heightCm;
      const l = Math.sqrt(r * r + h * h);
      vol = Math.round((1 / 3) * Math.PI * r * r * h);
      totalS = Math.round(Math.PI * r * (r + l));
      usableS = Math.round(Math.PI * r * l * 0.85);
    } else if (dims.lengthCm && dims.widthCm && dims.heightCm) {
      const a = dims.lengthCm;
      const b = dims.widthCm;
      const c = dims.heightCm;
      const shapeFactor = isBox ? 1 : 0.68;
      vol = Math.round(a * b * c * shapeFactor);
      totalS = Math.round(2 * (a * b + b * c + c * a) * (isBox ? 1 : 0.82));
      usableS = Math.round(totalS * 0.82);
    }

    const usableRatio = totalS > 0 ? Math.round((usableS / totalS) * 100) : 80;

    const updated = {
      ...dims,
      volumeMl: vol,
      totalSurfaceCm2: totalS,
      usableSurfaceCm2: usableS,
      usableRatioPercent: usableRatio,
    };

    setDims(updated);
    if (onUpdateDimensions) onUpdateDimensions(updated);
    setIsEditing(false);
  };

  return (
    <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-teal-50 text-teal-700">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-lg sm:text-xl">
              Toán Học & Đo Lường Kích Thước Hình Học 3D
            </h3>
            <p className="text-xs text-slate-500">
              Công thức hình học xác định thể tích, diện tích bề mặt và lượng vật liệu cắt ghép thực tế
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsEditing(!isEditing)}
          className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition self-start sm:self-auto"
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span>{isEditing ? 'Đóng' : 'Nhập kích thước tay'}</span>
        </button>
      </div>

      {/* Dimensional Inputs if editing */}
      {isEditing && (
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
          <p className="font-bold text-slate-800">Hiệu chuẩn kích thước thực tế (cm)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-slate-600 block mb-1">Chiều cao (H)</label>
              <input
                type="number"
                value={dims.heightCm}
                onChange={(e) => setDims({ ...dims, heightCm: parseFloat(e.target.value) || 0 })}
                className="w-full p-2 rounded-lg border bg-white"
              />
            </div>
            {isCylinder ? (
              <div>
                <label className="text-slate-600 block mb-1">Đường kính (Ø)</label>
                <input
                  type="number"
                  value={dims.diameterCm || 6.5}
                  onChange={(e) =>
                    setDims({ ...dims, diameterCm: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full p-2 rounded-lg border bg-white"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-slate-600 block mb-1">Chiều dài (L)</label>
                  <input
                    type="number"
                    value={dims.lengthCm}
                    onChange={(e) =>
                      setDims({ ...dims, lengthCm: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full p-2 rounded-lg border bg-white"
                  />
                </div>
                <div>
                  <label className="text-slate-600 block mb-1">Chiều rộng (W)</label>
                  <input
                    type="number"
                    value={dims.widthCm}
                    onChange={(e) =>
                      setDims({ ...dims, widthCm: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full p-2 rounded-lg border bg-white"
                  />
                </div>
              </>
            )}
          </div>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-teal-600 text-white font-bold text-xs"
          >
            Tính toán lại thông số 3D
          </button>
        </div>
      )}

      {/* Geometry Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Dimensions */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Kích thước (XYZ)
          </span>
          <p className="text-lg font-extrabold text-slate-900">
            {isCylinder
              ? `Ø ${dims.diameterCm || 6.5} × ${dims.heightCm} cm`
              : `${dims.lengthCm} × ${dims.widthCm} × ${dims.heightCm} cm`}
          </p>
          <span className="text-[11px] text-slate-500 block">
            {isCylinder ? 'Hình trụ tròn đều' : 'Hình khối hộp chữ nhật'}
          </span>
        </div>

        {/* Volume */}
        <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-1">
          <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
            Thể tích ước tính (V)
          </span>
          <p className="text-lg font-extrabold text-emerald-700">
            {dims.volumeMl || 500} ml / cm³
          </p>
          <span className="text-[11px] text-emerald-600 font-mono block">
            {isCylinder ? 'V = π × r² × h' : 'V = a × b × c'}
          </span>
        </div>

        {/* Total Surface Area */}
        <div className="p-4 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-1">
          <span className="text-[11px] font-bold text-blue-800 uppercase tracking-wider">
            Diện tích toàn phần
          </span>
          <p className="text-lg font-extrabold text-blue-700">
            {dims.totalSurfaceCm2 || 400} cm²
          </p>
          <span className="text-[11px] text-blue-600 font-mono block">
            {isCylinder ? 'S_tp = 2πr(r + h)' : '2(ab + bc + ca)'}
          </span>
        </div>

        {/* Usable Surface Area for Crafting */}
        <div className="p-4 rounded-2xl bg-teal-50/70 border border-teal-200 space-y-1">
          <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider">
            Phần có thể tận dụng
          </span>
          <p className="text-lg font-extrabold text-teal-700">
            {dims.usableSurfaceCm2 || 350} cm²{' '}
            <span className="text-xs font-semibold">({dims.usableRatioPercent || 85}%)</span>
          </p>
          <span className="text-[11px] text-teal-600 block">Trừ hao hụt cổ nắp & đáy</span>
        </div>
      </div>

      {/* Applied Mathematical Formula Details */}
      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            <Ruler className="w-4 h-4 text-emerald-600" />
            <span>Cơ sở hình học & Thuật toán tính toán diện tích chế tạo:</span>
          </div>
          {reconDims && (
            <span className="px-2.5 py-0.5 rounded-full bg-white border border-slate-200 text-[11px] font-semibold text-slate-700">
              Phương pháp: <strong>{reconDims.measurementMethod}</strong> • Tin cậy{' '}
              {Math.round((reconDims.confidence || 0.7) * 100)}%
            </span>
          )}
        </div>
        <p className="leading-relaxed">
          {isCylinder
            ? `Vật liệu có dạng hình trụ tròn (Ø ${(dims.diameterCm || dims.widthCm || 6.5).toFixed(1)} cm × H ${(dims.heightCm || 20).toFixed(1)} cm). Diện tích thân quanh là S_xq = 2π × ${(((dims.diameterCm || dims.widthCm || 6.5) / 2)).toFixed(2)} × ${(dims.heightCm || 20).toFixed(1)} ≈ ${Math.round(Math.PI * (dims.diameterCm || dims.widthCm || 6.5) * (dims.heightCm || 20))} cm². Sau khi trừ cổ và đáy, diện tích phẳng khả dụng đạt ~${dims.usableSurfaceCm2} cm² (${dims.usableRatioPercent}%).`
            : isSphere
            ? `Vật liệu có dạng cầu đường kính Ø ${(dims.diameterCm || dims.widthCm || 10).toFixed(1)} cm. Tổng diện tích bề mặt xấp xỉ ${dims.totalSurfaceCm2} cm², phần hữu dụng đạt ~${dims.usableSurfaceCm2} cm² (${dims.usableRatioPercent}%).`
            : isCone
            ? `Vật liệu có dạng nón cụt / chóp nón (Ø ${(dims.diameterCm || dims.widthCm || 8).toFixed(1)} cm × H ${(dims.heightCm || 18).toFixed(1)} cm). Diện tích bao quanh hữu dụng đạt ~${dims.usableSurfaceCm2} cm² (${dims.usableRatioPercent}%).`
            : `Vật liệu có dạng ${isBox ? 'hình hộp chữ nhật' : 'khối đa diện'} (${dims.lengthCm} × ${dims.widthCm} × ${dims.heightCm} cm). Diện tích toàn phần ~${dims.totalSurfaceCm2} cm² và phần phẳng khả dụng để cắt ghép là ~${dims.usableSurfaceCm2} cm² (${dims.usableRatioPercent}%).`}
        </p>
      </div>
    </div>
  );
};
