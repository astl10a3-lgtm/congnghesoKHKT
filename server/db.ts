import fs from 'fs';
import path from 'path';
import type { ReconstructionResult } from '../src/types/reconstruction.ts';
import { encryptPassword } from './cryptoVault.ts';

import type {
  CraftPreparationSpec,
  ExpectedResultSpec,
  FinalInspectionItem,
} from '../src/types/recycling.ts';

export interface MaterialItem {
  id: string;
  name: string;
  category: 'plastic' | 'paper' | 'metal' | 'glass' | 'fabric' | 'organic' | 'electronic' | 'other';
  categoryLabel: string;
  recycleCode?: string; // e.g. PET 1, HDPE 2, PP 5
  images: string[]; // URLs or base64
  status: 'safe_to_use' | 'needs_cleaning' | 'needs_special_handling' | 'not_recommended';
  statusLabel: string;
  condition: string; // e.g. "Còn nguyên vẹn, hơi dính bụi"
  color: string;
  quantity: number;
  unit: string;
  dimensions: {
    shapeType: 'cylinder' | 'box' | 'sphere' | 'cone' | 'irregular';
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    diameterCm?: number;
    volumeMl?: number;
    usableSurfaceCm2: number;
    totalSurfaceCm2: number;
    usableRatioPercent: number;
  };
  cleaningInstructions: string[];
  safetyWarnings: string[];
  guideStatus?: 'completed' | 'pending';
  imageStatus?: 'completed' | 'pending';
  dateAdded: string;
  reconstruction?: ReconstructionResult;
}

export interface CraftStep {
  stepNumber: number;
  title: string;
  description: string;
  materialsNeeded: string[];
  toolsNeeded: string[];
  dimensionsNotice?: string;
  safetyWarning?: string;
  needsAdultSupervision?: boolean;
  isCompleted?: boolean;
  highlightPart?: string; // 3D highlight target e.g. 'body', 'bottom', 'top', 'cut_line', 'assembly'
}

export interface CraftProduct {
  id: string;
  title: string;
  description: string;
  category: 'decor' | 'study' | 'home' | 'stem_toy' | 'gift' | 'garden' | 'art';
  categoryLabel: string;
  type: '100_percent_recycled' | 'with_added_materials';
  imageUrl: string;
  model3DType: 'bottle_pot' | 'planter' | 'pen_holder' | 'box_organizer' | 'desk_organizer' | 'lantern_lamp' | 'tin_lamp' | 'bird_feeder' | 'cardboard_house' | 'plastic_planter' | 'toy_car' | 'bottle_rocket' | 'bottle_piggy_bank' | 'fabric_tote' | 'cap_mosaic' | string;
  difficulty: 'Dễ' | 'Trung bình' | 'Khó';
  estimatedTime: string; // e.g. "30 phút"
  recycledMaterialRatio: number; // percentage e.g. 100 or 80
  materialsUsed: {
    name: string;
    fromCurrentInventory: boolean;
    role: string;
  }[];
  materialsNeededExtra: {
    name: string;
    purpose: string;
    estimatedCostVnd: number;
    isEcoFriendly: boolean;
  }[];
  toolsRequired: string[];
  dimensionsFinished: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  whySuitable: string;
  suitabilityLabel?: string;
  safetyNotes?: string[];
  adultSupervisionRequired?: boolean;
  preparation?: CraftPreparationSpec;
  expectedResult?: ExpectedResultSpec;
  finalInspection?: FinalInspectionItem[];
  isConceptual3DPreview?: boolean;
  guideStatus?: 'completed' | 'pending';
  imageStatus?: 'completed' | 'pending';
  steps: CraftStep[];
}

