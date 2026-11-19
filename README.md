# Recycle Art Studio – Sáng Tạo Từ Rác Thải (AI 3D)

Ứng dụng web thông minh tích hợp trí tuệ nhân tạo (Google Gemini 3.8 & OpenAI ChatGPT-4o) và đồ họa 3D tương tác chân thực (Three.js WebGL) để quét rác thải, đo đạc kích thước thực tế và hướng dẫn chế tạo sản phẩm thủ công tái chế.

## 🚀 Hướng Dẫn Cài Đặt & Chạy Trực Tiếp

### Yêu Cầu Hệ Thống:
- **Node.js**: Phiên bản 18, 20 hoặc 22 trở lên.
- **npm** (hoặc yarn / pnpm).

### Các Bước Thực Hiện:
1. **Cài đặt thư viện phụ thuộc**:
   ```bash
   npm install
   ```

2. **Cấu hình API Key (Tùy chọn)**:
   Tạo file `.env` tại thư mục gốc (tham khảo `.env.example`):
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key_here
   OPENAI_API_KEY=your_openai_api_key_here
   ```

3. **Khởi chạy ứng dụng ở chế độ Phát triển (Development)**:
   ```bash
   npm run dev
   ```
   Mở trình duyệt truy cập: [http://localhost:3000](http://localhost:3000)

4. **Đóng gói & Chạy môi trường Sản xuất (Production)**:
   ```bash
   npm run build
   npm start
   ```

## 📁 Cấu Trúc Mã Nguồn

```text
├── index.html                   # HTML entry point (SEO, Viewport, WebGL canvas host)
├── package.json                 # Cấu hình dự án và danh sách dependencies
├── vite.config.ts               # Cấu hình Vite, Tailwind CSS v4, module alias
├── tsconfig.json                # Cấu hình TypeScript compiler
├── server.ts                    # Máy chủ Fullstack Express + Vite middleware (Port 3000)
├── server/
│   ├── apiRouter.ts             # RESTful API Endpoints (/api/status, /api/analyze-materials, ...)
│   ├── db.ts                    # Cơ sở dữ liệu mẫu (Kho vật liệu, Dự án, Ý tưởng tái chế)
│   └── gemini.ts                # Tích hợp Google Gemini & OpenAI ChatGPT phân tích đa góc nhìn
└── src/
    ├── main.tsx                 # React entry point
    ├── index.css                # Tailwind CSS v4 imports
    ├── App.tsx                  # Quản lý luồng giao diện chính & điều hướng các tab
    ├── components/              # Các thành phần giao diện (UI Components)
    │   ├── Navbar.tsx           # Thanh điều hướng trên cùng
    │   ├── HeroSection.tsx      # Banner giới thiệu & số liệu môi trường
    │   ├── MaterialCapture.tsx  # Giao diện camera quét ảnh linh hoạt & tùy chọn AI
    │   ├── ClassificationSafetyCard.tsx # Thẻ phân loại nhựa & cảnh báo an toàn
    │   ├── GeometryCalculatorCard.tsx   # Thẻ tính toán thể tích & hình học
    │   ├── CraftRecommendationList.tsx  # Danh sách ý tưởng sản phẩm tái chế
    │   ├── InteractiveCraftGuide.tsx    # Xưởng hướng dẫn 3D từng bước
    │   ├── MaterialInventory.tsx        # Quản lý kho vật liệu tái chế
    │   ├── MyProjectsView.tsx           # Quản lý dự án đang làm
    │   ├── CommunityView.tsx            # Mạng xã hội cộng đồng tái chế
    │   ├── SavedIdeasView.tsx           # Danh mục ý tưởng đã lưu
    │   └── UserProfileModal.tsx         # Hồ sơ người dùng & điểm thưởng xanh
    └── three/                   # Khối đồ họa 3D Three.js WebGL
        ├── CraftViewer3D.tsx    # Trình xem 3D sản phẩm, tách chi tiết lơ lửng, xoay 360°
        ├── MaterialScanner3D.tsx# Trình quét 3D vật liệu, thước kẹp Caliper, khung XYZ
        ├── photorealisticMaterials.ts # Vật liệu PBR chân thực (nhựa PET, HDPE, gỗ, keo...)
        └── photorealisticTextures.ts  # Kết cấu thủ công vi mô (vết nhám, bóng sàn, vân gỗ)
```
