import React, { useState } from 'react';
import {
  Bookmark,
  Trash2,
  Clock,
  ArrowRight,
  Sparkles,
  Layers,
  Heart
} from 'lucide-react';
import { CommunityPost, CraftProduct } from '../../server/db';
import { CommunityDetailModal } from './CommunityDetailModal';

interface SavedIdeasViewProps {
  savedPosts: CommunityPost[];
  onRemoveSaved: (postId: string) => void;
  onToggleLike: (postId: string) => void;
  onAddComment: (postId: string, text: string) => void;
  onStartCraft: (craft: CraftProduct) => void;
}

export const SavedIdeasView: React.FC<SavedIdeasViewProps> = ({
  savedPosts,
  onRemoveSaved,
  onToggleLike,
  onAddComment,
  onStartCraft,
}) => {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const selectedPost = selectedPostId ? savedPosts.find((p) => p.id === selectedPostId) || null : null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      {/* Header */}
      <div className="pb-4 border-b border-emerald-200/80">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[#059669]">
            Bộ sưu tập của bạn
          </span>
          <span className="text-xs text-slate-500">• {savedPosts.length} ý tưởng</span>
        </div>
        <h2 className="text-2xl font-black text-[#0A5C36] tracking-tight mt-1">
          Ý Tưởng Sáng Tạo Đã Lưu
        </h2>
        <p className="text-xs sm:text-sm text-slate-600">
          Những sản phẩm thủ công từ cộng đồng bạn đã đánh dấu để chuẩn bị làm khi gom đủ vật liệu.
        </p>
      </div>

      {savedPosts.length === 0 ? (
        <div className="p-12 rounded-2xl bg-[#F0FDF4] border border-emerald-200/80 text-center space-y-3">
          <Bookmark className="w-12 h-12 text-emerald-300 mx-auto" />
          <p className="text-[#0A5C36] text-sm font-semibold">
            Bạn chưa lưu ý tưởng nào từ cộng đồng.
          </p>
          <p className="text-xs text-slate-600">
            Hãy khám phá trang Cộng Đồng Sáng Tạo và bấm vào biểu tượng lưu để giữ lại những mẫu ưng ý!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {savedPosts.map((post) => (
            <div
              key={post.id}
              className="eco-card flex flex-col overflow-hidden group"
            >
              <div
                onClick={() => setSelectedPostId(post.id)}
                className="relative h-44 w-full bg-slate-100 overflow-hidden cursor-pointer"
              >
                <img
                  src={post.coverImage}
                  alt={post.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSaved(post.id);
                  }}
                  className="absolute top-3 right-3 p-2 rounded-xl bg-white/90 backdrop-blur-md text-rose-600 hover:bg-rose-50 shadow-xs transition"
                  title="Bỏ lưu khỏi danh sách"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                    {post.type === '100_percent_recycled' ? '🌿 100% Tái chế' : '✨ Có phụ liệu'}
                  </span>
                  <h3
                    onClick={() => setSelectedPostId(post.id)}
                    className="font-bold text-slate-900 text-base line-clamp-1 cursor-pointer hover:text-emerald-700"
                  >
                    {post.title}
                  </h3>
                  <p className="text-xs text-slate-600 line-clamp-2">{post.description}</p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-500">{post.estimatedTime}</span>
                  <button
                    onClick={() => setSelectedPostId(post.id)}
                    className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
                  >
                    <span>Xem chi tiết & 3D</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPost && (
        <CommunityDetailModal
          post={selectedPost}
          onClose={() => setSelectedPostId(null)}
          onToggleLike={onToggleLike}
          onToggleSave={onRemoveSaved}
          onAddComment={onAddComment}
          onOpenWorkshop={onStartCraft}
        />
      )}
    </div>
  );
};
