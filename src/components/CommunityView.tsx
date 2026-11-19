import React, { useState } from 'react';
import {
  Users,
  Search,
  Plus,
  Heart,
  Bookmark,
  MessageSquare,
  Clock,
  Sparkles,
  Share2,
  Filter,
  Check,
  Flame,
  ArrowRight,
  AlertTriangle,
  ImageOff,
  CheckCircle2,
  BookOpen,
  Camera
} from 'lucide-react';
import { CommunityPost, CraftProduct } from '../../server/db';
import { CommunityDetailModal } from './CommunityDetailModal';

interface CommunityViewProps {
  posts: CommunityPost[];
  onToggleLike: (postId: string) => void;
  onToggleSave: (postId: string) => void;
  onAddComment: (postId: string, text: string) => void;
  onCreateNewPost: (postData: Partial<CommunityPost>) => void;
  onOpenWorkshop?: (craft: CraftProduct) => void;
}

export const CommunityView: React.FC<CommunityViewProps> = ({
  posts,
  onToggleLike,
  onToggleSave,
  onAddComment,
  onCreateNewPost,
  onOpenWorkshop,
}) => {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const selectedPost = selectedPostId ? posts.find((p) => p.id === selectedPostId) || null : null;
  const [filterMode, setFilterMode] = useState<
    'all' | '100_percent_recycled' | 'with_added_materials' | 'pending_guide' | 'pending_image' | 'completed_guide'
  >('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New post form state
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMaterials, setNewMaterials] = useState('');
  const [newTools, setNewTools] = useState('');
  const [newCover, setNewCover] = useState('/assets/aistudio/image_9cb5bb6a.png');
  const [newDifficulty, setNewDifficulty] = useState<'Dễ' | 'Trung bình' | 'Khó'>('Dễ');
  const [hasSteps, setHasSteps] = useState(true);

  const filteredPosts = posts.filter((p) => {
    // Determine status
    const isPendingGuide = p.guideStatus === 'pending' || !p.steps || p.steps.length === 0;
    const isPendingImage = p.imageStatus === 'pending' || !p.coverImage || p.coverImage.trim() === '';

    let matchesFilter = true;
    if (filterMode === '100_percent_recycled') matchesFilter = p.type === '100_percent_recycled';
    else if (filterMode === 'with_added_materials') matchesFilter = p.type === 'with_added_materials';
    else if (filterMode === 'pending_guide') matchesFilter = isPendingGuide;
    else if (filterMode === 'pending_image') matchesFilter = isPendingImage;
    else if (filterMode === 'completed_guide') matchesFilter = !isPendingGuide && !isPendingImage;

    const matchesSearch =
      p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.authorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.materialsSummary.some((m) => m.toLowerCase().includes(searchTerm.toLowerCase()));

    return matchesFilter && matchesSearch;
  });

  const countPendingGuide = posts.filter(
    (p) => p.guideStatus === 'pending' || !p.steps || p.steps.length === 0
  ).length;

  const countPendingImage = posts.filter(
    (p) => p.imageStatus === 'pending' || !p.coverImage || p.coverImage.trim() === ''
  ).length;

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    onCreateNewPost({
      title: newTitle.trim(),
      description: newDesc.trim() ? newDesc : 'Tác phẩm tái chế sáng tạo bảo vệ môi trường.',
      materialsSummary: newMaterials ? newMaterials.split(',').map((s) => s.trim()) : ['Chai nhựa', 'Kéo'],
      toolsSummary: newTools ? newTools.split(',').map((s) => s.trim()) : ['Kéo', 'Keo dán'],
      coverImage: newCover,
      difficulty: newDifficulty,
      type: '100_percent_recycled',
      estimatedTime: '30 phút',
      recycledRatio: 100,
      guideStatus: hasSteps ? 'completed' : 'pending',
      imageStatus: newCover ? 'completed' : 'pending',
      steps: hasSteps
        ? [
            {
              stepNumber: 1,
              title: 'Chuẩn bị và làm sạch vật liệu',
              description: 'Vệ sinh sạch sẽ vật liệu tái chế và phơi khô.',
              materialsNeeded: ['Vật liệu tái chế'],
              toolsNeeded: ['Kéo'],
              highlightPart: 'body',
            },
          ]
        : [],
    });

    setShowCreateModal(false);
    setNewTitle('');
    setNewDesc('');
    setNewMaterials('');
    setNewTools('');
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-emerald-200/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#059669]">
              Cộng đồng sáng tạo xanh
            </span>
            <span className="text-xs text-slate-500">• {posts.length} tác phẩm & ý tưởng</span>
          </div>
          <h2 className="text-2xl font-black text-[#0A5C36] tracking-tight mt-1">
            Thư Viện Ý Tưởng & Hướng Dẫn Tái Chế
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Khám phá các sản phẩm thủ công thực tế từ chai nhựa, nắp chai, quần jean, bìa carton, lon nhôm và cùng đóng góp hoàn thiện các ý tưởng mới.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="min-h-[42px] px-5 py-2.5 rounded-xl eco-btn-primary font-bold text-xs flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Đăng tác phẩm / ý tưởng mới</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-white border border-emerald-200/80 shadow-2xs flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm theo tên sản phẩm, vật liệu, tác giả..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-emerald-200 text-xs text-slate-800 bg-[#F0FDF4]/60 focus:bg-white focus:outline-hidden focus:border-[#059669]"
            />
          </div>

          <div className="text-xs text-slate-500 flex items-center gap-2 self-start sm:self-auto">
            <span>Hiển thị: </span>
            <span className="font-bold text-[#0284C7] tabular-nums">{filteredPosts.length} / {posts.length} mục</span>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2 border-t border-slate-100">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              filterMode === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            Tất cả ({posts.length})
          </button>

          <button
            onClick={() => setFilterMode('100_percent_recycled')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              filterMode === '100_percent_recycled'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-emerald-800'
            }`}
          >
            🌿 100% Rác Tái Chế
          </button>

          <button
            onClick={() => setFilterMode('with_added_materials')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              filterMode === 'with_added_materials'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-indigo-800'
            }`}
          >
            ✨ Có Phụ Liệu
          </button>

          {/* Pending Instructions Tab */}
          <button
            onClick={() => setFilterMode('pending_guide')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition ${
              filterMode === 'pending_guide'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200'
            }`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${filterMode === 'pending_guide' ? 'text-white' : 'text-amber-600'}`} />
            <span>Chưa cập nhật cách làm ({countPendingGuide})</span>
          </button>

          {/* Pending Images Tab */}
          <button
            onClick={() => setFilterMode('pending_image')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition ${
              filterMode === 'pending_image'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200'
            }`}
          >
            <ImageOff className={`w-3.5 h-3.5 ${filterMode === 'pending_image' ? 'text-white' : 'text-purple-600'}`} />
            <span>Chưa cập nhật hình ảnh ({countPendingImage})</span>
          </button>

          <button
            onClick={() => setFilterMode('completed_guide')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              filterMode === 'completed_guide'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            ✅ Đầy đủ ảnh & cách làm
          </button>
        </div>
      </div>

      {/* Community Gallery Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPosts.map((post) => {
          const isLiked = (post as any).isLiked;
          const isSaved = (post as any).isSaved;
          const isPendingGuide = post.guideStatus === 'pending' || !post.steps || post.steps.length === 0;
          const isPendingImage = post.imageStatus === 'pending' || !post.coverImage || post.coverImage.trim() === '';

          return (
            <div
              key={post.id}
              className={`eco-card flex flex-col overflow-hidden group ${
                isPendingGuide
                  ? '!border-amber-200 ring-1 ring-amber-100'
                  : isPendingImage
                  ? '!border-purple-200 ring-1 ring-purple-100'
                  : ''
              }`}
            >
              {/* Cover Image or Pending Image Placeholder */}
              <div
                onClick={() => setSelectedPostId(post.id)}
                className="relative h-48 w-full bg-slate-100 overflow-hidden cursor-pointer"
              >
                {!isPendingImage ? (
                  <img
                    src={post.coverImage}
                    alt={post.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-purple-50 to-indigo-50 p-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-purple-100 flex items-center justify-center mb-2 shadow-xs">
                      <Camera className="w-6 h-6 text-purple-600" />
                    </div>
                    <span className="text-xs font-bold text-purple-900 bg-purple-200/80 px-3 py-1 rounded-full">
                      🖼️ Chưa cập nhật hình ảnh
                    </span>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-[200px]">
                      Chờ thành viên cộng đồng tải ảnh thành phẩm thực tế!
                    </p>
                  </div>
                )}

                {/* Top Badges Stack */}
                <div className="absolute top-3 left-3 flex flex-col gap-1 items-start">
                  <span
                    className={`px-3 py-0.5 rounded-xl text-[10px] font-extrabold shadow-sm ${
                      post.type === '100_percent_recycled'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-indigo-600 text-white'
                    }`}
                  >
                    {post.type === '100_percent_recycled' ? '🌿 100% Tái chế' : '✨ Có phụ liệu'}
                  </span>

                  {/* Pending Guide Badge */}
                  {isPendingGuide && (
                    <span className="px-2.5 py-0.5 rounded-xl text-[10px] font-black bg-amber-500 text-white shadow-sm flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Chưa cập nhật cách làm</span>
                    </span>
                  )}

                  {/* Pending Image Badge (if displayed over photo or when empty) */}
                  {isPendingImage && (
                    <span className="px-2.5 py-0.5 rounded-xl text-[10px] font-black bg-purple-600 text-white shadow-sm flex items-center gap-1">
                      <ImageOff className="w-3 h-3" />
                      <span>Chưa cập nhật hình ảnh</span>
                    </span>
                  )}
                </div>

                <div className="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-md text-white text-[10px] px-2.5 py-1 rounded-lg font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{post.estimatedTime}</span>
                </div>
              </div>

              {/* Author & Info */}
              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <img
                      src={post.authorAvatar}
                      alt={post.authorName}
                      className="w-6 h-6 rounded-full object-cover"
                    />
                    <span className="text-xs font-semibold text-slate-700 truncate">
                      {post.authorName}
                    </span>
                  </div>

                  <h3
                    onClick={() => setSelectedPostId(post.id)}
                    className="font-bold text-slate-900 text-base group-hover:text-emerald-700 transition line-clamp-1 cursor-pointer"
                  >
                    {post.title}
                  </h3>

                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap break-words">
                    {post.description}
                  </p>
                </div>

                {/* Status Callout Bar if pending */}
                {isPendingGuide && (
                  <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Mục này chưa cập nhật cách làm chi tiết.</span>
                  </div>
                )}

                {isPendingImage && !isPendingGuide && (
                  <div className="p-2 rounded-xl bg-purple-50 border border-purple-200 text-[11px] text-purple-800 flex items-center gap-1.5 font-medium">
                    <Camera className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    <span>Đang chờ bổ sung ảnh chụp thực tế.</span>
                  </div>
                )}

                {/* Materials badges */}
                <div className="flex flex-wrap gap-1 text-[11px]">
                  {post.materialsSummary.slice(0, 2).map((m, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 truncate max-w-[140px]"
                    >
                      {m}
                    </span>
                  ))}
                  {post.materialsSummary.length > 2 && (
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-400">
                      +{post.materialsSummary.length - 2}
                    </span>
                  )}
                </div>

                {/* Footer Interactions Bar */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLike(post.id);
                      }}
                      className={`flex items-center gap-1 font-semibold transition ${
                        isLiked ? 'text-rose-600' : 'text-slate-500 hover:text-rose-600'
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500 text-rose-500' : ''}`} />
                      <span>{post.likesCount}</span>
                    </button>

                    <button
                      onClick={() => setSelectedPostId(post.id)}
                      className="flex items-center gap-1 text-slate-500 hover:text-slate-700 transition"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>{post.commentsCount ?? post.comments.length}</span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSave(post.id);
                      }}
                      className={`p-1 transition ${
                        isSaved ? 'text-emerald-600' : 'text-slate-400 hover:text-emerald-600'
                      }`}
                      title={isSaved ? 'Đã lưu' : 'Lưu ý tưởng'}
                    >
                      <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-emerald-600' : ''}`} />
                    </button>
                  </div>

                  <button
                    onClick={() => setSelectedPostId(post.id)}
                    className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
                  >
                    <span>{isPendingGuide ? 'Xem ý tưởng' : 'Xem 3D & Chi tiết'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Modal */}
      {selectedPost && (
        <CommunityDetailModal
          post={selectedPost}
          onClose={() => setSelectedPostId(null)}
          onToggleLike={onToggleLike}
          onToggleSave={onToggleSave}
          onAddComment={onAddComment}
          onOpenWorkshop={onOpenWorkshop}
        />
      )}

      {/* Publish New Post Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 sm:p-8 space-y-5 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-slate-900 text-lg">
                Đăng Tác Phẩm Hoặc Ý Tưởng Lên Cộng Đồng
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-800 block mb-1">
                  Tên sản phẩm tái chế
                </label>
                <input
                  type="text"
                  required
                  defaultValue={newTitle}
                  onInput={(e) => setNewTitle(e.currentTarget.value)}
                  placeholder="Ví dụ: Giỏ hoa trang trí từ chai nước suối"
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-base sm:text-xs focus:outline-hidden focus:ring-2 focus:ring-emerald-500 touch-auto select-text"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-800 block">Mô tả ý tưởng</label>
                  <span className="text-[11px] font-semibold text-emerald-700">
                    {newDesc.length} ký tự • Không giới hạn
                  </span>
                </div>
                <textarea
                  rows={4}
                  defaultValue={newDesc}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${Math.max(100, el.scrollHeight)}px`;
                    setNewDesc(el.value);
                  }}
                  onBlur={(e) => setNewDesc(e.currentTarget.value)}
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  spellCheck={true}
                  enterKeyHint="enter"
                  inputMode="text"
                  placeholder="Chia sẻ nguồn gốc vật liệu và cảm hứng sáng tạo..."
                  className="w-full min-h-[100px] p-3 rounded-xl border border-slate-300 text-base sm:text-xs leading-relaxed resize-y focus:outline-hidden focus:ring-2 focus:ring-emerald-500 touch-auto select-text whitespace-pre-wrap"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-800 block mb-1">
                    Vật liệu (cách nhau dấu phẩy)
                  </label>
                  <input
                    type="text"
                    value={newMaterials}
                    onChange={(e) => setNewMaterials(e.target.value)}
                    placeholder="Chai PET, Dây vải..."
                    className="w-full p-2.5 rounded-xl border border-slate-300"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-800 block mb-1">Độ khó</label>
                  <select
                    value={newDifficulty}
                    onChange={(e: any) => setNewDifficulty(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-300 bg-white"
                  >
                    <option value="Dễ">Dễ</option>
                    <option value="Trung bình">Trung bình</option>
                    <option value="Khó">Khó</option>
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">Đã có cách làm từng bước chưa?</p>
                  <p className="text-[11px] text-slate-500">
                    Nếu chưa, bài đăng sẽ hiển thị nhãn "Chưa cập nhật cách làm".
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={hasSteps}
                  onChange={(e) => setHasSteps(e.target.checked)}
                  className="w-4 h-4 rounded-sm text-emerald-600 accent-emerald-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2.5 rounded-xl border text-slate-600 font-semibold"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  Xuất bản ngay
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
