import React, { useState, useEffect } from 'react';
import {
  X,
  Heart,
  Bookmark,
  Share2,
  Clock,
  Layers,
  Wrench,
  Send,
  MessageSquare,
  CheckCircle,
  Copy,
  Check,
  AlertTriangle,
  ImageOff,
  Camera,
  PlusCircle,
  Sparkles,
  Hammer
} from 'lucide-react';
import { CommunityPost, CraftProduct } from '../../server/db';
import { CraftViewer3D } from '../three/CraftViewer3D';

interface CommunityDetailModalProps {
  post: CommunityPost;
  onClose: () => void;
  onToggleLike: (postId: string) => void;
  onToggleSave: (postId: string) => void;
  onAddComment: (postId: string, text: string) => void;
  onOpenWorkshop?: (craft: CraftProduct) => void;
}

export const CommunityDetailModal: React.FC<CommunityDetailModalProps> = ({
  post,
  onClose,
  onToggleLike,
  onToggleSave,
  onAddComment,
  onOpenWorkshop,
}) => {
  const [commentText, setCommentText] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [showContributeForm, setShowContributeForm] = useState(false);
  const [contributionStep, setContributionStep] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const isPendingGuide = post.guideStatus === 'pending' || !post.steps || post.steps.length === 0;
  const isPendingImage = post.imageStatus === 'pending' || !post.coverImage || post.coverImage.trim() === '';

  const handleSendComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    onAddComment(post.id, commentText);
    setCommentText('');
  };

  const handleSendContribution = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributionStep.trim()) return;
    onAddComment(post.id, `[Đóng góp cách làm]: ${contributionStep}`);
    setContributionStep('');
    setShowContributeForm(false);
  };

  const handleCopyLink = () => {
    const url = window.location.origin + `?idea=${post.id}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const craftDataFor3D: CraftProduct = {
    id: post.id,
    title: post.title,
    type: post.type,
    recycledMaterialRatio: post.recycledRatio ?? 100,
    category: 'decor',
    categoryLabel: 'Trang trí & Nghệ thuật',
    difficulty: post.difficulty || 'Dễ',
    estimatedTime: post.estimatedTime || '30 phút',
    description: post.description,
    whySuitable: post.materialsSourceDescription || post.description,
    materialsUsed: (post.materialsSummary || []).map((name, idx) => ({
      name,
      fromCurrentInventory: idx === 0,
      role: idx === 0 ? 'Vật liệu chính' : 'Vật liệu phụ trợ',
    })),
    materialsNeededExtra: [],
    toolsRequired: post.toolsSummary || ['Kéo', 'Keo dán'],
    dimensionsFinished: { lengthCm: 15, widthCm: 12, heightCm: 18 },
    imageUrl: post.coverImage || '/assets/aistudio/image_9cb5bb6a.png',
    model3DType: post.model3DType || 'pen_holder',
    steps:
      post.steps && post.steps.length > 0
        ? post.steps
        : [
            {
              stepNumber: 1,
              title: 'Mô hình ý tưởng 3D',
              description: 'Đang chờ cập nhật quy trình chế tác chi tiết.',
              materialsNeeded: post.materialsSummary,
              toolsNeeded: post.toolsSummary,
              highlightPart: 'body',
            },
          ],
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={post.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 flex items-center justify-center p-3 sm:p-6"
    >
      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border border-slate-200">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <img
              src={post.authorAvatar}
              alt={post.authorName}
              referrerPolicy="no-referrer"
              className="w-10 h-10 rounded-full object-cover ring-2 ring-emerald-500/20"
            />
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{post.authorName}</h3>
              <p className="text-[11px] text-slate-500 tabular-nums">Đăng ngày: {post.createdAt}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenWorkshop && (
              <button
                type="button"
                onClick={() => {
                  onOpenWorkshop(craftDataFor3D);
                  onClose();
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              >
                <Hammer className="w-3.5 h-3.5" />
                <span>Mở xưởng 3D</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyLink}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              title="Sao chép liên kết chia sẻ"
            >
              {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{copiedLink ? 'Đã sao chép' : 'Chia sẻ'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng chi tiết bài viết"
              className="min-w-[44px] min-h-[44px] p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition cursor-pointer"
              title="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Post Title & Badges */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                {post.type === '100_percent_recycled' ? '🌿 100% Rác tái chế' : '✨ Có phụ liệu an toàn'}
              </span>

              {isPendingGuide && (
                <span className="text-xs font-black text-amber-900 bg-amber-100 border border-amber-300 px-3 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Chưa cập nhật cách làm</span>
                </span>
              )}

              {isPendingImage && (
                <span className="text-xs font-black text-purple-900 bg-purple-100 border border-purple-300 px-3 py-0.5 rounded-full flex items-center gap-1">
                  <ImageOff className="w-3.5 h-3.5 text-purple-600" />
                  <span>Chưa cập nhật hình ảnh</span>
                </span>
              )}

              <span className="text-xs text-slate-500">• Độ khó: {post.difficulty}</span>
              <span className="text-xs text-slate-500">• {post.estimatedTime}</span>
            </div>

            <h2 className="text-2xl font-black text-slate-900">{post.title}</h2>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{post.description}</p>
          </div>

          {/* Pending Banner Notices */}
          {isPendingGuide && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <h4 className="font-extrabold text-amber-950 text-sm">
                  Mục này hiện đang ở trạng thái: Chưa cập nhật cách làm
                </h4>
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                Ý tưởng và hình ảnh đã được cộng đồng ghi nhận, tuy nhiên các bước chế tạo chi tiết chưa được cập nhật. Bạn đã từng làm sản phẩm tương tự? Hãy cùng đóng góp cách làm để giúp các bạn khác dễ dàng thực hiện nhé!
              </p>
              <button
                onClick={() => setShowContributeForm(!showContributeForm)}
                className="mt-1 px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>{showContributeForm ? 'Đóng form đóng góp' : 'Đóng góp cách làm cho mục này'}</span>
              </button>

              {showContributeForm && (
                <form onSubmit={handleSendContribution} className="pt-2 space-y-2">
                  <textarea
                    rows={3}
                    required
                    defaultValue={contributionStep}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${Math.max(100, el.scrollHeight)}px`;
                      setContributionStep(el.value);
                    }}
                    onBlur={(e) => setContributionStep(e.currentTarget.value)}
                    enterKeyHint="enter"
                    inputMode="text"
                    placeholder="Mô tả các bước thực hiện, mẹo vặt hoặc dụng cụ cần dùng..."
                    className="w-full min-h-[100px] p-3 rounded-xl border border-amber-300 bg-white text-base sm:text-xs leading-relaxed resize-y focus:ring-2 focus:ring-amber-500 touch-auto select-text whitespace-pre-wrap"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Gửi đóng góp cách làm</span>
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Interactive 3D Model Section */}
          <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-2 shadow-xs">
            <div className="text-xs font-bold text-slate-700 px-3 py-1 flex items-center justify-between">
              <span>Mô hình 3D sản phẩm tương tác</span>
              <span className="text-emerald-700">{post.dimensions}</span>
            </div>
            <CraftViewer3D
              craft={craftDataFor3D}
              currentStepIndex={activeStepIdx}
              onStepChange={setActiveStepIdx}
              height="380px"
            />
          </div>

          {/* Materials & Tools Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-100 space-y-1.5">
              <span className="font-bold text-emerald-900 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-emerald-700" />
                <span>Vật liệu sử dụng:</span>
              </span>
              <p className="text-slate-600 italic">{post.materialsSourceDescription}</p>
              <ul className="space-y-1 pt-1">
                {post.materialsSummary.map((m, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-slate-700">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-slate-600" />
                <span>Dụng cụ & Lưu ý:</span>
              </span>
              <ul className="space-y-1 pt-1">
                {post.toolsSummary.map((t, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              {post.tipsAndLearnings && post.tipsAndLearnings.length > 0 && (
                <div className="pt-2 border-t border-slate-200">
                  <span className="font-bold text-slate-700">Ghi chú & Kinh nghiệm:</span>
                  <p className="text-slate-600 italic mt-0.5">{post.tipsAndLearnings[0]}</p>
                </div>
              )}
            </div>
          </div>

          {/* Steps List */}
          {post.steps && post.steps.length > 0 ? (
            <div className="space-y-3">
              <h4 className="font-bold text-slate-900 text-sm">
                Các bước thực hiện chi tiết ({post.steps.length} bước)
              </h4>
              <div className="space-y-2">
                {post.steps.map((step, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-2xl bg-white border border-slate-200 text-xs space-y-1 hover:border-emerald-300 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-emerald-800">
                        Bước {step.stepNumber}: {step.title}
                      </span>
                    </div>
                    <p className="text-slate-600">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-amber-50/50 border border-amber-200 text-center space-y-2">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="font-bold text-amber-900 text-xs">
                Chưa có danh sách các bước thực hiện chi tiết cho sản phẩm này.
              </p>
              <p className="text-[11px] text-amber-700 max-w-md mx-auto">
                Bạn có thể gửi bình luận hoặc bấm "Đóng góp cách làm" để chia sẻ cách làm của mình nhé!
              </p>
            </div>
          )}

          {/* Social Interactions: Like, Save, Comments */}
          <div className="pt-4 border-t border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onToggleLike(post.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                    (post as any).isLiked
                      ? 'bg-rose-50 text-rose-600 border border-rose-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${(post as any).isLiked ? 'fill-rose-500 text-rose-500' : ''}`} />
                  <span>{post.likesCount} Yêu thích</span>
                </button>

                <button
                  onClick={() => onToggleSave(post.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                    (post as any).isSaved
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  <Bookmark className={`w-4 h-4 ${(post as any).isSaved ? 'fill-emerald-600 text-emerald-600' : ''}`} />
                  <span>{(post as any).isSaved ? 'Đã lưu' : 'Lưu ý tưởng'}</span>
                </button>
              </div>

              <span className="text-xs text-slate-500 font-medium">
                {post.commentsCount ?? post.comments.length} bình luận & đóng góp
              </span>
            </div>

            {/* Comment Input */}
            <form onSubmit={handleSendComment} className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Viết cảm nghĩ, hỏi kinh nghiệm hoặc chia sẻ mẹo chế tạo..."
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-base sm:text-xs bg-slate-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 touch-auto select-text"
              />
              <button
                type="submit"
                disabled={!commentText.trim()}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 transition"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Gửi</span>
              </button>
            </form>

            {/* Comments List */}
            <div className="space-y-3 pt-2">
              {post.comments.map((c) => (
                <div key={c.id} className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 text-xs">
                  <img
                    src={c.userAvatar}
                    alt={c.userName}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full object-cover shrink-0"
                  />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{c.userName}</span>
                      <span className="text-[10px] text-slate-400">{c.createdAt}</span>
                    </div>
                    <p className="text-slate-700">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