export interface UserProject {
  id: string;
  userId: string;
  title: string;
  description: string;
  status: 'idea' | 'in_progress' | 'completed';
  progressPercent: number;
  currentStepIndex: number;
  coverImage: string;
  model3DType: string;
  craftData: CraftProduct;
  inputMaterials: MaterialItem[];
  finishedPhotos: string[];
  userNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityComment {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  text: string;
  createdAt: string;
  likes: number;
}

export interface CommunityPost {
  id: string;
  projectId?: string;
  title: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  description: string;
  coverImage: string;
  additionalImages: string[];
  model3DType: string;
  materialsSourceDescription: string;
  materialsSummary: string[];
  toolsSummary: string[];
  difficulty: 'Dễ' | 'Trung bình' | 'Khó';
  estimatedTime: string;
  recycledRatio: number;
  type: '100_percent_recycled' | 'with_added_materials';
  dimensions: string;
  steps: CraftStep[];
  tipsAndLearnings: string[];
  likesCount: number;
  commentsCount: number;
  comments: CommunityComment[];
  visibility: 'public' | 'unlisted' | 'private';
  guideStatus?: 'completed' | 'pending'; // 'pending' = Chưa cập nhật cách làm
  imageStatus?: 'completed' | 'pending'; // 'pending' = Chưa cập nhật hình ảnh
  createdAt: string;
}

export type AccountRole = 'admin' | 'member';
export type AccountStatus = 'active' | 'locked';

export type AdminAuditAction =
  | 'create_account'
  | 'change_password'
  | 'view_passwords'
  | 'update_role'
  | 'toggle_status'
  | 'update_profile'
  | 'delete_account';

export interface AdminAuditLog {
  id: string;
  adminId: string;
  adminUsername: string;
  action: AdminAuditAction;
  targetAccountId?: string;
  targetUsername?: string;
  detail: string;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  username: string;
  name: string;
  avatar: string;
  bio: string;
  role: AccountRole;
  status: AccountStatus;
  passwordEncrypted?: string;
  passwordUpdatedAt?: string;
  lastLoginAt?: string;
  joinedDate: string;
  totalCraftsMade: number;
  savedWasteKg: number;
  totalLikesReceived: number;
}

export type PublicUserProfile = Omit<UserProfile, 'passwordEncrypted'>;

export function toPublicUser(user: UserProfile): PublicUserProfile {
  const { passwordEncrypted: _omit, ...rest } = user;
  return rest;
}

interface DatabaseSchema {
  users: UserProfile[];
  adminAuditLogs: AdminAuditLog[];
  materials: MaterialItem[];
  projects: UserProject[];
  communityPosts: CommunityPost[];
  userLikes: Record<string, string[]>;
  savedProjects: Record<string, string[]>;
}

const isVercel = Boolean(process.env.VERCEL);
const DB_FILE = isVercel
  ? path.resolve('/tmp', 'recycle_studio_db.json')
  : path.resolve(process.cwd(), 'data', 'recycle_studio_db.json');

// Ensure data folder and file exists, with automatic schema version sync
function ensureDb(): DatabaseSchema {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const initialData = getInitialSeedData();

  if (!fs.existsSync(DB_FILE)) {
    // If on Vercel, try to load pre-bundled seed from repo data/ if available
    const bundledPath = path.resolve(process.cwd(), 'data', 'recycle_studio_db.json');
    if (isVercel && fs.existsSync(bundledPath)) {
      try {
        const bundledContent = fs.readFileSync(bundledPath, 'utf-8');
        fs.writeFileSync(DB_FILE, bundledContent, 'utf-8');
        return JSON.parse(bundledContent);
      } catch (e) {
        console.warn('Failed to copy bundled db to /tmp, using seed:', e);
      }
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }

  try {
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed: DatabaseSchema = JSON.parse(content);
    let changed = false;

    // Seamlessly ensure all flagship 3D models and seed posts exist
    const existingPostIds = new Set(parsed.communityPosts?.map(p => p.id) || []);
    const missingPosts = initialData.communityPosts.filter(p => !existingPostIds.has(p.id));
    if (missingPosts.length > 0) {
      console.log(`Adding ${missingPosts.length} new/flagship posts to communityPosts database...`);
      parsed.communityPosts = [...missingPosts, ...(parsed.communityPosts || [])];
      changed = true;
    }

    // Seamlessly ensure all initial materials exist
    const existingMatIds = new Set(parsed.materials?.map(m => m.id) || []);
    const missingMats = initialData.materials.filter(m => !existingMatIds.has(m.id));
    if (missingMats.length > 0) {
      console.log(`Adding ${missingMats.length} newly added materials to database...`);
      parsed.materials = [...(parsed.materials || []), ...missingMats];
      changed = true;
    }

    if (!parsed.users || parsed.users.length === 0) {
      parsed.users = initialData.users;
      changed = true;
    }

    // Normalize legacy user profiles with username, role, status & encrypted credential
    parsed.users = parsed.users.map((u, idx) => {
      const next: UserProfile = {
        ...u,
        username:
          typeof u.username === 'string' && u.username.trim()
            ? u.username.trim().toLowerCase()
            : u.id === 'user_default'
            ? 'sangtaoxanh'
            : `user_${idx + 1}`,
        role: u.role === 'admin' ? 'admin' : 'member',
        status: u.status === 'locked' ? 'locked' : 'active',
        passwordEncrypted:
          typeof u.passwordEncrypted === 'string' && u.passwordEncrypted.startsWith('v1:')
            ? u.passwordEncrypted
            : encryptPassword(u.username === 'adminkhkt' ? 'khkt123' : '123456'),
        passwordUpdatedAt: u.passwordUpdatedAt || new Date().toISOString(),
      };
      if (
        next.username !== u.username ||
        next.role !== u.role ||
        next.status !== u.status ||
        next.passwordEncrypted !== u.passwordEncrypted
      ) {
        changed = true;
      }
      return next;
    });

    // Guarantee primary adminkhkt account exists in database
    const hasAdminKhkt = parsed.users.some(
      (u) => (u.username || '').toLowerCase() === 'adminkhkt'
    );
    if (!hasAdminKhkt) {
      const seedAdmin = initialData.users.find((u) => u.username === 'adminkhkt');
      if (seedAdmin) {
        parsed.users.push(seedAdmin);
        changed = true;
      }
    }

    if (!Array.isArray(parsed.adminAuditLogs)) {
      parsed.adminAuditLogs = [];
      changed = true;
    }
    if (!parsed.projects || parsed.projects.length === 0) {
      parsed.projects = initialData.projects;
      changed = true;
    }
    if (!parsed.userLikes) {
      parsed.userLikes = initialData.userLikes;
      changed = true;
    }
    if (!parsed.savedProjects) {
      parsed.savedProjects = initialData.savedProjects;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
    }
    return parsed;
  } catch (err) {
    console.error('Error reading DB file, recreating with seed:', err);
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
    return initialData;
  }
}

function saveDb(data: DatabaseSchema) {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, DB_FILE);
}

export const db = {
  get(): DatabaseSchema {
    return ensureDb();
  },

  update(updater: (data: DatabaseSchema) => void) {
    const current = ensureDb();
    updater(current);
    saveDb(current);
    return current;
  }
};

export function getInitialSeedData(): DatabaseSchema {
  const nowIso = new Date().toISOString();
  const defaultUser: UserProfile = {
    id: 'user_default',
    username: 'sangtaoxanh',
    name: 'Sáng Tạo Xanh (Bạn)',
    avatar: '/assets/aistudio/image_9cb5bb6a.png',
    bio: 'Yêu thích tái chế sáng tạo, bảo vệ môi trường và lan tỏa lối sống bền vững tới cộng đồng học sinh, sinh viên.',
    role: 'member',
    status: 'active',
    passwordEncrypted: encryptPassword('123456'),
    passwordUpdatedAt: nowIso,
    joinedDate: '2026-10-15',
    totalCraftsMade: 14,
    savedWasteKg: 11.2,
    totalLikesReceived: 124,
  };

  const adminUser: UserProfile = {
    id: 'user_admin_khkt',
    username: 'adminkhkt',
    name: 'Quản trị viên KHKT',
    avatar: '/assets/aistudio/image_ee902c1a.png',
    bio: 'Tài khoản quản trị hệ thống Recycle Art Studio — quản lý tài khoản, mật khẩu và đồng bộ dữ liệu hệ thống.',
    role: 'admin',
    status: 'active',
    passwordEncrypted: encryptPassword('khkt123'),
    passwordUpdatedAt: nowIso,
    joinedDate: '2026-11-17',
    totalCraftsMade: 0,
    savedWasteKg: 0,
    totalLikesReceived: 0,
  };

  const initialMaterials: MaterialItem[] = [
    {
      id: 'mat_1',
      name: 'Vỏ chai nhựa nước ngọt / nước suối PET 500ml',
      category: 'plastic',
      categoryLabel: 'Rác thải nhựa',
      recycleCode: 'PET / PETE (Số 1)',
      images: [
        '/assets/aistudio/image_9cb5bb6a.png',
        '/assets/aistudio/image_68495993.png'
      ],
      status: 'needs_cleaning',
      statusLabel: 'Cần làm sạch',
      condition: 'Vỏ chai còn nguyên vẹn, còn nhãn nilon, cần rửa sạch bên trong và tháo nhãn.',
      color: 'Trong suốt có nắp màu',
      quantity: 5,
      unit: 'chai',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 21,
        widthCm: 6.5,
        heightCm: 21,
        diameterCm: 6.5,
        volumeMl: 500,
        usableSurfaceCm2: 380,
        totalSurfaceCm2: 440,
        usableRatioPercent: 86
      },
      cleaningInstructions: [
        'Ngâm nước ấm 5 phút để bóc sạch tem nhãn keo dính.',
        'Súc sạch bên trong chai bằng nước xà phòng loãng.',
        'Dốc ngược và để khô ráo hoàn toàn trước khi cắt.'
      ],
      safetyWarnings: [
        'Cẩn thận khi dùng dao rọc giấy cắt thân chai tròn.',
        'Dùng băng dính màu hoặc mài nhẹ viền cắt để không làm xước tay.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-01'
    },
    {
      id: 'mat_2',
      name: 'Nắp chai nhựa nhiều màu sắc',
      category: 'plastic',
      categoryLabel: 'Rác thải nhựa',
      recycleCode: 'HDPE (Số 2) & PP (Số 5)',
      images: [
        '/assets/aistudio/image_1d3b0c72.png'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Nắp nhựa sạch, màu sắc đa dạng (đỏ, xanh, vàng, trắng), không bị nứt vỡ.',
      color: 'Nhiều màu (đỏ, xanh dương, vàng, trắng)',
      quantity: 24,
      unit: 'nắp',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 3.2,
        widthCm: 3.2,
        heightCm: 1.4,
        diameterCm: 3.2,
        volumeMl: 10,
        usableSurfaceCm2: 25,
        totalSurfaceCm2: 28,
        usableRatioPercent: 95
      },
      cleaningInstructions: [
        'Ngâm nước xà phòng ấm 3 phút để tẩy sạch cặn đồ uống.',
        'Phơi trên khăn sạch cho ráo nước.'
      ],
      safetyWarnings: [
        'Tránh để trẻ nhỏ dưới 3 tuổi ngậm hoặc nuốt phải nắp chai.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-02'
    },
    {
      id: 'mat_3',
      name: 'Quần jean denim cũ sờn rách',
      category: 'fabric',
      categoryLabel: 'Vải & Dệt may',
      recycleCode: 'Cotton Denim',
      images: [
        '/assets/aistudio/image_6a61808e.png',
        '/assets/aistudio/image_db28e61c.png'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Vải denim đã giặt sạch, chất vải dày dặn và dẻo dai, giữ form tốt.',
      color: 'Xanh chàm Indigo và xanh nhạt',
      quantity: 2,
      unit: 'chiếc',
      dimensions: {
        shapeType: 'irregular',
        lengthCm: 95,
        widthCm: 45,
        heightCm: 2,
        usableSurfaceCm2: 4200,
        totalSurfaceCm2: 4800,
        usableRatioPercent: 88
      },
      cleaningInstructions: [
        'Giặt sạch bằng bột giặt và phơi nắng khô thơm tho.',
        'Là ủi phẳng để dễ đo và cắt rập.'
      ],
      safetyWarnings: [
        'Vải denim khá dày, nên sử dụng kéo cắt vải chuyên dụng và kim khâu số lớn.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-03'
    },
    {
      id: 'mat_4',
      name: 'Ống hút nhựa nhiều màu thu gom',
      category: 'plastic',
      categoryLabel: 'Rác thải nhựa',
      recycleCode: 'PP (Số 5)',
      images: [
        '/assets/aistudio/image_0b1528c7.png'
      ],
      status: 'needs_cleaning',
      statusLabel: 'Cần làm sạch',
      condition: 'Ống hút thẳng và ống hút gập, còn nguyên vẹn, cần rửa sạch cặn bên trong.',
      color: 'Xanh lá, cam, vàng, đỏ',
      quantity: 35,
      unit: 'chiếc',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 21,
        widthCm: 0.6,
        heightCm: 21,
        diameterCm: 0.6,
        volumeMl: 6,
        usableSurfaceCm2: 40,
        totalSurfaceCm2: 42,
        usableRatioPercent: 90
      },
      cleaningInstructions: [
        'Xả nước ấm qua lòng ống hút để rửa sạch sữa hoặc nước ngọt.',
        'Dốc đứng để ráo nước trước khi cắt dán.'
      ],
      safetyWarnings: [
        'Không để gần nguồn lửa hoặc đồ vật nóng vì nhựa PP dễ biến dạng.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-03'
    },
    {
      id: 'mat_5',
      name: 'Bình nhựa 5L dung tích lớn',
      category: 'plastic',
      categoryLabel: 'Rác thải nhựa',
      recycleCode: 'PET / HDPE',
      images: [
        '/assets/aistudio/image_d0029fe5.png'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Bình nhựa trắng trong, có quai xách chắc chắn, đáy rộng phẳng.',
      color: 'Trong suốt',
      quantity: 1,
      unit: 'bình',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 34,
        widthCm: 16,
        heightCm: 34,
        diameterCm: 16,
        volumeMl: 5000,
        usableSurfaceCm2: 1750,
        totalSurfaceCm2: 2100,
        usableRatioPercent: 83
      },
      cleaningInstructions: [
        'Súc sạch bằng nước ấm, lau khô bề mặt ngoài.'
      ],
      safetyWarnings: [
        'Dùng dao rọc giấy cẩn thận vì vỏ bình 5L khá dày.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-04'
    },
    {
      id: 'mat_6',
      name: 'Thùng carton đựng hàng bưu điện sóng 3 lớp',
      category: 'paper',
      categoryLabel: 'Rác thải giấy',
      recycleCode: 'PAP (Số 20)',
      images: [
        '/assets/aistudio/image_7e7630d4.png'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Bìa carton cứng cáp, khô ráo, không bị ẩm mốc hay dính dầu mỡ thực phẩm.',
      color: 'Nâu Kraft',
      quantity: 3,
      unit: 'thùng',
      dimensions: {
        shapeType: 'box',
        lengthCm: 40,
        widthCm: 30,
        heightCm: 25,
        volumeMl: 30000,
        usableSurfaceCm2: 5200,
        totalSurfaceCm2: 5900,
        usableRatioPercent: 88
      },
      cleaningInstructions: [
        'Dùng khăn khô lau sạch bụi bẩn bên ngoài.',
        'Lột bỏ băng dính bưu điện cũ.'
      ],
      safetyWarnings: [
        'Dùng thước kim loại làm cữ tì khi rọc bìa để tránh trượt dao.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-04'
    },
    {
      id: 'mat_7',
      name: 'Muỗng thìa nhựa dùng một lần',
      category: 'plastic',
      categoryLabel: 'Rác thải nhựa',
      recycleCode: 'PS (Số 6)',
      images: [
        '/assets/aistudio/image_d0029fe5.png'
      ],
      status: 'needs_cleaning',
      statusLabel: 'Cần làm sạch',
      condition: 'Thìa trắng còn nguyên, sạch sau khi rửa, dáng bầu cong đồng đều.',
      color: 'Trắng sứ',
      quantity: 40,
      unit: 'chiếc',
      dimensions: {
        shapeType: 'irregular',
        lengthCm: 14,
        widthCm: 3.2,
        heightCm: 1.2,
        usableSurfaceCm2: 35,
        totalSurfaceCm2: 40,
        usableRatioPercent: 85
      },
      cleaningInstructions: [
        'Rửa sạch bằng nước rửa chén và phơi khô.'
      ],
      safetyWarnings: [
        'Nhựa PS khá giòn khi bẻ, nên dùng kìm bấm hoặc kéo sắc cắt cán thìa.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-05'
    },
    {
      id: 'mat_8',
      name: 'Vỏ lon nhôm nước ngọt 330ml',
      category: 'metal',
      categoryLabel: 'Rác thải kim loại',
      recycleCode: 'ALU (Số 41)',
      images: [
        'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=80'
      ],
      status: 'needs_special_handling',
      statusLabel: 'Cần xử lý riêng',
      condition: 'Lon sạch, không bị móp méo nhưng mép nắp nhôm có thể sắc nhọn.',
      color: 'Kim loại in màu đỏ',
      quantity: 4,
      unit: 'lon',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 12.5,
        widthCm: 6.6,
        heightCm: 12.5,
        diameterCm: 6.6,
        volumeMl: 330,
        usableSurfaceCm2: 240,
        totalSurfaceCm2: 275,
        usableRatioPercent: 87
      },
      cleaningInstructions: [
        'Rửa sạch nước ngọt còn đọng đáy lon để tránh kiến.',
        'Phơi khô ráo.'
      ],
      safetyWarnings: [
        'Mép kim loại sau khi cắt rất bén! Luôn đeo găng tay bảo hộ hoặc nhờ người lớn hỗ trợ dập viền nẹp.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-05'
    },
    {
      id: 'mat_9',
      name: 'Dây thừng đay tự nhiên & Dây gai thô',
      category: 'other',
      categoryLabel: 'Rác thải khác',
      recycleCode: 'Sợi đay tự nhiên',
      images: [
        '/assets/aistudio/image_ccf80b29.png'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Cuộn dây đay mộc khô ráo, đường kính sợi 2mm, độ bám keo cực tốt.',
      color: 'Nâu mộc Vintage',
      quantity: 1,
      unit: 'cuộn 20m',
      dimensions: {
        shapeType: 'irregular',
        lengthCm: 2000,
        widthCm: 0.2,
        heightCm: 0.2,
        usableSurfaceCm2: 1200,
        totalSurfaceCm2: 1200,
        usableRatioPercent: 100
      },
      cleaningInstructions: [
        'Bảo quản nơi khô ráo, tránh ẩm ướt.'
      ],
      safetyWarnings: [
        'Sử dụng kéo sắc để cắt sợi không bị tưa đầu.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-05'
    },
    {
      id: 'mat_10',
      name: 'Que tăm tre và đũa ăn dùng 1 lần',
      category: 'other',
      categoryLabel: 'Rác thải khác',
      recycleCode: 'Gỗ tre tự nhiên',
      images: [],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Que tre khô ráo, thẳng đều, thích hợp làm trục quay xe đồ chơi hoặc nan chống.',
      color: 'Vàng nhạt tre tự nhiên',
      quantity: 50,
      unit: 'que',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 15,
        widthCm: 0.25,
        heightCm: 15,
        diameterCm: 0.25,
        volumeMl: 1,
        usableSurfaceCm2: 12,
        totalSurfaceCm2: 12,
        usableRatioPercent: 100
      },
      cleaningInstructions: ['Lau sạch bụi bằng khăn khô.'],
      safetyWarnings: ['Đầu que nhọn, cẩn thận tránh chọc vào mắt hoặc tay.'],
      guideStatus: 'completed',
      imageStatus: 'pending', // Chưa cập nhật hình ảnh
      dateAdded: '2026-11-06'
    },
    {
      id: 'mat_11',
      name: 'Vỏ hộp sữa tươi tiệt trùng 1L (Tetra Pak tráng nhôm)',
      category: 'paper',
      categoryLabel: 'Rác thải giấy',
      recycleCode: 'Tetra Pak (Hỗn hợp giấy & nhôm)',
      images: [
        '/assets/aistudio/image_d0029fe5.png'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Hộp sữa đã súc rửa sạch cặn sữa bên trong, phơi khô ráo, không còn mùi, giữ nguyên form khối hộp chữ nhật.',
      color: 'Trắng xanh in họa tiết trang trại',
      quantity: 4,
      unit: 'hộp',
      dimensions: {
        shapeType: 'box',
        lengthCm: 7.2,
        widthCm: 7.2,
        heightCm: 22,
        volumeMl: 1000,
        usableSurfaceCm2: 650,
        totalSurfaceCm2: 740,
        usableRatioPercent: 88
      },
      cleaningInstructions: [
        'Tráng qua nước ấm 2-3 lần để khử hoàn toàn mùi sữa.',
        'Dốc ngược cho ráo nước trước khi cắt dán.'
      ],
      safetyWarnings: [
        'Cẩn thận khi dùng dao rọc giấy đục lỗ mái vòm vì vỏ hộp có lớp tráng nhôm dai.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-08'
    },
    {
      id: 'mat_12',
      name: 'Vỏ chai thủy tinh nước ép / siro 350ml trong suốt',
      category: 'glass',
      categoryLabel: 'Rác thải thủy tinh',
      recycleCode: 'GL 70 (Thủy tinh trong)',
      images: [
        'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=80'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Chai thủy tinh dày dặn, miệng tròn nhẵn, không bị nứt vỡ hay sứt mẻ.',
      color: 'Trong suốt phản quang',
      quantity: 2,
      unit: 'chai',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 18,
        widthCm: 6.2,
        heightCm: 18,
        diameterCm: 6.2,
        volumeMl: 350,
        usableSurfaceCm2: 320,
        totalSurfaceCm2: 360,
        usableRatioPercent: 89
      },
      cleaningInstructions: [
        'Ngâm nước ấm để bóc nhãn giấy bên ngoài.',
        'Rửa sạch bằng nước xà phòng ấm và lau khô bằng khăn microfiber.'
      ],
      safetyWarnings: [
        'Chất liệu thủy tinh dễ vỡ, không đập gõ mạnh, tránh để rơi rớt xuống nền cứng.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-08'
    },
    {
      id: 'mat_13',
      name: 'Chai nhựa 1.5L dung tích lớn PET',
      category: 'plastic',
      categoryLabel: 'Rác thải nhựa',
      recycleCode: 'PET / PETE (Số 1)',
      images: [
        '/assets/aistudio/image_68495993.png'
      ],
      status: 'safe_to_use',
      statusLabel: 'Có thể sử dụng',
      condition: 'Chai nhựa lớn trong suốt hoặc xanh nhẹ, thân cứng cáp, đáy phẳng.',
      color: 'Xanh nhạt trong suốt',
      quantity: 3,
      unit: 'chai',
      dimensions: {
        shapeType: 'cylinder',
        lengthCm: 30,
        widthCm: 9.5,
        heightCm: 30,
        diameterCm: 9.5,
        volumeMl: 1500,
        usableSurfaceCm2: 850,
        totalSurfaceCm2: 980,
        usableRatioPercent: 87
      },
      cleaningInstructions: [
        'Rửa sạch nước ngọt còn sót lại trong chai.',
        'Để khô ráo trước khi đo và cắt máng trồng.'
      ],
      safetyWarnings: [
        'Dùng băng dính bảo vệ hoặc mài nhẵn viền cắt để không làm xước tay.'
      ],
      guideStatus: 'completed',
      imageStatus: 'completed',
      dateAdded: '2026-11-08'
    }
  ];

  const initialCommunityPosts: CommunityPost[] = [
    // ==========================================
    // 6 BÀI ĐĂNG MẪU CHẤT LƯỢNG CAO FLAGSHIP 3D
    // ==========================================

    // 1. FLAGSHIP - bottle_pot
    {
      id: 'post_flagship_bottle_pot',
      title: 'Chậu Cây Tự Dưỡng & Lọ Hoa Để Bàn Thông Minh Từ Chai Nhựa PET',
      authorId: 'author_thanh_mai',
      authorName: 'Vũ Thanh Mai (CLB Không Rác Thải)',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Mô hình chậu cây tự tưới 2 tầng thông minh: phần trên dốc ngược chứa đất sạch và cây xanh mướt, phần dưới chứa nước trong suốt với tim bấc dẫn nước tự động. Tiết kiệm công chăm sóc, cây luôn xanh tươi và trang trí bàn học siêu đẹp.',
      coverImage: '/assets/aistudio/image_9cb5bb6a.png',
      additionalImages: ['/assets/aistudio/image_9cb5bb6a.png', '/assets/aistudio/image_68495993.png'],
      model3DType: 'bottle_pot',
      materialsSourceDescription: 'Chai nước khoáng PET 500ml thu gom từ canteen trường học và sợi tim vải cotton cũ gia đình.',
      materialsSummary: ['1 chai nhựa PET 500ml trong suốt', 'Sợi bấc bông cotton cũ 15cm', 'Đất sạch mùn dừa', 'Cây sen đá hoặc trầu bà nhỏ'],
      toolsSummary: ['Kéo sắc', 'Dao rọc giấy', 'Dùi nhọn đục lỗ nắp', 'Khăn lau'],
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 7cm × Cao 18cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt thân chai thành 2 nửa trên và dưới',
          description: 'Rửa sạch chai PET và bóc nhãn. Dùng dao rọc giấy cắt ngang thân chai ở vị trí 1/2 chiều cao (cách miệng chai khoảng 10-11cm). Nửa trên làm phễu trồng cây, nửa dưới làm bầu chứa nước dưỡng.',
          materialsNeeded: ['1 chai nhựa PET 500ml'],
          toolsNeeded: ['Dao rọc giấy', 'Thước đo'],
          dimensionsNotice: 'Cắt ngang chính xác tại vạch 11cm từ cổ chai xuống.',
          safetyWarning: 'Tì dao nhẹ nhàng xoay tròn thân chai để mép cắt thẳng và an toàn cho tay.',
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Đục lỗ nắp chai và luồn sợi bấc dẫn nước',
          description: 'Dùng dùi nhọn hơ nóng đục 1 lỗ tròn đường kính 4mm ở giữa nắp chai. Luồn sợi bấc vải cotton dài 15cm qua nắp, thắt nút ở phía trong để giữ cố định, chừa lại 6cm sợi bấc rủ xuống dưới.',
          materialsNeeded: ['Nắp chai nhựa', 'Sợi bấc cotton 15cm'],
          toolsNeeded: ['Dùi nhọn'],
          safetyWarning: 'Cẩn thận với đầu dùi nóng, tránh chạm vào da.',
          isCompleted: true,
          highlightPart: 'bottom'
        },
        {
          stepNumber: 3,
          title: 'Đổ đất mùn và trồng cây xanh vào phễu',
          description: 'Lắp nắp chai lại và úp ngược nửa trên vào nửa dưới. Cho đất dinh dưỡng tơi xốp vào lòng phễu, đặt cây trầu bà hoặc sen đá con vào chính giữa và nén nhẹ đất xung quanh gốc cây.',
          materialsNeeded: ['Đất sạch mùn dừa', 'Cây giống nhỏ'],
          toolsNeeded: ['Xẻng mini'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 4,
          title: 'Châm nước sạch vào bình chứa hoàn thiện',
          description: 'Nhấc nhẹ phễu trồng lên, châm khoảng 150ml nước sạch vào nửa dưới bình chứa sao cho sợi bấc ngập trong nước. Đặt phễu lại vị trí ban đầu và chiêm ngưỡng chậu cây tự tưới 3D.',
          materialsNeeded: ['150ml nước sạch'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: [
        'Sợi bấc cotton có khả năng mao dẫn nước cực kỳ đều đặn, chỉ cần châm nước 10 ngày/lần.',
        'Có thể dán thêm dải ruy băng mộc ở viền cắt để chậu cây thêm phần thanh lịch.'
      ],
      likesCount: 142,
      commentsCount: 18,
      comments: [
        {
          id: 'c_bottle_pot_1',
          userId: 'user_default',
          userName: 'Sáng Tạo Xanh',
          userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
          text: 'Mô hình 3D xoay 360 độ và xem tách cấu tạo 2 tầng cực kỳ rõ ràng, con mình làm theo thành công ngay!',
          createdAt: '2026-11-08 09:30',
          likes: 8
        }
      ],
      visibility: 'public',
      createdAt: '2026-11-08'
    },

    // 2. FLAGSHIP - pen_holder
    {
      id: 'post_flagship_pen_holder',
      title: 'Ống Cắm Bút Đa Năng Tai Mèo Kèm Chuông Vàng May Mắn Từ Chai Nhựa & Lon Nhôm',
      authorId: 'author_khanh_huyen',
      authorName: 'Khánh Huyền (Design DIY)',
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      description: 'Ống cắm bút bàn học siêu dễ thương với đôi tai mèo cắt tỉa tinh nghịch, phủ sơn màu pastel nhã nhặn, đính chuông vàng leng keng và chứa đầy bút chì, bút dạ highlight, thước kẻ gọn gàng.',
      coverImage: '/assets/aistudio/image_ee902c1a.png',
      additionalImages: ['/assets/aistudio/image_ee902c1a.png'],
      model3DType: 'pen_holder',
      materialsSourceDescription: 'Vỏ chai nước ngọt rỗng hoặc lon nhôm thu gom từ buổi dã ngoại gia đình cuối tuần.',
      materialsSummary: ['1 vỏ chai nhựa hoặc lon nhôm 330ml', 'Sơn acrylic màu xanh bạc hà / hồng phấn', 'Dây nơ chuông vàng may mắn', 'Mắt giả hạt cúc'],
      toolsSummary: ['Kéo thủ công', 'Dao rọc giấy', 'Cọ vẽ sơn', 'Giấy nhám mịn'],
      difficulty: 'Dễ',
      estimatedTime: '25 phút',
      recycledRatio: 95,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 7.5cm × Cao 14cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Vẽ phác thảo đôi tai mèo trên thân chai',
          description: 'Lau khô thân chai nhựa hoặc lon nhôm. Dùng bút dạ vẽ 2 hình tam giác tai mèo vươn cao ở phía trước thành chai (chiều cao tai 4cm, cách nhau 3cm).',
          materialsNeeded: ['1 chai nhựa hoặc lon nhôm'],
          toolsNeeded: ['Bút dạ', 'Thước kẻ'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Cắt lượn theo đường viền tai mèo',
          description: 'Dùng kéo cắt men theo đường vẽ tai mèo, phần thành sau cắt ngang phẳng tạo miệng ống cắm bút rộng rãi. Dùng giấy nhám mịn mài viền cắt để không bị sắc.',
          materialsNeeded: [],
          toolsNeeded: ['Kéo sắc', 'Giấy nhám mịn'],
          safetyWarning: 'Nếu dùng vỏ lon nhôm, nhớ dùng búa gõ dập mép viền để không cứa vào tay.',
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 3,
          title: 'Sơn phủ màu nền và vẽ khuôn mặt mèo',
          description: 'Quét 2 lớp sơn acrylic màu pastel lên toàn thân ống bút. Khi sơn khô, vẽ mắt nhắm đáng yêu, mũi hồng và 6 sợi râu mèo tinh nghịch.',
          materialsNeeded: ['Sơn acrylic', 'Bút lông đen'],
          toolsNeeded: ['Cọ quét sơn'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 4,
          title: 'Thắt nơ chuông vàng và sắp xếp bút thước',
          description: 'Thắt nơ ruy băng đính kèm quả chuông vàng quanh cổ ống bút, sau đó cắm đầy các loại bút màu, kéo và thước kẻ lên bàn học.',
          materialsNeeded: ['Nơ ruy băng', 'Quả chuông vàng mini'],
          toolsNeeded: ['Súng bắn keo'],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: [
        'Sơn lót 1 lớp màu trắng trước khi quét màu pastel sẽ giúp màu sắc lên chuẩn và rực rỡ hơn.',
        'Đáy chai nhựa có thể bỏ thêm vài viên sỏi nhỏ để ống bút đứng vững khi cắm nhiều kéo nặng.'
      ],
      likesCount: 128,
      commentsCount: 15,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-08'
    },

    // 3. FLAGSHIP - box_organizer
    {
      id: 'post_flagship_box_organizer',
      title: 'Kệ Bậc Thang Bìa Carton 3 Ngăn Để Bàn Tiện Ích Từ Hộp Bưu Phẩm Cũ',
      authorId: 'author_minh_khoi',
      authorName: 'Lê Minh Khôi (CLB Sáng Tạo Trẻ)',
      authorAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      description: 'Kệ đựng tài liệu, sổ tay, tai nghe và đồ dùng học tập phân 3 bậc thang so le tiện lợi, được cắt ghép chuẩn xác từ bìa carton sóng 3 lớp cứng cáp, chịu lực đến 5kg cho góc làm việc ngăn nắp.',
      coverImage: '/assets/aistudio/image_7e7630d4.png',
      additionalImages: ['/assets/aistudio/image_7e7630d4.png'],
      model3DType: 'box_organizer',
      materialsSourceDescription: 'Hộp carton đóng gói hàng bưu điện online của gia đình sau khi mở kiện.',
      materialsSummary: ['2 tấm bìa carton sóng 3 lớp phẳng', 'Giấy decal dán phủ vân gỗ mộc hoặc kraft', 'Keo dán sữa hoặc keo nến'],
      toolsSummary: ['Thước thép 50cm', 'Dao rọc giấy sắc', 'Súng bắn keo nến', 'Bút chì định vị'],
      difficulty: 'Trung bình',
      estimatedTime: '40 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Dài 26cm × Rộng 20cm × Cao 18cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Đo và cắt 2 tấm sườn vách bậc thang',
          description: 'Dùng thước thép vạch hình bậc thang 3 cấp lên tấm carton: bậc 1 cao 6cm, bậc 2 cao 12cm, bậc 3 cao 18cm (mỗi bậc sâu 6.5cm). Dùng dao rọc rạch 2 tấm sườn hông đối xứng.',
          materialsNeeded: ['Tấm bìa carton'],
          toolsNeeded: ['Thước kim loại', 'Dao rọc giấy'],
          dimensionsNotice: 'Chiều sâu mỗi bậc 6.5cm, bậc dốc đều đặn.',
          safetyWarning: 'Tì ngón tay sau cữ thước kim loại khi rọc carton dày.',
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Cắt các tấm đáy và vách ngăn ngang',
          description: 'Cắt 3 tấm mặt đáy bậc thang (rộng 26cm × sâu 6.5cm) và 3 tấm vách ngăn chắn lưng (rộng 26cm × cao tương ứng các bậc 6cm, 12cm, 18cm).',
          materialsNeeded: ['Bìa carton'],
          toolsNeeded: ['Dao rọc giấy'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Bắn keo nến lắp ráp khung bậc thang',
          description: 'Gắn tấm đáy và vách ngăn vào tấm sườn hông thứ nhất bằng đường keo nến đặc, sau đó ốp tấm sườn hông thứ hai vào, ép chặt trong 30 giây để keo định hình vững chãi.',
          materialsNeeded: ['Keo nến'],
          toolsNeeded: ['Súng bắn keo'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 4,
          title: 'Dán viền nẹp kraft và sắp xếp đồ dùng',
          description: 'Dán nẹp giấy kraft hoặc băng dính vân gỗ dọc theo mép sóng carton để che các đường cắt thô, hoàn thiện kệ để bàn 3 ngăn siêu chắc chắn.',
          materialsNeeded: ['Decal bọc vân gỗ'],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'top'
        }
      ],
      tipsAndLearnings: [
        'Chọn thùng carton sóng dày (flute B hoặc C) sẽ giúp kệ chịu lực tốt mà không bị võng khi để sách dày.',
        'Có thể dán thêm 1 dải chia ngăn nhỏ ở bậc 1 để cắm USB và kẹp ghim.'
      ],
      likesCount: 156,
      commentsCount: 22,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-08'
    },

    // 4. FLAGSHIP - lantern_lamp
    {
      id: 'post_flagship_lantern_lamp',
      title: 'Đèn Lồng Trang Trí Bầu Trời Sao Lấp Lánh Từ Vỏ Lon Nhôm & Chai Thủy Tinh',
      authorId: 'author_duc_tri',
      authorName: 'Ngô Đức Trí (Mỹ Thuật Xanh)',
      authorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      description: 'Chiếc đèn lồng lung linh phát ra ánh sáng vàng ấm qua hàng trăm lỗ đục hoa văn chòm sao, biến căn phòng ngủ hoặc hiên nhà ban công thành không gian cổ tích về đêm.',
      coverImage: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=80',
      additionalImages: ['https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=80'],
      model3DType: 'lantern_lamp',
      materialsSourceDescription: 'Vỏ lon nước giải khát bằng nhôm sau tiệc liên hoan lớp học và quai móc kim loại.',
      materialsSummary: ['1 vỏ lon nhôm hoặc chai thủy tinh trong', '1 nến điện tử LED 3V ánh sáng ấm 2700K', 'Dây kẽm bọc nhựa hoặc dây đay treo'],
      toolsSummary: ['Đinh nhọn thép', 'Búa gõ đinh mini', 'Kìm uốn kim loại', 'Bút vẽ mẫu hoa văn'],
      difficulty: 'Trung bình',
      estimatedTime: '30 phút',
      recycledRatio: 90,
      type: 'with_added_materials',
      dimensions: 'Đường kính 6.6cm × Cao 15cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Đổ nước làm đông đá trong lon chống móp',
          description: 'Rửa sạch lon nhôm, đổ đầy nước vào lon và cho vào ngăn đá tủ lạnh 4 giờ. Lớp đá đông cứng bên trong sẽ giúp thân lon không bị móp méo khi đục lỗ bằng búa đinh.',
          materialsNeeded: ['1 lon nhôm', 'Nước sạch'],
          toolsNeeded: ['Tủ lạnh'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Vẽ phác thảo mẫu hoa văn chòm sao',
          description: 'Dán tờ giấy vẽ mẫu chòm sao, vầng trăng khuyết hoặc trái tim lên thân lon, cố định bằng băng keo trong.',
          materialsNeeded: ['Bản vẽ mẫu hoa văn'],
          toolsNeeded: ['Bút dạ', 'Băng keo'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 3,
          title: 'Dùng búa đinh đục các lỗ sáng theo mẫu',
          description: 'Đặt lon lên khăn bông mềm, dùng đinh thép đặt vào các điểm vẽ rồi gõ nhẹ búa để tạo các lỗ đục đều đặn. Sau khi đục xong, tráng nước ấm để đá tan chảy ra hết.',
          materialsNeeded: [],
          toolsNeeded: ['Búa đinh', 'Đinh thép'],
          safetyWarning: 'Gõ búa nhẹ tay, tránh để đinh trượt làm trầy xước ngón tay.',
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 4,
          title: 'Lắp quai xách và thả nến LED phát sáng',
          description: 'Đục 2 lỗ ở mép trên gắn quai dây kẽm uốn cong, đặt viên nến điện tử LED 3V vào đáy lon và bật công tắc để tận hưởng ánh sáng lung linh.',
          materialsNeeded: ['Nến LED 3V', 'Quai dây kẽm'],
          toolsNeeded: ['Kìm'],
          isCompleted: true,
          highlightPart: 'top'
        }
      ],
      tipsAndLearnings: [
        'Kỹ thuật làm đông đá trong lon là bí quyết quan trọng nhất để lon giữ nguyên hình trụ hoàn hảo.',
        'Sử dụng nến LED điện tử tuyệt đối an toàn chống cháy nổ và không sinh khói.'
      ],
      likesCount: 135,
      commentsCount: 19,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-08'
    },

    // 5. FLAGSHIP - bird_feeder
    {
      id: 'post_flagship_bird_feeder',
      title: 'Ngôi Nhà Cho Chim Ăn Ngoài Vườn Xanh Từ Vỏ Hộp Sữa Giấy Tiệt Trùng 1L',
      authorId: 'author_thanh_truc',
      authorName: 'Nguyễn Thanh Trúc (Mầm Non Hoa Sen)',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Mái nhà che mưa ấm áp làm từ hộp sữa giấy Tetra Pak chống thấm nước, có cửa vòm tròn mở rộng, thanh đậu que tre chắc chắn và khay chứa hạt ngũ cốc mời chim nhỏ ghé chơi.',
      coverImage: '/assets/aistudio/image_d0029fe5.png',
      additionalImages: ['/assets/aistudio/image_d0029fe5.png'],
      model3DType: 'bird_feeder',
      materialsSourceDescription: 'Hộp sữa tươi 1L của gia đình sau bữa sáng, đã rửa sạch và phơi khô.',
      materialsSummary: ['1 vỏ hộp sữa giấy 1L tráng nhôm', '1 que tre hoặc đũa gỗ làm cành đậu', 'Dây dù hoặc dây đay 50cm treo cành cây', 'Hạt kê, thóc, hạt hướng dương'],
      toolsSummary: ['Dao rọc giấy', 'Kéo sắc', 'Sơn acrylic chống nước trang trí'],
      difficulty: 'Dễ',
      estimatedTime: '25 phút',
      recycledRatio: 95,
      type: '100_percent_recycled',
      dimensions: 'Dài 10cm × Rộng 9cm × Cao 23cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Vệ sinh và cắt tạo hình cửa vòm tròn',
          description: 'Súc sạch hộp sữa bằng nước ấm và phơi khô. Dùng bút vẽ cửa vòm đường kính 5cm cách đáy hộp 4cm, dùng dao rọc giấy cắt mở ô cửa để chim dễ vào lấy thức ăn.',
          materialsNeeded: ['1 hộp sữa 1L'],
          toolsNeeded: ['Dao rọc giấy'],
          dimensionsNotice: 'Cửa vòm cách đáy hộp 4cm để tạo khay giữ hạt sâu lòng.',
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Đục lỗ xỏ cành đậu que tre',
          description: 'Ngay dưới mép cửa vòm khoảng 1.5cm, đục 1 lỗ tròn xuyên qua cả mặt trước và mặt sau hộp sữa. Xỏ que tre dài 18cm qua làm điểm tựa cho chim đậu.',
          materialsNeeded: ['Que tre 18cm'],
          toolsNeeded: ['Dùi nhọn'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 3,
          title: 'Sơn trang trí mái nhà ngói xanh / đỏ',
          description: 'Quét sơn màu nâu ấm hoặc xanh lá lên thân hộp, sơn mái dốc trên đỉnh hộp tạo hình ngói ngộ nghĩnh, dán lớp bảo vệ chống thấm nước mưa.',
          materialsNeeded: ['Sơn acrylic'],
          toolsNeeded: ['Cọ vẽ'],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 4,
          title: 'Buộc dây treo tán cây và đổ hạt dinh dưỡng',
          description: 'Đục lỗ trên chóp nẹp hộp sữa, xỏ dây dù treo lên cành cây râm mát ngoài vườn. Đổ một vốc hạt kê, hạt hướng dương vào đáy khay.',
          materialsNeeded: ['Dây dù', 'Hạt cho chim'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'body'
        }
      ],
      tipsAndLearnings: [
        'Vỏ hộp Tetra Pak có lớp màng nhôm bên trong kháng nước cực tốt, chịu được mưa nắng ngoài trời.',
        'Treo nhà chim ở cành cây cao từ 1.8m trở lên để tránh mèo và thú cưng quấy rầy.'
      ],
      likesCount: 147,
      commentsCount: 20,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-08'
    },

    // 6. FLAGSHIP - plastic_planter
    {
      id: 'post_flagship_plastic_planter',
      title: 'Chậu Trồng Rau Mầm & Bạc Hà Thủy Canh Nằm Ngang Trên Giá Gỗ Chữ X Từ Chai 1.5L',
      authorId: 'author_hoang_nam',
      authorName: 'Trịnh Hoàng Nam (Sống Xanh)',
      authorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      description: 'Chậu trồng rau mầm hoặc thảo mộc mini thiết kế nằm ngang tinh tế, đặt trên giá chân đế chữ X bằng gỗ mộc, khoét máng rộng chứa viên đất nung sỏi nhẹ và nước dưỡng chất vô cùng hiện đại.',
      coverImage: '/assets/aistudio/image_68495993.png',
      additionalImages: ['/assets/aistudio/image_68495993.png'],
      model3DType: 'plastic_planter',
      materialsSourceDescription: 'Chai nhựa lớn 1.5L trong suốt thu gom từ gia đình và vài thanh nẹp que gỗ thừa.',
      materialsSummary: ['1 chai nhựa 1.5L dày dặn', 'Viên đất nung LECA hoặc bông gòn thủy canh', 'Que kem gỗ ghép giá đỡ chữ X', 'Hạt giống rau mầm cải ngọt / bạc hà'],
      toolsSummary: ['Dao rọc giấy', 'Súng bắn keo nến', 'Dũa làm mịn viền cắt'],
      difficulty: 'Dễ',
      estimatedTime: '30 phút',
      recycledRatio: 95,
      type: '100_percent_recycled',
      dimensions: 'Dài 30cm × Rộng 12cm × Cao 14cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Vẽ và khoét máng trồng ngang thân chai',
          description: 'Đặt chai nằm ngang, vạch 1 ô cửa sổ chữ nhật kích thước rộng 7cm × dài 18cm trên thân chai. Dùng dao rọc giấy khoét ô máng và mài nhẵn viền cắt.',
          materialsNeeded: ['1 chai nhựa 1.5L'],
          toolsNeeded: ['Dao rọc giấy', 'Thước kẻ'],
          dimensionsNotice: 'Khoét ô rộng 7cm × dài 18cm, chừa 2 đầu chai 6cm.',
          safetyWarning: 'Tì dao nhẹ nhàng, dán băng keo trong mép viền để không xước tay khi thu hoạch rau.',
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Lắp ráp 2 giá đỡ chân chữ X từ que gỗ',
          description: 'Dùng 4 que gỗ đan chéo thành 2 cặp chân chữ X có góc mở 90 độ, cố định điểm giao bằng keo nến, tạo giá đỡ vững chắc cho thân chai nằm ngang.',
          materialsNeeded: ['Que kem gỗ', 'Keo nến'],
          toolsNeeded: ['Súng bắn keo'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 3,
          title: 'Gắn thân chai lên chân đế chữ X',
          description: 'Đặt thân chai nhựa nằm lên 2 giá đỡ chữ X, nhỏ vài giọt keo nến dưới rãnh tiếp xúc để chai không bị lăn nghiêng khi chứa nước.',
          materialsNeeded: [],
          toolsNeeded: ['Súng bắn keo'],
          isCompleted: true,
          highlightPart: 'bottom'
        },
        {
          stepNumber: 4,
          title: 'Rải viên đất nung và gieo hạt giống thảo mộc',
          description: 'Rải 1 lớp viên đất nung LECA dày 3cm vào lòng máng, châm nước sạch dinh dưỡng ngập 1/2 lớp sỏi rồi rải đều hạt giống rau mầm hoặc cắm cành bạc hà.',
          materialsNeeded: ['Viên đất nung LECA', 'Hạt giống rau', 'Nước sạch'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'top'
        }
      ],
      tipsAndLearnings: [
        'Chai nằm ngang có diện tích bề mặt rất rộng, cây hấp thu tối đa ánh sáng mặt trời.',
        'Sau 5-7 ngày rau mầm sẽ mọc xanh um, có thể cắt tỉa ăn ngay tại bàn ăn.'
      ],
      likesCount: 164,
      commentsCount: 24,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-08'
    },

    // --- CÁC MẪU BÀI ĐĂNG CỘNG ĐỒNG KHÁC ---
    // 7. Xe đồ chơi từ chai nhựa & nắp chai
    {
      id: 'post_toy_car',
      title: 'Xe Ô Tô Đồ Chơi Năng Động Từ Vỏ Chai Nhựa & 4 Nắp Chai',
      authorId: 'author_minh_khoi',
      authorName: 'Lê Minh Khôi (CLB Sáng Tạo Trẻ)',
      authorAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      description: 'Chỉ với 1 chai nước ngọt rỗng, 4 chiếc nắp chai và 2 que tăm tre làm trục quay, bạn đã tạo ra chiếc xe đồ chơi siêu mượt mà cho các bé.',
      coverImage: '/assets/aistudio/image_9cb5bb6a.png',
      additionalImages: ['/assets/aistudio/image_9cb5bb6a.png'],
      model3DType: 'toy_car',
      materialsSourceDescription: 'Chai nhựa thu gom sau giờ ăn trưa và nắp chai tích trữ từ bình nước ngọt.',
      materialsSummary: ['1 chai nhựa 500ml', '4 nắp chai nhựa màu', '2 que tăm tre', 'Hình dán trang trí'],
      toolsSummary: ['Kéo thủ công', 'Dao rọc giấy', 'Súng bắn keo nến', 'Dùi nhọn'],
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Dài 21cm × Rộng 10cm × Cao 8cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Chuẩn bị và làm sạch vỏ chai nhựa',
          description: 'Rửa sạch vỏ chai nhựa và 4 nắp chai, bóc sạch tem nhãn và lau khô ráo hoàn toàn.',
          materialsNeeded: ['1 chai nhựa', '4 nắp chai'],
          toolsNeeded: ['Khăn lau'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Dùi 4 lỗ trục bánh xe đối xứng',
          description: 'Dùng dùi nhọn hoặc đầu nhọn kéo đục 2 cặp lỗ đối xứng xuyên ngang thân chai ở gần đầu và gần đuôi xe.',
          materialsNeeded: ['Thân chai'],
          toolsNeeded: ['Dùi nhọn'],
          dimensionsNotice: 'Cách đáy và cổ chai khoảng 4cm, vị trí cân bằng 2 bên.',
          safetyWarning: 'Nhờ người lớn giữ chắc chai hoặc dùi cẩn thận tránh trượt tay.',
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 3,
          title: 'Tạo lỗ tâm ở 4 nắp chai làm bánh xe',
          description: 'Đục 1 lỗ nhỏ ngay chính giữa tâm mỗi chiếc nắp chai vừa khít với đường kính que tăm tre.',
          materialsNeeded: ['4 nắp chai'],
          toolsNeeded: ['Dùi nhọn'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 4,
          title: 'Xỏ que tre và lắp ráp 4 bánh xe',
          description: 'Luồn 2 que tăm tre xuyên qua thân chai. Gắn nắp chai vào hai đầu que, nhỏ 1 giọt keo nến ở đầu que để bánh xe không bị tuột nhưng vẫn lăn trơn tru.',
          materialsNeeded: ['2 que tre', 'Keo dán'],
          toolsNeeded: ['Súng bắn keo'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 5,
          title: 'Khoét mui xe và trang trí ngôi sao',
          description: 'Dùng dao khoét một ô cửa sổ chữ nhật trên mui xe, dán đề can ngôi sao sắc màu trang trí.',
          materialsNeeded: ['Decal trang trí'],
          toolsNeeded: ['Dao rọc giấy'],
          isCompleted: true,
          highlightPart: 'body'
        }
      ],
      tipsAndLearnings: [
        'Dùng que tre trơn nhẵn và không dính keo vào thân chai để bánh xe quay tự do.',
        'Có thể gắn thêm dây thừng nhỏ ở đầu xe để bé kéo đi dạo.'
      ],
      likesCount: 68,
      commentsCount: 9,
      comments: [
        {
          id: 'c_car_1',
          userId: 'user_default',
          userName: 'Sáng Tạo Xanh',
          userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
          text: 'Bánh xe lăn rất mượt mà! Con mình cực kỳ hào hứng khi tự tay dán nắp chai.',
          createdAt: '2026-11-06 10:15',
          likes: 4
        }
      ],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 2. Tàu hỏa đồ chơi từ chai nhựa
    {
      id: 'post_toy_train',
      title: 'Đoàn Tàu Hỏa Sắc Màu Cho Bé Làm Bằng Chai Nhựa Cũ',
      authorId: 'author_thanh_truc',
      authorName: 'Nguyễn Thanh Trúc (Mầm Non Hoa Sen)',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Đoàn tàu hỏa rực rỡ với đầu tàu có ống khói xốp kim tuyến và các toa xe trong suốt nối dài chở đồ chơi.',
      coverImage: '/assets/aistudio/image_fde1dabe.png',
      additionalImages: ['/assets/aistudio/image_fde1dabe.png'],
      model3DType: 'toy_car',
      materialsSourceDescription: 'Chai nhựa sữa chua uống và chai nước suối cắt khúc.',
      materialsSummary: ['4 chai nhựa', '8 nắp chai màu trắng', 'Giấy xốp kim tuyến', 'Que kem gỗ'],
      toolsSummary: ['Kéo', 'Keo nến', 'Băng dính viền'],
      difficulty: 'Trung bình',
      estimatedTime: '35 phút',
      recycledRatio: 95,
      type: '100_percent_recycled',
      dimensions: 'Dài 60cm × Rộng 9cm × Cao 12cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt thân chai tạo các toa tàu',
          description: 'Cắt ngắn các chai nhựa lấy đoạn thân dài 10cm làm thân các toa tàu.',
          materialsNeeded: ['3 chai nhựa'],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Tạo hình đầu tàu và ống khói',
          description: 'Dùng giấy xốp bọc mái vòm đầu tàu, gắn thêm 1 đoạn nắp chai đứng làm ống khói phun khói.',
          materialsNeeded: ['1 chai nhựa', 'Xốp màu'],
          toolsNeeded: ['Keo nến'],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 3,
          title: 'Gắn bánh xe nắp chai và nối các toa',
          description: 'Dán đôi các nắp chai dưới gầm mỗi toa, dùng que kem gỗ gắn dưới đáy liên kết các toa lại với nhau.',
          materialsNeeded: ['Nắp chai', 'Que kem'],
          toolsNeeded: ['Keo dán'],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Viền mép chai bằng băng dính lấp lánh vừa đẹp mắt vừa che mép cắt an toàn cho bé.'],
      likesCount: 52,
      commentsCount: 5,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 3. Chậu cây treo ngang chai nhựa xanh
    {
      id: 'post_planter_horizontal',
      title: 'Chậu Cây Trầu Bà Treo Ngang Tường Từ Vỏ Chai Nhựa Xanh',
      authorId: 'author_hoang_nam',
      authorName: 'Trịnh Hoàng Nam (Sống Xanh)',
      authorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      description: 'Chậu cây nằm ngang độc đáo tận dụng thân chai PET xanh dương, khoét lỗ thân chai trồng cây trầu bà lọc không khí trong nhà.',
      coverImage: '/assets/aistudio/image_68495993.png',
      additionalImages: ['/assets/aistudio/image_68495993.png'],
      model3DType: 'planter',
      materialsSourceDescription: 'Vỏ chai nước ngọt 1.5L màu xanh coban.',
      materialsSummary: ['1 chai nhựa PET xanh', 'Dây cước treo', 'Đất trồng và cây trầu bà'],
      toolsSummary: ['Dao rọc giấy', 'Kéo sắc', 'Súng bắn keo'],
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Dài 28cm × Đường kính 8.5cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Chuẩn bị dụng cụ và vệ sinh chai',
          description: 'Dao rọc giấy, kéo, súng bắn keo và chai nhựa rỗng cũ đã được rửa sạch, phơi khô.',
          materialsNeeded: ['1 chai nhựa xanh'],
          toolsNeeded: ['Kéo', 'Dao rọc'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Khoét lỗ trồng cây ở thân chai',
          description: 'Dùng dao hoặc kéo cắt một lỗ hình chữ nhật ở phần thân chai nhựa đủ rộng để trồng cây mà bạn yêu thích.',
          materialsNeeded: ['Thân chai'],
          toolsNeeded: ['Dao rọc giấy'],
          dimensionsNotice: 'Khoét ô rộng 6cm × dài 14cm.',
          safetyWarning: 'Tì lưỡi dao cẩn thận theo đường kẻ sẵn để mép cắt thẳng đẹp.',
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 3,
          title: 'Khoét lỗ thoát nước bên dưới',
          description: 'Dùng đầu nhọn của kéo hoặc dao khoét những lỗ nhỏ bên dưới chai nhựa để tạo đường thoát nước cho chậu cây.',
          materialsNeeded: ['Đáy chậu'],
          toolsNeeded: ['Dùi nhọn'],
          isCompleted: true,
          highlightPart: 'bottom'
        },
        {
          stepNumber: 4,
          title: 'Xỏ dây treo và trồng cây',
          description: 'Buộc dây cước ở cổ chai và đuôi chai, đổ đất mùn và cắm cây trầu bà xanh mướt vào lòng chậu.',
          materialsNeeded: ['Dây cước', 'Đất', 'Cây trầu bà'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Cây trầu bà sống rất khỏe trong bóng râm, chỉ cần tưới 1 lần mỗi tuần.'],
      likesCount: 84,
      commentsCount: 12,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 4. Chậu hoa hình thỏ từ đáy chai
    {
      id: 'post_bunny_pot',
      title: 'Bộ Chậu Hoa Hình Thỏ Dễ Thương Từ Đáy Chai Nhựa',
      authorId: 'author_mai_anh',
      authorName: 'Đặng Mai Anh',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Biến phần đáy chai nhựa thành bộ 3 chú thỏ con màu hồng, trắng và vàng có đôi tai dài ngộ nghĩnh, trồng hoa mười giờ rực rỡ.',
      coverImage: '/assets/aistudio/image_fd1394b2.png',
      additionalImages: ['/assets/aistudio/image_fd1394b2.png'],
      model3DType: 'planter',
      materialsSourceDescription: 'Đáy chai nhựa ngọt loại 1.5L có 5 múi tròn nâng đỡ.',
      materialsSummary: ['3 đáy chai nhựa', 'Sơn acrylic (hồng, trắng, vàng)', 'Mắt nhựa giả'],
      toolsSummary: ['Kéo cong', 'Bút lông', 'Cọ quét sơn'],
      difficulty: 'Dễ',
      estimatedTime: '30 phút',
      recycledRatio: 95,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 10cm × Cao 15cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Vẽ phác thảo đôi tai thỏ',
          description: 'Rửa sạch đáy chai, dùng bút vẽ phác thảo 2 chiếc tai thỏ vươn cao ở một bên thành chai.',
          materialsNeeded: ['Đáy chai'],
          toolsNeeded: ['Bút dạ'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Cắt lượn theo hình tai thỏ',
          description: 'Dùng kéo sắc cắt men theo nét vẽ tai thỏ, phần thành chai còn lại cắt ngang phẳng.',
          materialsNeeded: [],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Sơn màu nền và vẽ mặt thỏ',
          description: 'Sơn phủ màu pastel, dán mắt nhựa, vẽ mũi hồng và râu mèo/thỏ, dán 2 bàn chân thỏ xinh xắn dưới đáy.',
          materialsNeeded: ['Sơn acrylic', 'Mắt giả'],
          toolsNeeded: ['Cọ vẽ'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 4,
          title: 'Đục lỗ đáy và trồng hoa mười giờ',
          description: 'Dùi 3 lỗ nhỏ dưới đáy chậu thoát nước, cho đất dinh dưỡng và trồng hoa mười giờ nhiều màu.',
          materialsNeeded: ['Đất', 'Hoa'],
          toolsNeeded: ['Dùi'],
          isCompleted: true,
          highlightPart: 'top'
        }
      ],
      tipsAndLearnings: ['Sơn 2 lớp acrylic để màu lên đều và không bị bong khi tưới nước.'],
      likesCount: 96,
      commentsCount: 14,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 5. Hộp đựng bút Minion từ chai nhựa
    {
      id: 'post_pen_minion',
      title: 'Hộp Đựng Bút Để Bàn Phong Cách Minion Từ Chai Nhựa',
      authorId: 'author_khanh_huyen',
      authorName: 'Khánh Huyền (Design DIY)',
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      description: 'Hộp cắm bút màu vàng rực rỡ với cặp kính tròn đặc trưng của chú Minion nhí nhảnh, giúp bàn học luôn gọn gàng.',
      coverImage: '/assets/aistudio/image_ee902c1a.png',
      additionalImages: ['/assets/aistudio/image_ee902c1a.png'],
      model3DType: 'pen_holder',
      materialsSourceDescription: 'Vỏ chai nước khoáng rỗng 500ml.',
      materialsSummary: ['1 chai nhựa', 'Sơn vàng & xanh', 'Giấy xốp đen làm kính'],
      toolsSummary: ['Kéo', 'Dũa mài mép', 'Bút lông'],
      difficulty: 'Dễ',
      estimatedTime: '25 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 6.5cm × Cao 13cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt thân chai lấy chiều cao hộp bút',
          description: 'Xác định chiều cao mong muốn khoảng 13cm và dùng kéo cắt bỏ phần đầu chai theo kích thước tương ứng.',
          materialsNeeded: ['1 chai nhựa'],
          toolsNeeded: ['Kéo', 'Thước đo'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Mài nhẵn miệng hộp bút',
          description: 'Dùng miếng nhám hoặc cây dũa mài nhẹ miệng hộp để loại bỏ phần sắc nhọn, bảo vệ ngón tay khi lấy bút.',
          materialsNeeded: [],
          toolsNeeded: ['Giấy nhám'],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 3,
          title: 'Sơn màu và trang trí kính Minion',
          description: 'Sơn màu vàng tươi toàn bộ thân chai, dán dải băng đen và cặp kính tròn đặc trưng Minion.',
          materialsNeeded: ['Sơn', 'Keo'],
          toolsNeeded: ['Cọ'],
          isCompleted: true,
          highlightPart: 'body'
        }
      ],
      tipsAndLearnings: ['Có thể dán băng keo giấy quanh miệng chai để tạo đường kẻ màu thật sắc nét.'],
      likesCount: 77,
      commentsCount: 8,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 6. Lọ hoa quấn dây thừng vintage
    {
      id: 'post_rope_vase',
      title: 'Bình Hoa Phong Cách Vintage Quấn Dây Thừng Từ Chai Nhựa',
      authorId: 'author_thanh_mai',
      authorName: 'Vũ Thanh Mai',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Lọ hoa mang hơi thở mộc mạc Retro từ chai nhựa quấn dây đay tự nhiên, cắm hoa khô hoặc hoa baby trang trí góc phòng ấm áp.',
      coverImage: '/assets/aistudio/image_ccf80b29.png',
      additionalImages: ['/assets/aistudio/image_ccf80b29.png'],
      model3DType: 'planter',
      materialsSourceDescription: 'Chai nhựa thu gom kết hợp cuộn dây gai thừa từ gói quà.',
      materialsSummary: ['1 chai nhựa dáng cao', 'Cuộn dây đay 15m', 'Nơ ruy băng vải bố'],
      toolsSummary: ['Súng bắn keo nến', 'Kéo'],
      difficulty: 'Dễ',
      estimatedTime: '30 phút',
      recycledRatio: 90,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 7cm × Cao 20cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt thân chai theo chiều cao mong muốn',
          description: 'Cắt bỏ phần cổ chai nếu muốn làm lọ cắm hoa miệng rộng hoặc giữ nguyên cổ chai nếu cắm hoa cành đơn.',
          materialsNeeded: ['1 chai nhựa'],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Quấn dây thừng từ đáy lên cổ',
          description: 'Chấm một ít keo nến cố định đầu dây ở đáy chai, sau đó quấn đều tay từng vòng dây thừng khít nhau lên đến miệng.',
          materialsNeeded: ['Dây đay', 'Keo nến'],
          toolsNeeded: ['Súng bắn keo'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Đính nơ trang trí hoàn thiện',
          description: 'Thắt nơ ruy băng vải thô hoặc đính cúc gỗ ở giữa thân lọ hoa để tạo điểm nhấn cổ điển.',
          materialsNeeded: ['Nơ ruy băng'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Quấn dây càng chặt và sát nhau thì lọ hoa càng cứng cáp và đẹp mắt.'],
      likesCount: 89,
      commentsCount: 11,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 7. Túi xách hình con cá từ quần jean cũ
    {
      id: 'post_fish_bag',
      title: 'Túi Xách Dây Rút Hình Con Cá Đại Dương May Từ Quần Jean Cũ',
      authorId: 'author_quynh_nga',
      authorName: 'Hoàng Quỳnh Nga (Upcycle Fashion)',
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      description: 'Thiết kế thời trang tái chế độc nhất vô nhị: các vảy cá xếp tầng 3D may từ các mảnh vải denim nhiều sắc độ của quần jean rách.',
      coverImage: '/assets/aistudio/image_db28e61c.png',
      additionalImages: ['/assets/aistudio/image_db28e61c.png'],
      model3DType: 'fabric_tote',
      materialsSourceDescription: '2 chiếc quần jean cũ đã sờn gối không còn mặc.',
      materialsSummary: ['Vải quần jean denim', 'Dây thừng rút', 'Cúc áo gỗ làm mắt cá'],
      toolsSummary: ['Kéo cắt vải', 'Kim chỉ hoặc máy may', 'Thước dây'],
      difficulty: 'Trung bình',
      estimatedTime: '60 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Dài 38cm × Rộng 18cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt các mảnh vảy cá denim',
          description: 'Cắt ống quần jean thành các mảnh vải vòm bán nguyệt kích thước 4×5cm theo các sắc độ xanh đậm và nhạt.',
          materialsNeeded: ['Quần jean cũ'],
          toolsNeeded: ['Kéo cắt vải'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'May vảy cá so le theo lớp',
          description: 'May lần lượt từng tầng vảy cá so le từ đuôi cá ngược lên thân trên miếng vải lót nền.',
          materialsNeeded: [],
          toolsNeeded: ['Kim chỉ'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 3,
          title: 'May đầu cá và đính nút mắt gỗ',
          description: 'May phần miệng cá bằng vải denim sáng màu hơn, đính nút áo gỗ to bản hai bên làm mắt cá sinh động.',
          materialsNeeded: ['Nút gỗ'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 4,
          title: 'May nẹp luồn dây rút',
          description: 'May gấp nẹp ở miệng túi, luồn dây dù qua làm quai đeo vai tiện lợi.',
          materialsNeeded: ['Dây dù'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Vải denim không bị tưa nhiều ở mép, tạo hiệu ứng viền sờn rất cá tính.'],
      likesCount: 112,
      commentsCount: 16,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 8. Balo & túi đeo chéo may từ quần jean cũ
    {
      id: 'post_jean_backpack',
      title: 'Bộ Balo Mini & Túi Bao Tử Đeo Chéo Thêu Tay Từ Quần Jean Cũ',
      authorId: 'author_quynh_nga',
      authorName: 'Hoàng Quỳnh Nga (Upcycle Fashion)',
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      description: 'Tận dụng túi sau và vải denim cứng cáp của quần jean cũ tạo nên bộ ba balo mini và túi bao tử đeo chéo thêu cành lá mùa thu sang xịn mịn.',
      coverImage: '/assets/aistudio/image_6a61808e.png',
      additionalImages: ['/assets/aistudio/image_6a61808e.png'],
      model3DType: 'fabric_tote',
      materialsSourceDescription: 'Ống quần jean nam dày dặn và khóa kéo kim loại.',
      materialsSummary: ['2 quần jean cũ', 'Khóa kéo đồng', 'Chỉ thêu màu cam/vàng', 'Dây đai đeo'],
      toolsSummary: ['Kéo cắt vải', 'Máy may gia đình', 'Kim thêu'],
      difficulty: 'Khó',
      estimatedTime: '90 phút',
      recycledRatio: 90,
      type: '100_percent_recycled',
      dimensions: 'Balo: 24×22×10cm, Túi chéo: 28×14×8cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Rã thân quần và giữ nguyên túi sau',
          description: 'Cắt rời hai túi sau của quần jean còn nguyên đường viền chỉ nổi để làm mặt trước balo.',
          materialsNeeded: ['Quần jean'],
          toolsNeeded: ['Kéo cắt vải'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Thêu họa tiết hoa lá nghệ thuật',
          description: 'Dùng chỉ thêu màu cam đất và vàng nhạt thêu cành lá mùa thu lên túi sau quần jean.',
          materialsNeeded: ['Chỉ thêu'],
          toolsNeeded: ['Kim thêu'],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 3,
          title: 'May thân tròn và ráp khóa kéo',
          description: 'Cắt thân túi hình vòm tròn, may viền gân và ráp dây khóa kéo đồng hai chiều.',
          materialsNeeded: ['Khóa kéo'],
          toolsNeeded: ['Máy may'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 4,
          title: 'Lắp quai đeo vai và hoàn thiện',
          description: 'May quai xách tay trên đỉnh và hai quai đeo vai có khóa tăng giảm độ dài.',
          materialsNeeded: ['Dây quai'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Dùng kim may jean số 14 hoặc 16 để may đường chỉ chắc không gãy kim.'],
      likesCount: 145,
      commentsCount: 22,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 9. Đèn hoa để bàn từ chai nhựa, ống hút & LED
    {
      id: 'post_straw_lamp',
      title: 'Đèn Hoa Để Bàn Lung Linh Từ Chai Nhựa, Ống Hút & Đèn LED',
      authorId: 'author_quang_huy',
      authorName: 'Hoàng Quang Huy (CLB STEM)',
      authorAvatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
      description: 'Sự kết hợp hoàn hảo giữa cánh hoa từ cổ chai nhựa, cành hoa từ ống hút và bóng đèn LED 3V an toàn tạo nên luồng sáng ấm áp.',
      coverImage: '/assets/aistudio/image_0b1528c7.png',
      additionalImages: ['/assets/aistudio/image_0b1528c7.png'],
      model3DType: 'tin_lamp',
      materialsSourceDescription: 'Cổ chai nước suối cắt nhỏ và ống hút nhựa thu gom.',
      materialsSummary: ['2 cổ chai nhựa', '10 ống hút màu', 'Đèn LED cúc áo 3V'],
      toolsSummary: ['Kéo', 'Súng bắn keo', 'Dây kẽm mềm'],
      difficulty: 'Trung bình',
      estimatedTime: '40 phút',
      recycledRatio: 90,
      type: 'with_added_materials',
      dimensions: 'Cao 25cm × Tán hoa 16cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt cánh hoa từ cổ chai nhựa',
          description: 'Cắt rời phần phễu cổ chai, rọc 6 đường đều nhau và dùng tay vuốt nhẹ cho cánh hoa uốn cong xòe ra.',
          materialsNeeded: ['Cổ chai'],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Gắn cành hoa bằng ống hút',
          description: 'Lồng dây kẽm vào lòng ống hút nhựa để uốn cành cây theo dáng nghệ thuật mong muốn.',
          materialsNeeded: ['Ống hút', 'Dây kẽm'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Lắp bóng đèn LED và chân đế',
          description: 'Gắn bóng đèn LED 3V vào giữa nhụy hoa, nối dây điện áp thấp qua ống hút xuống hộp pin ở chân đế.',
          materialsNeeded: ['Đèn LED 3V', 'Hộp pin'],
          toolsNeeded: ['Keo nến'],
          safetyWarning: 'Chỉ sử dụng pin 3V an toàn, không cắm trực tiếp điện lưới 220V.',
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Ống hút có độ đàn hồi tốt và màu sắc sáng bóng phản chiếu ánh đèn rất đẹp.'],
      likesCount: 88,
      commentsCount: 7,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 10. Lồng đèn Trung thu từ chai nhựa
    {
      id: 'post_lantern',
      title: 'Lồng Đèn Trung Thu Quả Bí Sắc Đỏ Vàng Từ Chai Nhựa',
      authorId: 'author_ngoc_lan',
      authorName: 'Nguyễn Ngọc Lan',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Lồng đèn truyền thống rạch nan dọc ép phồng hình quả bí, phối màu đỏ vàng may mắn cùng nến LED điện tử.',
      coverImage: '/assets/aistudio/image_8f168f99.png',
      additionalImages: ['/assets/aistudio/image_8f168f99.png'],
      model3DType: 'tin_lamp',
      materialsSourceDescription: 'Chai nhựa mềm loại 500ml.',
      materialsSummary: ['1 chai nhựa', 'Sơn đỏ & vàng', 'Đèn LED cúc áo', 'Dây treo'],
      toolsSummary: ['Dao rọc giấy', 'Thước kẻ', 'Cọ vẽ'],
      difficulty: 'Dễ',
      estimatedTime: '25 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 12cm × Cao 18cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Kẻ các đường nan dọc thân chai',
          description: 'Dùng thước kẻ các đường thẳng song song cách nhau 1cm dọc thân chai, chừa lại 3cm ở hai đầu.',
          materialsNeeded: ['Chai nhựa'],
          toolsNeeded: ['Thước', 'Bút dạ'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Rọc nan và ép phồng thân đèn',
          description: 'Dùng dao rọc theo các đường kẻ. Sau đó ấn mạnh cổ chai xuống đáy để các nan nhựa bung phồng hình quả bí.',
          materialsNeeded: [],
          toolsNeeded: ['Dao rọc giấy'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Sơn màu và thả đèn LED',
          description: 'Sơn màu đỏ và viền vàng rực rỡ, gắn dây treo ở nắp chai và đặt đèn LED pin vào lòng lồng đèn.',
          materialsNeeded: ['Sơn', 'Đèn LED'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Nên dùng chai nhựa có gân mềm sẽ dễ ép phồng đều hơn chai nhựa cứng.'],
      likesCount: 65,
      commentsCount: 6,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 11. Đồ chơi con vật ngộ nghĩnh từ nắp chai
    {
      id: 'post_cap_animals',
      title: 'Vườn Bách Thú Mini Ngộ Nghĩnh Từ Nắp Chai Nhựa (Rùa, Cú, Ong, Cánh Cụt)',
      authorId: 'author_ha_my',
      authorName: 'Vũ Hà My (CLB Mầm Non Xanh)',
      authorAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      description: 'Dùng nắp chai nhựa sắc màu kết hợp xốp mút EVA tạo thành cả bộ sưu tập rùa con, cú mèo, chim cánh cụt và chú ong chăm chỉ.',
      coverImage: '/assets/aistudio/image_1d3b0c72.png',
      additionalImages: ['/assets/aistudio/image_1d3b0c72.png'],
      model3DType: 'cap_mosaic',
      materialsSourceDescription: 'Nắp chai nước ngọt thu gom nhiều màu.',
      materialsSummary: ['8 nắp chai nhiều màu', 'Xốp mút EVA màu', 'Mắt nhựa lắc'],
      toolsSummary: ['Kéo cắt giấy', 'Keo dán', 'Bút dạ đen'],
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Kích thước mỗi con: 4×4cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Phân loại nắp chai theo con vật',
          description: 'Chọn nắp màu xanh cho rùa, màu vàng cho ong, màu tím cho cú mèo và đen cho cánh cụt.',
          materialsNeeded: ['Nắp chai'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Cắt chân, cánh và đuôi từ xốp màu',
          description: 'Cắt 4 chân bơi và đầu rùa; cánh ong; tai nhọn và mỏ cú mèo trên xốp EVA.',
          materialsNeeded: ['Xốp EVA'],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 3,
          title: 'Dán mắt và ráp hoàn thiện',
          description: 'Dán các chi tiết vào mặt sau nắp chai, gắn mắt nhựa cử động trên mặt nắp chai.',
          materialsNeeded: ['Mắt lắc', 'Keo dán'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Các bé rất thích trò tự tay gắn mắt nhựa và đặt tên cho từng con vật.'],
      likesCount: 104,
      commentsCount: 18,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 12. Hộp bút vẽ ngôi sao
    {
      id: 'post_pen_star',
      title: 'Lọ Cắm Bút Trong Suốt Trang Trí Họa Tiết Ngôi Sao Lung Linh',
      authorId: 'author_khanh_huyen',
      authorName: 'Khánh Huyền (Design DIY)',
      authorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      description: 'Lọ cắm bút tối giản từ chai nhựa trong suốt, dán viền băng keo sọc chéo bảy sắc cầu vồng và vẽ các ngôi sao lấp lánh.',
      coverImage: '/assets/aistudio/image_1ae66dd9.png',
      additionalImages: ['/assets/aistudio/image_1ae66dd9.png'],
      model3DType: 'pen_holder',
      materialsSourceDescription: 'Chai nước khoáng trong suốt 500ml.',
      materialsSummary: ['1 chai nhựa trong', 'Băng dính viền 7 màu', 'Bút vẽ kính dạ dầu'],
      toolsSummary: ['Kéo', 'Giấy nhám mịn'],
      difficulty: 'Dễ',
      estimatedTime: '15 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 6.5cm × Cao 12cm',
      guideStatus: 'completed',
      imageStatus: 'completed',
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt ngang thân chai nhựa',
          description: 'Cắt thân chai ở độ cao 12cm, mài mịn mép cắt bằng giấy nhám.',
          materialsNeeded: ['Chai nhựa'],
          toolsNeeded: ['Kéo', 'Giấy nhám'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Dán dải băng viền cầu vồng',
          description: 'Dán một dải băng keo màu quanh miệng chai để bảo vệ tay và tăng vẻ tươi vui.',
          materialsNeeded: ['Băng dính viền'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 3,
          title: 'Vẽ ngôi sao và chấm sao',
          description: 'Dùng bút dạ dầu vẽ các ngôi sao lớn nhỏ và các chấm sao xung quanh thân chai.',
          materialsNeeded: ['Bút dạ'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'body'
        }
      ],
      tipsAndLearnings: ['Mực bút dạ dầu bám rất bền trên nhựa PET và không bị lem khi chạm vào.'],
      likesCount: 46,
      commentsCount: 4,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // --- CÁC MỤC CÓ HÌNH ẢNH NHƯNG CHƯA CẬP NHẬT CÁCH LÀM (guideStatus: 'pending') ---
    // 13. Giá cắm bàn chải từ cổ chai
    {
      id: 'post_toothbrush_holder',
      title: 'Giá Cắm Bàn Chải Đánh Răng Thông Minh Từ Cổ & Nắp Chai Nhựa',
      authorId: 'author_cong_dong',
      authorName: 'Cộng Đồng Đóng Góp',
      authorAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      description: 'Ý tưởng giữ bàn chải đánh răng khô ráo, vệ sinh trong nhà tắm bằng cách tận dụng phần cổ chai nhựa có nắp ren dán tường.',
      coverImage: '/assets/aistudio/image_28882df0.png',
      additionalImages: ['/assets/aistudio/image_28882df0.png'],
      model3DType: 'pen_holder',
      materialsSourceDescription: 'Cổ chai nước ngọt và nắp vặn ren.',
      materialsSummary: ['2 cổ chai nhựa', 'Băng dính 2 mặt dán tường'],
      toolsSummary: ['Dao rọc giấy', 'Kéo'],
      difficulty: 'Dễ',
      estimatedTime: 'Chưa cập nhật',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Kích thước tiêu chuẩn cổ chai Ø3cm',
      guideStatus: 'pending', // ⚠️ Chưa cập nhật cách làm
      imageStatus: 'completed',
      steps: [], // Chưa cập nhật cách làm
      tipsAndLearnings: ['Đang chờ cộng đồng đóng góp quy trình chế tạo chi tiết từng bước!'],
      likesCount: 31,
      commentsCount: 3,
      comments: [
        {
          id: 'c_tb_1',
          userId: 'user_default',
          userName: 'Sáng Tạo Xanh',
          userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
          text: 'Ý tưởng rất tiện lợi cho phòng tắm nhỏ, hy vọng sớm có bạn đăng bài hướng dẫn chi tiết!',
          createdAt: '2026-11-06 11:00',
          likes: 2
        }
      ],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 14. Kệ để giày dép từ thùng carton
    {
      id: 'post_shoe_rack',
      title: 'Kệ Đựng Giày Dép Nhiều Tầng Dạng Module Tam Giác Từ Bìa Carton',
      authorId: 'author_cong_dong',
      authorName: 'Cộng Đồng Đóng Góp',
      authorAvatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
      description: 'Kệ giày xếp hình module tam giác tổ ong vững chãi, tận dụng các tấm bìa carton cứng cáp giúp tiết kiệm không gian lối vào nhà.',
      coverImage: '/assets/aistudio/image_7e7630d4.png',
      additionalImages: ['/assets/aistudio/image_7e7630d4.png'],
      model3DType: 'desk_organizer',
      materialsSourceDescription: 'Thùng carton đựng TV hoặc tủ lạnh có độ dày 3-5 lớp.',
      materialsSummary: ['Tấm bìa carton lớn', 'Băng dính viền màu', 'Keo dán chắc'],
      toolsSummary: ['Dao rọc giấy', 'Thước dài'],
      difficulty: 'Trung bình',
      estimatedTime: 'Chưa cập nhật',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Cao 80cm × Rộng 50cm × Sâu 30cm',
      guideStatus: 'pending', // ⚠️ Chưa cập nhật cách làm
      imageStatus: 'completed',
      steps: [], // Chưa cập nhật cách làm
      tipsAndLearnings: ['Đang chờ thành viên cộng đồng bổ sung bản vẽ kích thước chi tiết!'],
      likesCount: 45,
      commentsCount: 5,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 15. Đèn chùm từ bình 5L & thìa nhựa
    {
      id: 'post_spoon_chandelier',
      title: 'Đèn Chùm Nghệ Thuật Quả Thông Từ Bình 5L & Hàng Trăm Thìa Nhựa',
      authorId: 'author_cong_dong',
      authorName: 'Cộng Đồng Đóng Góp',
      authorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      description: 'Mô hình đèn thả trần hình quả thông tuyệt đẹp ghép từ hàng trăm đầu muỗng nhựa dùng một lần ốp quanh bình nước 5L cắt đáy.',
      coverImage: '/assets/aistudio/image_d0029fe5.png',
      additionalImages: ['/assets/aistudio/image_d0029fe5.png'],
      model3DType: 'tin_lamp',
      materialsSourceDescription: 'Bình nước tinh khiết 5L và thìa nhựa ăn tiệc.',
      materialsSummary: ['1 bình 5L', '100+ muỗng nhựa', 'Đui đèn LED dây'],
      toolsSummary: ['Kéo', 'Súng bắn keo'],
      difficulty: 'Khó',
      estimatedTime: 'Chưa cập nhật',
      recycledRatio: 90,
      type: 'with_added_materials',
      dimensions: 'Đường kính 24cm × Cao 36cm',
      guideStatus: 'pending', // ⚠️ Chưa cập nhật cách làm
      imageStatus: 'completed',
      steps: [], // Chưa cập nhật cách làm
      tipsAndLearnings: ['Cần lưu ý sử dụng bóng đèn LED tỏa nhiệt thấp để không làm biến dạng muỗng nhựa.'],
      likesCount: 58,
      commentsCount: 7,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 16. Mô hình con vật từ nắp chai & hộp sữa chua
    {
      id: 'post_yogurt_animal',
      title: 'Mô Hình Sinh Vật Vui Nhộn Từ Nắp Chai & Hộp Sữa Chua Uống',
      authorId: 'author_cong_dong',
      authorName: 'Cộng Đồng Đóng Góp',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Sáng tạo các con thú ngộ nghĩnh kết hợp giữa nắp chai đa sắc và vỏ hộp sữa chua uống rỗng cho tiết học thủ công mầm non.',
      coverImage: '/assets/aistudio/image_2b6f5499.png',
      additionalImages: ['/assets/aistudio/image_2b6f5499.png'],
      model3DType: 'cap_mosaic',
      materialsSourceDescription: 'Vỏ hộp sữa chua uống và nắp chai nhựa.',
      materialsSummary: ['Vỏ hộp sữa chua', 'Nắp chai', 'Mắt giả'],
      toolsSummary: ['Keo dán', 'Kéo'],
      difficulty: 'Dễ',
      estimatedTime: 'Chưa cập nhật',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Cao 10cm × Rộng 6cm',
      guideStatus: 'pending', // ⚠️ Chưa cập nhật cách làm
      imageStatus: 'completed',
      steps: [], // Chưa cập nhật cách làm
      tipsAndLearnings: ['Đang chờ cộng đồng chia sẻ các bước tạo hình!'],
      likesCount: 28,
      commentsCount: 2,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // --- CÁC MỤC CÓ CÁCH LÀM NHƯNG CHƯA CẬP NHẬT HÌNH ẢNH (imageStatus: 'pending') ---
    // 17. Bảng học ghép chữ cái từ nắp chai
    {
      id: 'post_alphabet_caps',
      title: 'Bảng Học Ghép Chữ Cái & Số Tính Toán Cho Bé Từ Nắp Chai Nhựa',
      authorId: 'author_minh_chau',
      authorName: 'Cô Giáo Minh Châu',
      authorAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      description: 'Viết chữ cái hoặc con số lên mặt ngoài nắp chai để các bé ghép vần, làm phép tính cộng trừ hoặc chơi trò chơi "tìm cặp giống nhau" bằng cách úp ngược nắp lại.',
      coverImage: '', // Chưa cập nhật hình ảnh
      additionalImages: [],
      model3DType: 'cap_mosaic',
      materialsSourceDescription: 'Nắp chai nước suối cùng kích cỡ thu gom từ các lớp học.',
      materialsSummary: ['30 nắp chai nhựa', 'Bút dạ dầu', 'Hộp carton làm khay chứa'],
      toolsSummary: ['Bút dạ đen ngòi to'],
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Khay đựng: 30×20cm, 30 nắp chai',
      guideStatus: 'completed',
      imageStatus: 'pending', // 🖼️ Chưa cập nhật hình ảnh
      steps: [
        {
          stepNumber: 1,
          title: 'Thu gom và vệ sinh nắp chai',
          description: 'Chuẩn bị 25-30 nắp chai nhựa cùng kích cỡ, rửa sạch bằng nước ấm xà phòng và lau khô ráo hoàn toàn.',
          materialsNeeded: ['30 nắp chai'],
          toolsNeeded: ['Khăn lau'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Viết bảng chữ cái và chữ số',
          description: 'Dùng bút dạ dầu viết rõ ràng từng chữ cái A, Ă, Â, B, C... và các con số từ 0 đến 9 lên mặt phẳng của nắp chai.',
          materialsNeeded: ['Nắp chai'],
          toolsNeeded: ['Bút dạ dầu'],
          isCompleted: true,
          highlightPart: 'top'
        },
        {
          stepNumber: 3,
          title: 'Tổ chức trò chơi ghép chữ hoặc tìm cặp',
          description: 'Úp ngược các nắp chai xuống bàn cho bé chơi trò lật nắp tìm cặp số giống nhau hoặc ghép nắp thành các từ có nghĩa.',
          materialsNeeded: [],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Nên dùng bút dạ dầu chống nước để chữ không bị nhòe khi các bé cầm nắm thường xuyên.'],
      likesCount: 54,
      commentsCount: 6,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 18. Đệm lót chân bàn ghế từ nắp chai
    {
      id: 'post_chair_caps',
      title: 'Đệm Lót Chân Bàn Ghế Chống Trầy Xước Sàn Nhà Từ Nắp Chai',
      authorId: 'author_duc_tri',
      authorName: 'Ngô Đức Trí',
      authorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      description: 'Nếu chân bàn ghế làm từ kim loại khi di chuyển dễ làm trầy xước sàn gỗ hoặc gạch men, hãy dán hoặc lồng nắp chai nhựa vào dưới chân ghế như một lớp đệm lót êm ái.',
      coverImage: '', // Chưa cập nhật hình ảnh
      additionalImages: [],
      model3DType: 'planter',
      materialsSourceDescription: 'Nắp chai nước ngọt có đường kính vừa vặn với ống chân ghế kim loại.',
      materialsSummary: ['4 nắp chai nhựa', 'Miếng xốp bọt biển hoặc keo dán 2 mặt'],
      toolsSummary: ['Kéo', 'Keo dán'],
      difficulty: 'Dễ',
      estimatedTime: '10 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Đường kính 3.2cm × Độ dày 1.2cm',
      guideStatus: 'completed',
      imageStatus: 'pending', // 🖼️ Chưa cập nhật hình ảnh
      steps: [
        {
          stepNumber: 1,
          title: 'Đo đường kính chân ghế',
          description: 'Kiểm tra kích thước chân bàn hoặc chân ghế, chọn 4 nắp chai nhựa có đường kính vừa khít.',
          materialsNeeded: ['4 nắp chai'],
          toolsNeeded: ['Thước đo'],
          isCompleted: true,
          highlightPart: 'bottom'
        },
        {
          stepNumber: 2,
          title: 'Dán lớp đệm giảm chấn',
          description: 'Cắt 1 miếng nỉ hoặc xốp tròn đặt vào lòng nắp chai để tăng độ êm và giảm tiếng ồn khi kéo ghế.',
          materialsNeeded: ['Miếng nỉ', 'Keo'],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 3,
          title: 'Lồng cố định vào 4 chân ghế',
          description: 'Lồng nắp chai bọc dưới đáy mỗi chân ghế, có thể dán thêm keo nến nếu cần giữ thật chặt.',
          materialsNeeded: [],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'bottom'
        }
      ],
      tipsAndLearnings: ['Giải pháp cực kỳ tiết kiệm, giúp kéo ghế êm ru không một tiếng động.'],
      likesCount: 39,
      commentsCount: 4,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 19. Chong chóng xoay gió từ chai nhựa
    {
      id: 'post_pinwheel',
      title: 'Chong Chóng Tái Chế Xoay Tít Trong Gió Từ Vỏ Chai Nhựa',
      authorId: 'author_quang_huy',
      authorName: 'Hoàng Quang Huy (CLB STEM)',
      authorAvatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
      description: 'Làm chong chóng tái chế từ vỏ chai nhựa đón gió quay tít trước ban công, vừa là món đồ chơi thú vị vừa đuổi chim bảo vệ cây cảnh.',
      coverImage: '', // Chưa cập nhật hình ảnh
      additionalImages: [],
      model3DType: 'toy_car',
      materialsSourceDescription: 'Vỏ chai nước khoáng rỗng.',
      materialsSummary: ['1 chai nhựa', '1 que tre 40cm', 'Đinh nhỏ làm trục', 'Nắp chai'],
      toolsSummary: ['Dao rọc giấy', 'Kéo', 'Búa gõ đinh'],
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Sải cánh chong chóng 20cm',
      guideStatus: 'completed',
      imageStatus: 'pending', // 🖼️ Chưa cập nhật hình ảnh
      steps: [
        {
          stepNumber: 1,
          title: 'Cắt bỏ phần đáy chai',
          description: 'Dùng dao cắt bỏ phần đáy chai ở khoảng cách 5cm tính từ đáy lên.',
          materialsNeeded: ['1 chai nhựa'],
          toolsNeeded: ['Dao rọc'],
          isCompleted: true,
          highlightPart: 'cut_line'
        },
        {
          stepNumber: 2,
          title: 'Cắt và uốn cánh chong chóng',
          description: 'Rọc thân chai thành 4 hoặc 6 cánh bằng nhau, sau đó bẻ nghiêng mỗi cánh 45 độ theo cùng một chiều để đón gió.',
          materialsNeeded: [],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 3,
          title: 'Lắp trục quay vào cọc tre',
          description: 'Đục lỗ ở tâm nắp chai, xỏ đinh qua nắp chai vào đầu cọc tre (chừa khe hở 2mm để chong chóng quay tự do).',
          materialsNeeded: ['Đinh', 'Cọc tre'],
          toolsNeeded: ['Búa'],
          isCompleted: true,
          highlightPart: 'assembly'
        }
      ],
      tipsAndLearnings: ['Bẻ cánh nghiêng đều góc 45 độ thì gió nhẹ chong chóng cũng xoay rất nhanh.'],
      likesCount: 49,
      commentsCount: 5,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    },

    // 20. Rèm cửa vintage từ hàng trăm nắp chai
    {
      id: 'post_curtain_caps',
      title: 'Rèm Cửa Phong Cách Retro Tái Chế Từ Hàng Trăm Nắp Chai Nhựa',
      authorId: 'author_lan_anh',
      authorName: 'Đỗ Lan Anh',
      authorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
      description: 'Xâu chuỗi hàng trăm nắp chai nhiều màu sắc bằng dây cước trong suốt tạo thành tấm rèm che cửa phòng rực rỡ và phát ra âm thanh vui tai khi có gió thoảng.',
      coverImage: '', // Chưa cập nhật hình ảnh
      additionalImages: [],
      model3DType: 'cap_mosaic',
      materialsSourceDescription: 'Nắp chai tích lũy từ trường học và khu dân cư.',
      materialsSummary: ['200+ nắp chai nhựa', 'Cuộn cước câu cá', 'Thanh gỗ treo rèm'],
      toolsSummary: ['Dùi nhọn hơ nóng', 'Kéo'],
      difficulty: 'Trung bình',
      estimatedTime: '2 giờ',
      recycledRatio: 100,
      type: '100_percent_recycled',
      dimensions: 'Rộng 80cm × Dài 180cm (12 sợi xâu)',
      guideStatus: 'completed',
      imageStatus: 'pending', // 🖼️ Chưa cập nhật hình ảnh
      steps: [
        {
          stepNumber: 1,
          title: 'Dùi 2 lỗ đối xứng trên vành nắp chai',
          description: 'Hơ nóng đầu dùi trên ngọn nến, đục 2 lỗ đối xứng ở mép trên và mép dưới của từng chiếc nắp chai.',
          materialsNeeded: ['Nắp chai'],
          toolsNeeded: ['Dùi nhọn'],
          safetyWarning: 'Cẩn thận lửa nến và đầu dùi nóng, tránh chạm vào da.',
          isCompleted: true,
          highlightPart: 'body'
        },
        {
          stepNumber: 2,
          title: 'Xâu chuỗi nắp chai theo hoa văn màu',
          description: 'Luồn dây cước qua từng nắp chai, xen kẽ màu sắc theo sở thích, thắt nút sau mỗi nắp để cố định khoảng cách 2cm.',
          materialsNeeded: ['Dây cước'],
          toolsNeeded: ['Kéo'],
          isCompleted: true,
          highlightPart: 'assembly'
        },
        {
          stepNumber: 3,
          title: 'Buộc các sợi lên thanh rèm',
          description: 'Buộc các sợi nắp chai lên thanh treo gỗ và treo lên khung cửa sổ hoặc cửa ra vào.',
          materialsNeeded: ['Thanh gỗ'],
          toolsNeeded: [],
          isCompleted: true,
          highlightPart: 'top'
        }
      ],
      tipsAndLearnings: ['Có thể sắp xếp nắp chai theo sơ đồ tạo thành hình trái tim hoặc cầu vồng rất ấn tượng.'],
      likesCount: 62,
      commentsCount: 8,
      comments: [],
      visibility: 'public',
      createdAt: '2026-11-06'
    }
  ];

  return {
    users: [defaultUser, adminUser],
    adminAuditLogs: [],
    materials: initialMaterials,
    projects: [
      {
        id: 'proj_toy_car',
        userId: 'user_default',
        title: 'Xe Ô Tô Đồ Chơi Từ Chai Nhựa & Nắp Chai',
        description: 'Dự án chế tạo xe ô tô 4 bánh lăn từ chai nước suối 500ml và 4 nắp chai cho bé.',
        status: 'in_progress',
        progressPercent: 60,
        currentStepIndex: 2,
        coverImage: '/assets/aistudio/image_9cb5bb6a.png',
        model3DType: 'toy_car',
        craftData: {
          id: 'craft_toy_car',
          title: 'Xe Đồ Chơi Tái Chế Từ Chai Nhựa & 4 Nắp Chai',
          description: 'Tận dụng 100% vỏ chai nhựa và nắp chai làm xe ô tô đồ chơi chuyển động linh hoạt.',
          category: 'stem_toy',
          categoryLabel: 'Đồ chơi sáng tạo',
          type: '100_percent_recycled',
          imageUrl: '/assets/aistudio/image_9cb5bb6a.png',
          model3DType: 'toy_car',
          difficulty: 'Dễ',
          estimatedTime: '20 phút',
          recycledMaterialRatio: 100,
          materialsUsed: [
            { name: 'Chai nhựa PET 500ml', fromCurrentInventory: true, role: 'Khung gầm và thân xe' },
            { name: '4 nắp chai nhựa', fromCurrentInventory: true, role: '4 bánh xe lăn' },
            { name: '2 que tăm tre', fromCurrentInventory: true, role: 'Trục quay bánh xe' }
          ],
          materialsNeededExtra: [],
          toolsRequired: ['Kéo', 'Dùi nhọn', 'Súng bắn keo'],
          dimensionsFinished: { lengthCm: 21, widthCm: 10, heightCm: 8 },
          whySuitable: 'Chai nhựa nhẹ, dễ khoét lỗ; nắp chai tròn làm bánh xe lăn êm ái trên sàn.',
          guideStatus: 'completed',
          imageStatus: 'completed',
          steps: [
            {
              stepNumber: 1,
              title: 'Khoét cửa sổ mui xe đua trên thân chai PET',
              description: 'Dùng kéo cắt bỏ 1 ô chữ nhật trên lưng chai tạo khoang lái cho xe đồ chơi.',
              materialsNeeded: ['Chai nhựa PET 500ml đã rửa sạch'],
              toolsNeeded: ['Kéo thủ công', 'Bút dạ'],
              highlightPart: 'cut_line',
              isCompleted: true,
            },
            {
              stepNumber: 2,
              title: 'Xuyên 2 que tăm tre làm trục quay bánh xe',
              description: 'Dùi 4 lỗ đối xứng hai bên hông chai và luồn 2 trục tre xuyên ngang thân.',
              materialsNeeded: ['2 que tăm tre'],
              toolsNeeded: ['Dùi nhọn'],
              safetyWarning: 'Cẩn thận khi dùi lỗ nhựa, giữ tay xa mũi dùi.',
              highlightPart: 'body',
              isCompleted: true,
            },
            {
              stepNumber: 3,
              title: 'Gắn 4 nắp chai làm bánh xe và dán trang trí',
              description: 'Đục lỗ tâm 4 nắp chai, gắn vào đầu trục tre rồi cố định nhẹ bằng keo nến để bánh quay trơn tru.',
              materialsNeeded: ['4 nắp chai nhựa', 'Keo nến'],
              toolsNeeded: ['Súng bắn keo'],
              highlightPart: 'assembly',
              isCompleted: false,
            },
          ]
        },
        inputMaterials: [initialMaterials[0], initialMaterials[1]],
        finishedPhotos: [],
        userNotes: 'Đã hoàn thành lắp 4 bánh xe vào 2 trục tre. Chiều nay sẽ khoét mui xe và dán ngôi sao.',
        createdAt: '2026-11-06',
        updatedAt: '2026-11-06'
      }
    ],
    communityPosts: initialCommunityPosts,
    userLikes: {
      user_default: ['post_toy_car', 'post_planter_horizontal', 'post_fish_bag']
    },
    savedProjects: {
      user_default: ['post_toy_car', 'post_bunny_pot', 'post_jean_backpack']
    }
  };
}
