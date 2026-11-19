import React from 'react';
import {
  Camera,
  Box,
  ShieldCheck,
  Sparkles,
  Hammer,
  ArrowRight,
  TrendingDown,
  Layers,
  Award,
  CheckCircle2,
  Share2,
  TreePine,
  Play
} from 'lucide-react';
import { CraftProduct } from '../../server/db';

interface HeroSectionProps {
  onStartScan: () => void;
  onExploreCommunity: () => void;
  onSelectFeaturedCraft: (craft: CraftProduct) => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onStartScan,
  onExploreCommunity,
  onSelectFeaturedCraft,
}) => {
  const workflowSteps = [
    {
      step: 1,
      title: 'Chụp ảnh đa góc độ',
      desc: 'Cung cấp 3–5 góc ảnh kèm thước đo tham chiếu',
      icon: Camera,
      color: 'bg-emerald-500 text-white',
    },
    {
      step: 2,
      title: 'AI nhận diện vật liệu',
      desc: 'Phát hiện chính xác nhựa PET, carton, lon nhôm...',
      icon: Box,
      color: 'bg-teal-500 text-white',
    },
    {
      step: 3,
      title: 'Phân loại rác thải',
      desc: 'Xếp vào 8 nhóm và đọc mã ký hiệu tái chế',
      icon: Layers,
      color: 'bg-blue-500 text-white',
    },
    {
      step: 4,
      title: 'Kiểm tra an toàn',
      desc: 'Đánh giá điều kiện vệ sinh, loại trừ rác độc hại',
      icon: ShieldCheck,
      color: 'bg-amber-500 text-white',
    },
    {
      step: 5,
      title: 'Đề xuất 2 nhóm sáng tạo',
      desc: 'Tận dụng 100% vật liệu có sẵn hoặc bổ sung phụ liệu',
      icon: Sparkles,
      color: 'bg-indigo-500 text-white',
    },
    {
      step: 6,
      title: 'Xưởng 3D chế tạo',
      desc: 'Mô hình 3D tương tác từng bước và chia sẻ cộng đồng',
      icon: Hammer,
      color: 'bg-emerald-600 text-white',
    },
  ];

  const featuredProjects: CraftProduct[] = [
    {
      id: 'featured_1',
      title: 'Chậu Cây Tự Hút Nước Thông Minh',
      description: 'Chỉ từ 1 chai nhựa PET 500ml và sợi cotton cũ, tạo nên hệ thống cấp ẩm tự động nuôi cây xanh tốt.',
      category: 'garden',
      categoryLabel: 'Làm vườn & Cây cảnh',
      type: '100_percent_recycled',
      imageUrl: '/assets/aistudio/image_9cb5bb6a.png',
      model3DType: 'planter',
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledMaterialRatio: 100,
      materialsUsed: [
        { name: 'Chai nhựa PET 500ml', fromCurrentInventory: true, role: 'Đế và phễu trồng' },
        { name: 'Nắp chai', fromCurrentInventory: true, role: 'Khóa bấc' }
      ],
      materialsNeededExtra: [],
      toolsRequired: ['Kéo thủ công', 'Dùi lỗ'],
      dimensionsFinished: { lengthCm: 6.5, widthCm: 6.5, heightCm: 14 },
      whySuitable: 'Nhựa PET kín nước tuyệt đối, không lo rò rỉ lên mặt bàn làm việc.',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt thân chai làm hai nửa',
          description: 'Cắt ngang thân chai cách miệng 9cm để làm phễu trên và đế chứa nước bên dưới.',
          materialsNeeded: ['Chai nhựa sạch'],
          toolsNeeded: ['Kéo sắc'],
          isCompleted: false,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Đục lỗ nắp và luồn bấc cotton',
          description: 'Khoét lỗ 4mm ở tâm nắp chai, luồn sợi dây cotton 15cm qua nắp.',
          materialsNeeded: ['Nắp chai', 'Dây bấc'],
          toolsNeeded: ['Dùi nhọn'],
          isCompleted: false,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 3,
          title: 'Lắp phễu ngược và cho nước',
          description: 'Úp ngược phần miệng chai vào đế, đổ nước ngập 1/2 sợi bấc.',
          materialsNeeded: [],
          toolsNeeded: [],
          isCompleted: false,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 4,
          title: 'Trồng cây sen đá / trầu bà',
          description: 'Cho đất dinh dưỡng vào phễu và trồng cây mầm.',
          materialsNeeded: ['Đất', 'Cây con'],
          toolsNeeded: [],
          isCompleted: false,
          highlightPart: 'body'
        }
      ]
    },
    {
      id: 'featured_2',
      title: 'Ngôi Nhà Tiết Kiệm Tiền Vintage Từ Bìa Carton',
      description: 'Thiết kế mái ngói gân sóng bóc tách độc đáo từ hộp giày cũ, có khe thả tiền tiết kiệm tiện lợi.',
      category: 'decor',
      categoryLabel: 'Đồ trang trí',
      type: '100_percent_recycled',
      imageUrl: '/assets/aistudio/image_7e7630d4.png',
      model3DType: 'cardboard_house',
      difficulty: 'Trung bình',
      estimatedTime: '40 phút',
      recycledMaterialRatio: 100,
      materialsUsed: [
        { name: 'Hộp carton cũ', fromCurrentInventory: true, role: 'Vách tường và mái nhà' }
      ],
      materialsNeededExtra: [],
      toolsRequired: ['Dao rọc giấy', 'Thước kim loại', 'Keo dán'],
      dimensionsFinished: { lengthCm: 18, widthCm: 14, heightCm: 16 },
      whySuitable: 'Bìa carton 3 lớp gân sóng cứng cáp, cách nhiệt và dễ định hình.',
      steps: [
        {
          stepNumber: 1,
          title: 'Vạch sơ đồ 4 vách tường & mái',
          description: 'Dùng bút chì vẽ kích thước tường cao 10cm và 2 đầu hồi tam giác.',
          materialsNeeded: ['Bìa carton'],
          toolsNeeded: ['Thước', 'Bút chì'],
          isCompleted: false,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Cắt tường và trổ cửa sổ',
          description: 'Rọc dao rọc giấy theo mép thước kẻ sắt cẩn thận.',
          materialsNeeded: [],
          toolsNeeded: ['Dao rọc giấy'],
          safetyWarning: 'Luôn giữ tay sau sống dao.',
          isCompleted: false,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Dán ráp thân nhà & lắp mái gân sóng',
          description: 'Bóc nhẹ 1 lớp vỏ giấy ngoài của mái để lộ gân sóng đẹp mắt.',
          materialsNeeded: ['Keo nến'],
          toolsNeeded: ['Súng bắn keo'],
          isCompleted: false,
          highlightPart: 'top'
        }
      ]
    },
    {
      id: 'featured_3',
      title: 'Đèn Bàn Chòm Sao Huyền Ảo Từ Lon Nhôm & Đèn LED',
      description: 'Đục lỗ hoa văn chòm sao phát quang bằng kỹ thuật đóng băng lon, kết hợp đèn LED 3V an toàn.',
      category: 'decor',
      categoryLabel: 'Đồ trang trí',
      type: 'with_added_materials',
      imageUrl: '/assets/aistudio/image_6a61808e.png',
      model3DType: 'tin_lamp',
      difficulty: 'Khó',
      estimatedTime: '45 phút',
      recycledMaterialRatio: 85,
      materialsUsed: [
        { name: 'Lon nhôm nước ngọt 330ml', fromCurrentInventory: true, role: 'Chao đèn kim loại đục lỗ' }
      ],
      materialsNeededExtra: [
        { name: 'Cụm đèn LED pin mini 3V', purpose: 'Nguồn sáng an toàn không sinh nhiệt', estimatedCostVnd: 15000, isEcoFriendly: true }
      ],
      toolsRequired: ['Đinh nhỏ', 'Búa nhẹ', 'Kính bảo hộ'],
      dimensionsFinished: { lengthCm: 6.6, widthCm: 6.6, heightCm: 12.5 },
      whySuitable: 'Kim loại nhôm phản xạ ánh sáng rất đẹp và dễ đục lỗ hoa văn.',
      steps: [
        {
          stepNumber: 1,
          title: 'Đông đá lon nhôm trước khi đục',
          description: 'Đổ nước đầy lon và cho vào ngăn đá để lon không bị móp khi gõ đinh.',
          materialsNeeded: ['Lon nhôm'],
          toolsNeeded: ['Tủ lạnh'],
          isCompleted: false,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Đục hoa văn theo nét vẽ',
          description: 'Dùng búa gõ nhẹ đinh theo hình chòm sao.',
          materialsNeeded: [],
          toolsNeeded: ['Búa', 'Đinh'],
          safetyWarning: 'Đeo kính bảo hộ và gõ lực vừa phải.',
          isCompleted: false,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Xả tan đá và gắn đèn LED',
          description: 'Làm tan đá, bọc mép viền lon và đặt đèn LED 3V vào đáy.',
          materialsNeeded: ['Đèn LED pin 3V'],
          toolsNeeded: [],
          isCompleted: false,
          highlightPart: 'assembly'
        }
      ]
    }
  ];

  return (
    <div className="space-y-12 py-2">
      {/* Hero Header Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0A5C36] via-[#059669] to-[#0284C7] text-white p-7 sm:p-11 lg:p-14 shadow-lg border border-emerald-400/30">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(74,222,128,0.22),transparent_60%)] pointer-events-none" />
        
        <div className="relative z-10 max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 text-[#4ADE80] text-xs font-semibold uppercase tracking-wider">
            <TreePine className="w-4 h-4 text-[#4ADE80]" />
            <span>Nền tảng Tái Chế Sáng Tạo Công Nghệ AI & 3D</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-[52px] font-black tracking-tight leading-tight">
            Biến rác thải thành{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4ADE80] via-emerald-200 to-sky-200">
              những điều tuyệt vời
            </span>
          </h1>

          <p className="text-emerald-50/90 text-base sm:text-lg leading-relaxed">
            Chỉ cần chụp ảnh rác thải xung quanh bạn từ nhiều góc độ. AI Vision sẽ nhận diện vật liệu, kiểm tra độ an toàn, đo đạc kích thước 3D và hướng dẫn bạn chế tạo những món đồ thủ công hữu ích, bảo vệ hành tinh xanh.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onStartScan}
              className="min-h-[44px] px-6 py-3.5 rounded-xl bg-white hover:bg-[#F0FDF4] text-[#0A5C36] font-extrabold shadow-lg flex items-center gap-2 transition hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <Camera className="w-5 h-5 text-[#059669]" />
              <span>Bắt đầu sáng tạo ngay</span>
              <ArrowRight className="w-4 h-4 ml-1 text-[#0284C7]" />
            </button>

            <button
              type="button"
              onClick={onExploreCommunity}
              className="min-h-[44px] px-6 py-3.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold border border-white/25 transition cursor-pointer"
            >
              Khám phá cộng đồng
            </button>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-white/20 text-center sm:text-left tabular-nums">
            <div>
              <p className="text-2xl sm:text-3xl font-extrabold text-[#4ADE80]">100%</p>
              <p className="text-xs text-emerald-50/90">Ưu tiên rác tái chế sẵn có</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl font-extrabold text-white">8 Nhóm</p>
              <p className="text-xs text-emerald-50/90">Phân loại rác tự động</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl font-extrabold text-sky-200">3D Step</p>
              <p className="text-xs text-emerald-50/90">Xưởng mô phỏng tương tác</p>
            </div>
          </div>
        </div>
      </section>

      {/* 6-Step Workflow Process */}
      <section className="space-y-6">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <span className="text-xs font-bold text-[#059669] uppercase tracking-widest">
            Quy trình thông minh
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#0A5C36] tracking-tight">
            Cách Recycle Art Studio hoạt động
          </h2>
          <p className="text-slate-600 text-sm">
            Quy trình 6 bước khép kín từ hình ảnh thực tế đến sản phẩm thủ công hoàn thiện
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflowSteps.map((item) => {
            const IconComp = item.icon;
            return (
              <div
                key={item.step}
                className="eco-card p-5 group"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 shadow-sm ${item.color}`}
                  >
                    <IconComp className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-[#0A5C36] bg-[#F0FDF4] border border-emerald-200/70 px-2 py-0.5 rounded-md">
                        BƯỚC {item.step}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm group-hover:text-[#0A5C36] transition">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Featured Recycled Products Showcase */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs font-bold text-[#0284C7] uppercase tracking-widest">
              Sáng tạo tiêu biểu
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0A5C36] tracking-tight">
              Sản phẩm tái chế nổi bật
            </h2>
            <p className="text-slate-600 text-sm">
              Mô hình thủ công đã qua kiểm nghiệm độ an toàn và tối ưu kích thước 3D
            </p>
          </div>

          <button
            type="button"
            onClick={onStartScan}
            className="min-h-[44px] text-xs font-bold text-[#0284C7] hover:text-[#0A5C36] flex items-center gap-1 transition cursor-pointer"
          >
            <span>Tự quét vật liệu của bạn</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredProjects.map((craft) => (
            <div
              key={craft.id}
              className="eco-card flex flex-col overflow-hidden group"
            >
              <div className="relative h-48 w-full overflow-hidden bg-slate-100">
                <img
                  src={craft.imageUrl}
                  alt={craft.title}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                />
                <div className="absolute top-3 left-3 flex flex-col gap-1">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shadow-xs ${
                      craft.type === '100_percent_recycled'
                        ? 'bg-[#059669] text-white'
                        : 'bg-[#0284C7] text-white'
                    }`}
                  >
                    {craft.type === '100_percent_recycled'
                      ? '100% Tái chế'
                      : 'Có phụ liệu an toàn'}
                  </span>
                </div>
                <div className="absolute bottom-3 right-3 bg-slate-900/85 text-white text-[10px] px-2.5 py-1 rounded-md font-medium tabular-nums">
                  {craft.estimatedTime} • Độ khó: {craft.difficulty}
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase">
                    {craft.categoryLabel}
                  </span>
                  <h3 className="font-bold text-slate-900 text-base group-hover:text-[#0A5C36] transition line-clamp-1">
                    {craft.title}
                  </h3>
                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {craft.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-emerald-100 flex items-center justify-between">
                  <div className="text-[11px] text-slate-600 tabular-nums">
                    <span className="font-bold text-[#0A5C36]">{craft.steps.length} bước</span> hướng dẫn 3D
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectFeaturedCraft(craft)}
                    className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#F0FDF4] hover:bg-emerald-100 border border-emerald-200/70 text-[#0A5C36] text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 text-[#059669] fill-[#059669]" />
                    <span>Xem xưởng 3D</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* STEM and Environmental Commitments */}
      <section className="rounded-2xl bg-[#F0FDF4] border border-emerald-200/80 p-7 sm:p-9 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="flex items-center gap-2 text-[#0A5C36] font-bold text-xs uppercase tracking-wider">
            <Award className="w-4 h-4 text-[#10B981]" />
            <span>Cam kết giáo dục STEM & An toàn môi trường</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-[#0A5C36]">
            Học tập qua thực hành, giảm thiểu rác thải bãi chôn lấp
          </h3>
          <p className="text-slate-600 text-sm leading-relaxed">
            Mỗi thao tác cắt ghép đều được hướng dẫn an toàn, cảnh báo nguy cơ và gợi ý biện pháp bảo hộ cho học sinh và người mới bắt đầu. Hãy cùng biến những vỏ chai, hộp giấy thành tác phẩm nghệ thuật!
          </p>
        </div>

        <button
          type="button"
          onClick={onStartScan}
          className="min-h-[44px] px-6 py-3 rounded-xl eco-btn-primary font-bold text-sm whitespace-nowrap cursor-pointer"
        >
          Tải ảnh vật liệu ngay
        </button>
      </section>
    </div>
  );
};
