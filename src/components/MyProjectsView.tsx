import React, { useState } from 'react';
import {
  FolderGit2,
  Plus,
  Play,
  Edit2,
  Copy,
  Trash2,
  Share2,
  CheckCircle2,
  Clock,
  Sparkles,
  Search,
  Filter
} from 'lucide-react';
import { UserProject, CraftProduct } from '../../server/db';

interface MyProjectsViewProps {
  projects: UserProject[];
  onResumeProject: (project: UserProject) => void;
  onDeleteProject: (id: string) => void;
  onDuplicateProject: (project: UserProject) => void;
  onPublishToCommunity: (craft: CraftProduct) => void;
  onStartNewProject: () => void;
}

export const MyProjectsView: React.FC<MyProjectsViewProps> = ({
  projects,
  onResumeProject,
  onDeleteProject,
  onDuplicateProject,
  onPublishToCommunity,
  onStartNewProject,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'idea' | 'in_progress' | 'completed'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredProjects = projects.filter((p) => {
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesSearch =
      p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-emerald-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#059669]">
              Dự án tái chế của bạn
            </span>
            <span className="text-xs text-slate-500">• {projects.length} dự án</span>
          </div>
          <h2 className="text-2xl font-black text-[#0A5C36] tracking-tight mt-1">
            Dự Án Của Tôi
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Lưu giữ toàn bộ quá trình sáng tạo. Bạn có thể quay lại tiếp tục đúng công đoạn 3D đã dừng bất cứ lúc nào.
          </p>
        </div>

        <button
          type="button"
          onClick={onStartNewProject}
          className="min-h-[42px] px-4 py-2.5 rounded-xl eco-btn-primary font-bold text-xs flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Tạo dự án tái chế mới</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-white border border-emerald-200/80 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo tên dự án..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-emerald-200 text-xs text-slate-800 bg-[#F0FDF4]/60 focus:bg-white focus:outline-hidden focus:border-[#059669]"
          />
        </div>

        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#F0FDF4] border border-emerald-200/70 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white text-[#0A5C36] shadow-xs border border-emerald-200/60'
                : 'text-slate-600 hover:text-[#0A5C36]'
            }`}
          >
            Tất cả ({projects.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('in_progress')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              statusFilter === 'in_progress'
                ? 'bg-[#059669] text-white shadow-xs'
                : 'text-[#059669] hover:text-[#0A5C36]'
            }`}
          >
            Đang làm
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('completed')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              statusFilter === 'completed'
                ? 'bg-[#0284C7] text-white shadow-xs'
                : 'text-[#0284C7] hover:text-[#0369A1]'
            }`}
          >
            Đã hoàn thành
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="p-12 rounded-2xl bg-[#F0FDF4] border border-emerald-200/80 text-center space-y-3">
          <FolderGit2 className="w-12 h-12 text-emerald-300 mx-auto" />
          <p className="text-[#0A5C36] text-sm font-semibold">Chưa có dự án nào trong mục này.</p>
          <button
            type="button"
            onClick={onStartNewProject}
            className="px-4 py-2 rounded-xl eco-btn-primary font-bold text-xs cursor-pointer"
          >
            Quét vật liệu và bắt đầu dự án đầu tiên
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((proj) => {
            const isCompleted = proj.status === 'completed';
            return (
              <div
                key={proj.id}
                className="eco-card flex flex-col overflow-hidden group"
              >
                {/* Cover Image */}
                <div className="relative h-44 w-full bg-slate-100 overflow-hidden">
                  <img
                    src={proj.coverImage}
                    alt={proj.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                  <div className="absolute top-3 left-3">
                    <span
                      className={`px-3 py-1 rounded-xl text-[11px] font-extrabold shadow-sm ${
                        isCompleted
                          ? 'bg-emerald-600 text-white'
                          : 'bg-amber-500 text-white'
                      }`}
                    >
                      {isCompleted ? '✓ Đã hoàn thành' : 'Đang thực hiện'}
                    </span>
                  </div>
                  <div className="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-md text-white text-[10px] px-2.5 py-1 rounded-md">
                    Cập nhật: {proj.updatedAt}
                  </div>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <h3 className="font-bold text-slate-900 text-base line-clamp-1">{proj.title}</h3>
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {proj.description}
                    </p>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <span>Tiến độ thực hiện:</span>
                      <span className="font-bold text-emerald-700">{proj.progressPercent}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${proj.progressPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-2 flex items-center justify-between gap-2">
                    <button
                      onClick={() => onResumeProject(proj)}
                      className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>{isCompleted ? 'Xem lại xưởng 3D' : 'Tiếp tục chế tác'}</span>
                    </button>

                    <button
                      onClick={() => onDuplicateProject(proj)}
                      className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
                      title="Nhân bản dự án"
                    >
                      <Copy className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onPublishToCommunity(proj.craftData)}
                      className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-emerald-700 transition"
                      title="Xuất bản lên cộng đồng"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => onDeleteProject(proj.id)}
                      className="p-2 rounded-xl border border-slate-200 hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition"
                      title="Xóa dự án"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
