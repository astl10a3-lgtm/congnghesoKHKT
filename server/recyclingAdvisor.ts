import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { CraftProduct, CraftStep, MaterialItem } from './db.ts';
import {
  CONCEPT_3D_PREVIEW_DISCLAIMER,
  PROHIBITED_METHODS_NOTICE,
  type CraftPreparationSpec,
  type CraftingSuitabilityStatus,
  type ExpectedResultSpec,
  type FinalInspectionItem,
  type MaterialReusabilityAnalysis,
  type RecyclingAdvisorInput,
  type SafetyComplianceReport,
} from '../src/types/recycling.ts';

import {
  clearModelCooldown,
  isModelInCooldown,
  markModelCooldown,
} from './geminiHealth.ts';

const GEMINI_ADVISOR_MODEL = 'gemini-4-hydrogen';
const GEMINI_ADVISOR_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

// Strictly banned hazards across titles, descriptions, tools, materials, and steps
const PROHIBITED_HAZARD_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern:
      /(đốt\s*nhựa|đốt\s*chảy|nung\s*chảy|hơ\s*lửa|khò\s*lửa|khò\s*nhiệt|ngọn\s*lửa\s*trần|burn\s*plastic|melt\s*plastic|open\s*flame)/i,
    reason: 'Phương pháp đốt hoặc nung chảy vật liệu có nguy cơ cháy nổ và phát sinh khí độc.',
  },
  {
    pattern:
      /(axit|acid|hóa\s*chất\s*độc|dung\s*môi\s*công\s*nghiệp|xăng\s*thơm|aceton|axeton|xylene|toluene|tẩy\s*rửa\s*công\s*nghiệp|thủy\s*ngân|mercury)/i,
    reason: 'Sử dụng axit, dung môi hoặc hóa chất độc hại không an toàn cho chế tác thủ công.',
  },
  {
    pattern:
      /(đập\s*vỡ\s*thủy\s*tinh|đập\s*chai|cắt\s*thủy\s*tinh|cắt\s*kính|nứt\s*chai\s*bằng\s*lửa|dây\s*cháy\s*cắt\s*chai|shatter\s*glass|cut\s*glass\s*bottle)/i,
    reason: 'Cắt hoặc làm vỡ thủy tinh tiềm ẩn nguy cơ gây thương tích nặng từ mảnh sắc.',
  },
  {
    pattern:
      /(tháo\s*pin|cắt\s*pin|pin\s*lithium|bẻ\s*pin|đập\s*mạch\s*điện|bóng\s*đèn\s*huỳnh\s*quang|amiăng|asbestos)/i,
    reason: 'Tháo dỡ pin, linh kiện điện tử hoặc vật liệu nguy hại bị nghiêm cấm trong chế tác DIY.',
  },
  {
    pattern:
      /(máy\s*cưa\s*xích|máy\s*mài\s*góc|máy\s*cắt\s*sắt|máy\s*hàn\s*hồ\s*quang|máy\s*tiện\s*công\s*nghiệp|angle\s*grinder|chainsaw)/i,
    reason: 'Thiết bị cơ khí công nghiệp không phù hợp với thủ công gia đình và học đường.',
  },
];

// Tools / materials that require explicit adult supervision callouts
const ADULT_SUPERVISION_PATTERN =
  /(dao\s*rọc\s*giấy|dao\s*nhọn|dao\s*trổ|kéo\s*cắt\s*tôn|súng\s*bắn\s*keo|keo\s*nến|dùi\s*nhọn|dùi\s*lỗ|đục\s*lỗ|kim\s*loại|nhôm|thiếc|sắt|thủy\s*tinh|kìm|cưa\s*tay)/i;

// Indicators of hazardous / unusable source materials
const UNSAFE_MATERIAL_TEXT_PATTERN =
  /(pin\s*cũ|lithium|ắc\s*quy|hóa\s*chất|thuốc\s*trừ\s*sâu|thuốc\s*diệt\s*cỏ|nhớt\s*thải|kim\s*tiêm|y\s*tế|bóng\s*đèn\s*huỳnh\s*quang|amiăng|vỡ\s*nát|mảnh\s*vỡ\s*sắc|rò\s*rỉ\s*axit)/i;

export function analyzeMaterialReusability(
  input: RecyclingAdvisorInput
): MaterialReusabilityAnalysis {
  const name = (input.materialName || '').trim();
  const category = (input.category || 'other').toLowerCase();
  const detail = (input.materialDetail || '').trim();
  const condition = (input.condition || '').trim();
  const status = (input.status || '').trim();
  const confidence =
    typeof input.materialConfidence === 'number' && Number.isFinite(input.materialConfidence)
      ? Math.max(0, Math.min(1, input.materialConfidence))
      : detail && detail !== 'Unknown'
      ? 0.72
      : 0.35;

  const h = Number(input.dimensions?.heightCm || 0);
  const w = Number(input.dimensions?.widthCm || 0);
  const hasValidDimensions = Number.isFinite(h) && h > 0 && Number.isFinite(w) && w > 0;
  const combinedText = `${name} ${condition} ${detail} ${input.userNotes || ''}`;

  const missingInformation: string[] = [];
  if (!name || /chưa\s*rõ|unknown/i.test(name)) {
    missingInformation.push('Chưa xác định rõ tên vật thể đầu vào.');
  }
  if (!detail || detail === 'Unknown') {
    if (category === 'other' || confidence < 0.45) {
      missingInformation.push('Chưa xác định đủ căn cứ về nhóm vật liệu cụ thể.');
    }
  }
  if (!condition || /chưa\s*rõ|chưa\s*kiểm\s*tra|unknown/i.test(condition)) {
    missingInformation.push('Chưa có mô tả rõ về tình trạng sạch/nguyên vẹn của vật thể.');
  }
  if (!hasValidDimensions) {
    missingInformation.push('Thiếu kích thước thực tế (chiều cao, chiều rộng hoặc đường kính).');
  }

  // 1. Check strictly unsafe sources first
  if (
    status === 'not_recommended' ||
    category === 'electronic' ||
    category === 'organic' ||
    UNSAFE_MATERIAL_TEXT_PATTERN.test(combinedText) ||
    (category === 'glass' && /(vỡ|nứt|mẻ\s*cạnh)/i.test(combinedText))
  ) {
    return {
      materialType: detail && detail !== 'Unknown' ? `${detail} (${name || category})` : name || category,
      materialCategory: category,
      materialConfidence: confidence,
      objectCondition: condition || 'Vật liệu tiềm ẩn rủi ro hoặc không phù hợp tái chế thủ công',
      reusableComponents: [],
      materialLimitations: [
        category === 'electronic'
          ? 'Rác thải điện tử có mạch điện, tụ điện hoặc pin tiềm ẩn rủi ro chập cháy và kim loại nặng.'
          : category === 'organic'
          ? 'Rác thải hữu cơ dễ phân hủy, ẩm mốc; phù hợp ủ phân hơn chế tác đồ dùng.'
          : 'Vật liệu có dấu hiệu nhiễm hóa chất, nứt vỡ hoặc nằm trong nhóm khuyến cáo không tái chế thủ công.',
      ],
      suitabilityForManualCrafting: 'unsafe',
      suitabilityLabel: 'Không an toàn cho chế tác thủ công',
      suitabilitySummary:
        'Hệ thống không đề xuất cắt ghép thủ công vật liệu này để đảm bảo an toàn. Hãy phân loại và chuyển tới điểm thu gom chuyên trách.',
      missingInformation,
      recommendedSafeActions: [
        'Không cắt, mở, đốt hoặc tiếp xúc trực tiếp phần bên trong nếu nghi ngờ có hóa chất/pin.',
        'Đóng gói riêng và mang đến điểm thu hồi rác thải nguy hại / điện tử địa phương.',
      ],
      requiresAdultSupervision: true,
    };
  }

  // 2. Check insufficient data honestly — never fabricate reusability!
  const isUnknownMaterial = (!detail || detail === 'Unknown') && (category === 'other' || confidence < 0.4);
  if (isUnknownMaterial || (!hasValidDimensions && confidence < 0.5) || missingInformation.length >= 3) {
    return {
      materialType: detail && detail !== 'Unknown' ? detail : name || 'Chưa xác định',
      materialCategory: category,
      materialConfidence: confidence,
      objectCondition: condition || 'Chưa đủ dữ liệu đánh giá tình trạng vật lý',
      reusableComponents:
        input.components && input.components.length > 0
          ? input.components.map((c) => `${c.name} (cần kiểm tra trực tiếp trước khi dùng)`)
          : [],
      materialLimitations: [
        'Chưa đủ dữ liệu về bản chất vật liệu, độ bền thành vách hoặc tiền sử chứa chất bên trong.',
        'Không thể khẳng định vật thể an toàn để tái sử dụng thủ công khi thiếu thông tin kiểm chứng.',
      ],
      suitabilityForManualCrafting: 'insufficient_data',
      suitabilityLabel: 'Chưa đủ dữ liệu để kết luận',
      suitabilitySummary:
        'Không đủ căn cứ để khẳng định vật liệu tái sử dụng an toàn. Vui lòng bổ sung loại vật liệu, kích thước và tình trạng thực tế trước khi thực hiện.',
      missingInformation,
      recommendedSafeActions: [
        'Chụp ảnh rõ nét ký hiệu tái chế (nếu có) ở đáy vật thể trong môi trường đủ sáng.',
        'Xác nhận vật thể không từng đựng hóa chất độc hại hoặc dầu nhớt công nghiệp.',
        'Đo sơ bộ chiều cao/chiều rộng hoặc dùng thước tham chiếu ở bước hiệu chuẩn.',
      ],
      requiresAdultSupervision: true,
    };
  }

  // 3. Build evidence-based components & limitations per material type
  const componentsFromRecon =
    Array.isArray(input.components) && input.components.length > 0
      ? input.components.map((c) => c.name)
      : [];

  let reusableComponents: string[] = [...componentsFromRecon];
  const materialLimitations: string[] = [];
  let suitability: CraftingSuitabilityStatus = 'suitable';
  let requiresAdultSupervision = false;

  if (category === 'plastic' || ['PET', 'HDPE', 'PP', 'PVC', 'LDPE', 'PS', 'Other Plastics'].includes(detail)) {
    if (reusableComponents.length === 0) {
      reusableComponents = ['Thân vỏ chính', 'Phần đáy chịu lực', 'Nắp và cổ chai (nếu có)'];
    }
    materialLimitations.push(
      'Nhựa dễ biến dạng hoặc sinh hơi độc nếu tiếp xúc nhiệt cao — tuyệt đối không hơ lửa hay đựng nước sôi.'
    );
    if (detail === 'PVC' || detail === 'PS') {
      materialLimitations.push(
        `Nhóm nhựa ${detail} không dùng để đựng thực phẩm/nước uống trực tiếp; chỉ dùng làm đồ trang trí hoặc đựng đồ khô.`
      );
      suitability = 'conditional';
    }
    materialLimitations.push('Mép nhựa sau khi cắt bằng kéo/dao có thể hơi sắc, cần dán viền hoặc mài mịn.');
    requiresAdultSupervision = true;
  } else if (category === 'metal' || detail === 'Aluminum' || detail === 'Steel') {
    if (reusableComponents.length === 0) {
      reusableComponents = ['Thân ống kim loại liền khối', 'Đáy cứng đứng vững'];
    }
    materialLimitations.push(
      'Mép cắt kim loại rất sắc bén, có nguy cơ gây đứt tay nếu không gập mép hoặc bọc băng keo bảo vệ.'
    );
    materialLimitations.push('Vật liệu dẫn nhiệt tốt, chỉ dùng với đèn LED nguội 3V, không dùng nến đốt thật.');
    suitability = 'conditional';
    requiresAdultSupervision = true;
  } else if (category === 'glass' || detail === 'Glass') {
    if (reusableComponents.length === 0) {
      reusableComponents = ['Thân lọ/chai nguyên khối (chỉ trang trí bề mặt ngoài)', 'Miệng bình nguyên vẹn'];
    }
    materialLimitations.push(
      'Thủy tinh nặng và dễ vỡ nếu rơi va đập; KHÔNG tự ý cắt, khoan hoặc đun nóng làm nứt thủy tinh tại nhà.'
    );
    suitability = 'conditional';
    requiresAdultSupervision = true;
  } else if (category === 'paper' || detail === 'Cardboard' || detail === 'Paper') {
    if (reusableComponents.length === 0) {
      reusableComponents = ['Các mặt phẳng carton chịu lực', 'Nếp gấp nắp hộp và vách ngăn'];
    }
    materialLimitations.push(
      'Giấy và bìa carton dễ thấm nước, ẩm mốc và giảm độ cứng khi gặp môi trường ẩm ướt.'
    );
    materialLimitations.push('Chỉ phù hợp làm đồ khô (kệ bàn, hộp đựng, mô hình trang trí).');
  } else if (category === 'fabric' || detail === 'Fabric' || detail === 'Denim') {
    if (reusableComponents.length === 0) {
      reusableComponents = ['Mảng vải chính còn chắc sợi', 'Đường viền/túi sẵn có (nếu có)'];
    }
    materialLimitations.push(
      'Mép vải dễ tưa sợi sau khi cắt; nên gấp mép, khâu vắt hoặc dán keo vải an toàn.'
    );
  } else {
    if (reusableComponents.length === 0) {
      reusableComponents = ['Phần thân cấu trúc chính còn nguyên vẹn'];
    }
    materialLimitations.push('Cần kiểm tra độ bền cơ học và độ sạch thực tế trước khi lắp ghép.');
    suitability = 'conditional';
  }

  if (Array.isArray(input.deformations) && input.deformations.length > 0) {
    materialLimitations.push(
      `Vật thể có dấu hiệu biến dạng (${input.deformations.join(', ')}), có thể làm giảm độ vững của sản phẩm.`
    );
    if (suitability === 'suitable') suitability = 'conditional';
  }

  if (status === 'needs_special_handling') {
    suitability = 'conditional';
    requiresAdultSupervision = true;
  }

  if (Array.isArray(input.uncertainties) && input.uncertainties.length > 0 && confidence < 0.65) {
    materialLimitations.push(...input.uncertainties.slice(0, 2));
    if (suitability === 'suitable') suitability = 'conditional';
  }

  const suitabilityLabel =
    suitability === 'suitable'
      ? 'Phù hợp chế tác thủ công an toàn'
      : 'Có thể tái sử dụng có điều kiện (cần lưu ý an toàn)';

  const suitabilitySummary =
    suitability === 'suitable'
      ? `Vật liệu ${detail || name} (${hasValidDimensions ? `${h}×${w} cm` : 'đã đo sơ bộ'}) phù hợp để cắt ghép thủ công sạch sẽ sau khi vệ sinh.`
      : `Vật liệu ${detail || name} tái sử dụng được cho đồ trang trí/học tập nhưng cần tuân thủ đúng điều kiện xử lý cạnh sắc hoặc tránh cắt phá cấu trúc nguy hiểm.`;

  return {
    materialType: detail && detail !== 'Unknown' ? `${detail}${name ? ` — ${name}` : ''}` : name || category,
    materialCategory: category,
    materialConfidence: confidence,
    objectCondition: condition || 'Cần rửa sạch và lau khô hoàn toàn trước khi chế tác',
    reusableComponents,
    materialLimitations,
    suitabilityForManualCrafting: suitability,
    suitabilityLabel,
    suitabilitySummary,
    missingInformation,
    recommendedSafeActions: [
      'Rửa sạch bằng nước ấm nhẹ hoặc lau khô bụi bẩn trước khi đánh dấu đường cắt.',
      ...(requiresAdultSupervision
        ? ['Các bước cắt, dùi lỗ hoặc xử lý mép cứng cần có người lớn hỗ trợ/giám sát.']
        : []),
    ],
    requiresAdultSupervision,
  };
}

function isCraftRelevantToMaterial(
  craft: CraftProduct,
  input: RecyclingAdvisorInput
): { relevant: boolean; reason?: string } {
  const cat = (input.category || 'other').toLowerCase();
  const detail = (input.materialDetail || '').toLowerCase();
  const text = `${craft.title} ${craft.description} ${craft.whySuitable} ${craft.model3DType}`.toLowerCase();

  // Cardboard house from small plastic bottle only is mismatched unless paper/cardboard
  if (cat === 'glass' || detail === 'glass') {
    if (/(cắt\s*chai|dùng\s*kéo\s*cắt|cắt\s*đôi\s*lọ|chậu\s*thủy\s*canh\s*cắt)/i.test(text)) {
      return {
        relevant: false,
        reason: 'Không đề xuất ý tưởng cắt đôi hoặc gia công phá hủy thân thủy tinh.',
      };
    }
  }

  if (cat === 'paper' || detail === 'cardboard' || detail === 'paper') {
    if (/(thủy\s*canh|chậu\s*chứa\s*nước|bình\s*tưới\s*nước)/i.test(text) && !/nhựa|lót\s*chống\s*thấm/i.test(text)) {
      return {
        relevant: false,
        reason: 'Giấy/carton không thể chứa nước trực tiếp để trồng cây thủy canh.',
      };
    }
  }

  if (cat === 'plastic' && craft.model3DType === 'fabric_tote') {
    return {
      relevant: false,
      reason: 'Ý tưởng túi vải không phù hợp với vật liệu đầu vào là nhựa.',
    };
  }

  if (cat === 'plastic' && craft.model3DType === 'cardboard_house') {
    const usesCardboard = craft.materialsUsed.some((m) => /carton|bìa|giấy/i.test(m.name));
    if (usesCardboard && !craft.materialsUsed.some((m) => /nhựa|chai|pet|hdpe/i.test(m.name))) {
      return {
        relevant: false,
        reason: 'Ý tưởng mô hình nhà carton không sử dụng vật liệu nhựa đầu vào.',
      };
    }
  }

  return { relevant: true };
}

export function validateAndEnrichCraftProduct(
  craft: CraftProduct,
  reusability: MaterialReusabilityAnalysis,
  input: RecyclingAdvisorInput
): { accepted: boolean; craft?: CraftProduct; blockedReasons: string[] } {
  const blockedReasons: string[] = [];

  if (
    reusability.suitabilityForManualCrafting === 'unsafe' ||
    reusability.suitabilityForManualCrafting === 'insufficient_data'
  ) {
    return {
      accepted: false,
      blockedReasons: [reusability.suitabilitySummary],
    };
  }

  // Combine all text strings to audit against prohibited hazards
  const allTexts = [
    craft.title,
    craft.description,
    craft.whySuitable,
    ...(craft.toolsRequired || []),
    ...(craft.safetyNotes || []).filter((n) => n !== PROHIBITED_METHODS_NOTICE),
    ...(craft.materialsUsed || []).map((m) => `${m.name} ${m.role}`),
    ...(craft.materialsNeededExtra || []).map((m) => `${m.name} ${m.purpose}`),
    ...(craft.steps || []).map((s) => `${s.title} ${s.description} ${s.safetyWarning || ''} ${(s.toolsNeeded || []).join(' ')}`),
  ].join(' \n ');

  for (const rule of PROHIBITED_HAZARD_PATTERNS) {
    if (rule.pattern.test(allTexts)) {
      blockedReasons.push(`Loại bỏ "${craft.title}": ${rule.reason}`);
    }
  }

  if (blockedReasons.length > 0) {
    return { accepted: false, blockedReasons };
  }

  const relCheck = isCraftRelevantToMaterial(craft, input);
  if (!relCheck.relevant) {
    return {
      accepted: false,
      blockedReasons: [`Loại bỏ "${craft.title}": ${relCheck.reason}`],
    };
  }

  // Enrich steps with adult supervision flag & safety checks
  let anyAdultSupervision = Boolean(
    craft.adultSupervisionRequired || reusability.requiresAdultSupervision
  );

  const enrichedSteps: CraftStep[] = (craft.steps || []).map((step, idx) => {
    const stepText = `${step.title} ${step.description} ${(step.toolsNeeded || []).join(' ')} ${step.safetyWarning || ''}`;
    const needsSup =
      Boolean(step.needsAdultSupervision) ||
      ADULT_SUPERVISION_PATTERN.test(stepText) ||
      reusability.materialCategory === 'metal' ||
      reusability.materialCategory === 'glass';

    if (needsSup) anyAdultSupervision = true;

    let safetyWarning = step.safetyWarning;
    if (needsSup && !safetyWarning) {
      safetyWarning =
        reusability.materialCategory === 'metal'
          ? 'Cạnh kim loại rất sắc — cần người lớn hỗ trợ cắt/bo mép và đeo găng tay bảo hộ.'
          : 'Thao tác dùng dụng cụ cắt/ghép cần sự giám sát hoặc hỗ trợ của người lớn.';
    }

    return {
      ...step,
      stepNumber: step.stepNumber || idx + 1,
      materialsNeeded: Array.isArray(step.materialsNeeded) ? step.materialsNeeded : [],
      toolsNeeded: Array.isArray(step.toolsNeeded) ? step.toolsNeeded : [],
      needsAdultSupervision: needsSup,
      safetyWarning,
      highlightPart: step.highlightPart || (idx === 0 ? 'cut_line' : idx === craft.steps.length - 1 ? 'assembly' : 'body'),
    };
  });

  const preparation: CraftPreparationSpec = craft.preparation || {
    hygieneSteps: [
      `Vệ sinh sạch sẽ ${reusability.materialType} bằng nước sạch (hoặc lau bụi với giấy/vải) và để khô hoàn toàn.`,
      'Tháo bỏ tem nhãn lỏng hoặc cặn bẩn bên trong trước khi bắt đầu.',
    ],
    sortingAndMarking: [
      'Kiểm tra độ nguyên vẹn của các bộ phận có thể tái sử dụng.',
      'Dùng thước kẻ và bút dạ đánh dấu đường cắt/vị trí lắp ghép theo kích thước dự kiến.',
    ],
    workspaceSetup: [
      'Chuẩn bị mặt bàn phẳng, đủ ánh sáng và lót thảm/bìa cứng bảo vệ mặt bàn.',
      ...(anyAdultSupervision
        ? ['Đặt dụng cụ sắc nhọn gọn gàng và có người lớn đồng hành khi thực hiện bước cắt/dùi.']
        : []),
    ],
  };

  const dims = craft.dimensionsFinished || { lengthCm: 10, widthCm: 10, heightCm: 15 };
  const expectedResult: ExpectedResultSpec = craft.expectedResult || {
    summary: `Sản phẩm "${craft.title}" hoàn chỉnh từ ${reusability.materialType}, kết cấu gọn nhẹ phục vụ ${craft.categoryLabel.toLowerCase()}.`,
    functionalPurpose: craft.whySuitable || craft.description,
    estimatedDimensionsText: `${dims.lengthCm} × ${dims.widthCm} × ${dims.heightCm} cm (ước tính)`,
    durabilityNote:
      reusability.materialCategory === 'paper'
        ? 'Phù hợp sử dụng trong nhà ở nơi khô ráo.'
        : 'Có thể dùng lâu dài trong sinh hoạt/học tập nếu tránh nhiệt độ cao và va đập mạnh.',
    previewDisclaimer: CONCEPT_3D_PREVIEW_DISCLAIMER,
  };

  const finalInspection: FinalInspectionItem[] =
    Array.isArray(craft.finalInspection) && craft.finalInspection.length > 0
      ? craft.finalInspection
      : [
          {
            id: 'insp_edges',
            criterion: 'Kiểm tra độ an toàn mép cắt & bề mặt',
            checkMethod: 'Vuốt nhẹ kiểm tra không còn gờ sắc hoặc đầu dây kẽm/kim loại lộ ra ngoài.',
            criticalSafety: true,
          },
          {
            id: 'insp_stability',
            criterion: 'Kiểm tra độ đứng vững và kết nối các bộ phận',
            checkMethod: 'Đặt sản phẩm lên mặt phẳng, thử lắc nhẹ xem mối keo/khớp nối có chắc chắn không.',
          },
          {
            id: 'insp_hygiene',
            criterion: 'Kiểm tra vệ sinh và công năng sử dụng thực tế',
            checkMethod: 'Đảm bảo bên trong khô sạch, đúng kích thước vật dụng dự kiến đặt vào.',
          },
        ];

  const mergedSafetyNotes = Array.from(
    new Set([
      ...(craft.safetyNotes || []),
      ...(anyAdultSupervision
        ? ['Cần người lớn giám sát hoặc thực hiện thay ở các bước dùng dao rọc giấy, cắt kim loại, dùi lỗ hoặc súng keo nến.']
        : []),
      ...reusability.materialLimitations.slice(0, 2),
      PROHIBITED_METHODS_NOTICE,
    ])
  );

  return {
    accepted: true,
    blockedReasons: [],
    craft: {
      ...craft,
      suitabilityLabel: craft.suitabilityLabel || reusability.suitabilityLabel,
      safetyNotes: mergedSafetyNotes,
      adultSupervisionRequired: anyAdultSupervision,
      preparation,
      expectedResult,
      finalInspection,
      isConceptual3DPreview: true,
      steps: enrichedSteps,
    },
  };
}

export function filterAndSanitizeCraftList(
  crafts: CraftProduct[],
  reusability: MaterialReusabilityAnalysis,
  input: RecyclingAdvisorInput
): { valid: CraftProduct[]; blockedHazards: string[] } {
  const valid: CraftProduct[] = [];
  const blockedHazards: string[] = [];

  for (const craft of crafts) {
    const res = validateAndEnrichCraftProduct(craft, reusability, input);
    if (res.accepted && res.craft) {
      valid.push(res.craft);
    } else {
      blockedHazards.push(...res.blockedReasons);
    }
  }

  return { valid, blockedHazards };
}

function buildCuratedIdeasForMaterial(
  reusability: MaterialReusabilityAnalysis,
  input: RecyclingAdvisorInput
): { group100Percent: CraftProduct[]; groupWithAddedMaterials: CraftProduct[] } {
  const cat = reusability.materialCategory;
  const matLabel = input.materialName || reusability.materialType;
  const h = Number(input.dimensions?.heightCm || 18);
  const w = Number(input.dimensions?.widthCm || 8);
  const cutHeight = Math.max(6, Math.round(h * 0.58));
  const smallDim = Math.max(5, Math.round(w));

  if (cat === 'plastic') {
    const idea1: CraftProduct = {
      id: `p7_pet_pen_${Date.now()}`,
      title: `Ống cắm bút tối giản từ ${matLabel}`,
      description: `Cắt gọn phần thân dưới của ${matLabel} cao khoảng ${cutHeight} cm, bo viền êm tay để làm ống đựng bút, thước kẻ và kéo gọn gàng trên bàn học.`,
      category: 'study',
      categoryLabel: 'Đồ dùng học tập',
      type: '100_percent_recycled',
      imageUrl: '',
      model3DType: 'pen_holder',
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledMaterialRatio: 100,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Thân ống & đáy đứng chịu lực' },
      ],
      materialsNeededExtra: [],
      toolsRequired: ['Bút lông đánh dấu', 'Thước kẻ', 'Kéo thủ công', 'Băng keo giấy hoặc giấy nhám mịn'],
      dimensionsFinished: { lengthCm: smallDim, widthCm: smallDim, heightCm: cutHeight },
      whySuitable: `Thân nhựa ${reusability.materialType} cứng cáp, đáy phẳng đứng vững, dễ cắt bằng kéo thủ công mà không tốn chi phí mua thêm.`,
      steps: [
        {
          stepNumber: 1,
          title: 'Đo và đánh dấu đường cắt ngang thân',
          description: `Đo từ đáy lên ${cutHeight} cm trên ${matLabel}, xoay đều và vẽ vòng tròn làm chuẩn cắt.`,
          materialsNeeded: [matLabel],
          toolsNeeded: ['Thước kẻ', 'Bút lông đánh dấu'],
          dimensionsNotice: `Chiều cao thân ống đề xuất: ~${cutHeight} cm (đường kính ~${smallDim} cm).`,
          highlightPart: 'cut_line',
        },
        {
          stepNumber: 2,
          title: 'Cắt mở miệng ống và bo mịn viền cắt',
          description: 'Dùng kéo thủ công cắt dọc theo vạch đã đánh dấu, sau đó dùng giấy nhám mịn hoặc viền băng keo bảo vệ quanh miệng ống.',
          materialsNeeded: [],
          toolsNeeded: ['Kéo thủ công', 'Giấy nhám mịn'],
          needsAdultSupervision: true,
          safetyWarning: 'Cẩn thận mũi kéo khi tạo lỗ mồi; cắt dứt khoát để tránh gờ nhựa sắc.',
          highlightPart: 'top',
        },
        {
          stepNumber: 3,
          title: 'Kiểm tra độ cân bằng & sắp xếp dụng cụ học tập',
          description: 'Đặt ống lên mặt bàn phẳng, cho bút viết và thước vào để kiểm tra trọng tâm không bị nghiêng đổ.',
          materialsNeeded: [],
          toolsNeeded: [],
          highlightPart: 'body',
        },
      ],
    };

    const idea2: CraftProduct = {
      id: `p7_pet_planter_${Date.now()}`,
      title: `Chậu trồng cây mini tự hút ẩm từ ${matLabel}`,
      description: `Tận dụng phần phễu trên và đáy của ${matLabel} làm chậu hai tầng: tầng dưới trữ nước, tầng trên chứa đất trồng sen đá hoặc cây gia vị.`,
      category: 'garden',
      categoryLabel: 'Làm vườn & Cây xanh',
      type: 'with_added_materials',
      imageUrl: '',
      model3DType: 'bottle_pot',
      difficulty: 'Dễ',
      estimatedTime: '30 phút',
      recycledMaterialRatio: 85,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Khoang chứa nước (đáy) & phễu đất (đầu)' },
      ],
      materialsNeededExtra: [
        { name: 'Dây bấc cotton (hoặc vải sợi thừa)', purpose: 'Hút ẩm mao dẫn lên đất', estimatedCostVnd: 5000, isEcoFriendly: true },
        { name: 'Đất trồng & cây nhỏ', purpose: 'Trồng cây hoàn thiện', estimatedCostVnd: 15000, isEcoFriendly: true },
      ],
      toolsRequired: ['Kéo thủ công', 'Bút đánh dấu', 'Đinh/dùi nhỏ (do người lớn hỗ trợ)'],
      dimensionsFinished: { lengthCm: smallDim, widthCm: smallDim, heightCm: Math.max(12, Math.round(h * 0.78)) },
      whySuitable: `Nhựa ${reusability.materialType} không thấm nước, độ trong giúp quan sát được mực nước ở khoang dưới rất tiện lợi.`,
      steps: [
        {
          stepNumber: 1,
          title: 'Đánh dấu đường chia đôi thân chai/hộp',
          description: `Vẽ đường chia ở vị trí 1/2 chiều cao (~${Math.round(h * 0.5)} cm từ đáy) để tách làm khoang nước và phễu trồng.`,
          materialsNeeded: [matLabel],
          toolsNeeded: ['Bút đánh dấu', 'Thước kẻ'],
          highlightPart: 'cut_line',
        },
        {
          stepNumber: 2,
          title: 'Cắt tách 2 phần & đục lỗ dẫn dây bấc trên nắp',
          description: 'Cắt theo đường đã vạch; dùng dùi nguội thủ công tạo một lỗ nhỏ ~5mm giữa nắp để luồn dây bấc cotton.',
          materialsNeeded: ['Dây bấc cotton'],
          toolsNeeded: ['Kéo thủ công', 'Dùi lỗ thủ công'],
          needsAdultSupervision: true,
          safetyWarning: 'Cần người lớn hỗ trợ bước cắt thân nhựa và xoay dùi nguội tạo lỗ trên nắp.',
          highlightPart: 'top',
        },
        {
          stepNumber: 3,
          title: 'Lắp lồng ngược phễu, thêm nước & đất trồng',
          description: 'Đổ nước sạch vào khoang đáy, lồng ngược phần cổ chai có dây bấc lên trên, cho đất ẩm và đặt cây nhỏ vào.',
          materialsNeeded: ['Đất trồng & cây nhỏ'],
          toolsNeeded: [],
          highlightPart: 'assembly',
        },
      ],
    };

    const idea3: CraftProduct = {
      id: `p7_pet_feeder_${Date.now()}`,
      title: `Máng treo cho chim ăn sân vườn từ ${matLabel}`,
      description: `Khoét cửa sổ nhỏ hai bên thân ${matLabel} và luồn que gỗ ngang làm chỗ đậu, treo ngoài ban công hoặc sân vườn.`,
      category: 'garden',
      categoryLabel: 'Làm vườn & Cây xanh',
      type: 'with_added_materials',
      imageUrl: '',
      model3DType: 'bird_feeder',
      difficulty: 'Trung bình',
      estimatedTime: '35 phút',
      recycledMaterialRatio: 88,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Khoang chứa hạt kín mưa' },
      ],
      materialsNeededExtra: [
        { name: '2 thìa gỗ / đũa tre thừa', purpose: 'Làm thanh đậu cho chim', estimatedCostVnd: 3000, isEcoFriendly: true },
        { name: 'Dây dù / dây thừng nhỏ', purpose: 'Treo chắc chắn ngoài trời', estimatedCostVnd: 5000, isEcoFriendly: true },
      ],
      toolsRequired: ['Kéo mũi nhọn', 'Thước kẻ', 'Bút dạ', 'Băng keo vải bo viền'],
      dimensionsFinished: { lengthCm: smallDim + 6, widthCm: smallDim, heightCm: Math.max(16, Math.round(h)) },
      whySuitable: 'Cấu trúc kín giúp che mưa nắng cho hạt, giữ dáng nguyên khối chắc chắn khi treo.',
      steps: [
        {
          stepNumber: 1,
          title: 'Vẽ vị trí cửa lấy hạt & điểm luồn que đậu',
          description: 'Đánh dấu 2 ô vòm nhỏ đối diện nhau cách đáy 5 cm và điểm xuyên đũa tre thấp hơn mép cửa 1.5 cm.',
          materialsNeeded: [matLabel],
          toolsNeeded: ['Bút dạ', 'Thước kẻ'],
          highlightPart: 'cut_line',
        },
        {
          stepNumber: 2,
          title: 'Cắt ô cửa & dán viền băng keo bảo vệ',
          description: 'Cắt ô lấy hạt gọn gàng và dán băng keo vải quanh mép vừa cắt để chim không bị xước.',
          materialsNeeded: [],
          toolsNeeded: ['Kéo thủ công', 'Băng keo vải'],
          needsAdultSupervision: true,
          safetyWarning: 'Cần người lớn hỗ trợ cắt ô cửa trên thân nhựa cứng.',
          highlightPart: 'body',
        },
        {
          stepNumber: 3,
          title: 'Luồn que đậu và buộc dây treo cố định',
          description: 'Xuyên đũa tre qua thân, buộc dây treo ở cổ vật thể và đổ hạt khô vào khoang chứa.',
          materialsNeeded: ['2 thìa gỗ / đũa tre thừa', 'Dây dù / dây thừng nhỏ'],
          toolsNeeded: [],
          highlightPart: 'assembly',
        },
      ],
    };

    return { group100Percent: [idea1], groupWithAddedMaterials: [idea2, idea3] };
  }

  if (cat === 'metal') {
    const idea1: CraftProduct = {
      id: `p7_metal_pen_${Date.now()}`,
      title: `Hộp đựng bút phong cách công nghiệp từ ${matLabel}`,
      description: `Làm sạch lon/hộp kim loại ${matLabel}, gập hoặc bọc kỹ miệng mép bằng băng keo vải/dây thừng để tạo ống đựng bút bền chắc trên bàn làm việc.`,
      category: 'study',
      categoryLabel: 'Đồ dùng học tập',
      type: '100_percent_recycled',
      imageUrl: '',
      model3DType: 'pen_holder',
      difficulty: 'Dễ',
      estimatedTime: '25 phút',
      recycledMaterialRatio: 100,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Thân ống kim loại bền chắc' },
      ],
      materialsNeededExtra: [],
      toolsRequired: ['Kìm mỏ bằng (bẻ gập mép)', 'Găng tay bảo hộ', 'Băng keo vải hoặc băng keo giấy'],
      dimensionsFinished: { lengthCm: smallDim, widthCm: smallDim, heightCm: Math.max(9, Math.round(h)) },
      whySuitable: 'Thân kim loại cứng vững, nặng đáy nên giữ được nhiều bút kéo mà không bị lật.',
      adultSupervisionRequired: true,
      steps: [
        {
          stepNumber: 1,
          title: 'Kiểm tra và xử lý an toàn mép miệng lon',
          description: 'Đeo găng tay bảo hộ, dùng kìm bóp ép sát phần gờ kim loại thừa vào thành trong và dán 2 lớp băng keo vải bọc kín miệng.',
          materialsNeeded: [matLabel],
          toolsNeeded: ['Kìm mỏ bằng', 'Găng tay bảo hộ', 'Băng keo vải'],
          needsAdultSupervision: true,
          safetyWarning: 'Mép kim loại rất sắc — BẮT BUỘC người lớn kiểm tra và bọc kín miệng trước khi sử dụng.',
          highlightPart: 'top',
        },
        {
          stepNumber: 2,
          title: 'Trang trí lớp áo ngoài chống trầy',
          description: 'Quấn thêm giấy tái chế hoặc sơn màu nước acrylic an toàn bên ngoài thân ống.',
          materialsNeeded: [],
          toolsNeeded: ['Cọ vẽ', 'Màu acrylic gốc nước'],
          highlightPart: 'body',
        },
      ],
    };

    const idea2: CraftProduct = {
      id: `p7_metal_lantern_${Date.now()}`,
      title: `Đèn lồng trang trí ánh sao LED 3V từ ${matLabel}`,
      description: `Tạo họa tiết đục chấm nghệ thuật trên thân ${matLabel} và đặt đèn LED dùng pin nút 3V (không tỏa nhiệt, không dùng lửa) bên trong.`,
      category: 'decor',
      categoryLabel: 'Trang trí phòng',
      type: 'with_added_materials',
      imageUrl: '',
      model3DType: 'lantern_lamp',
      difficulty: 'Trung bình',
      estimatedTime: '40 phút',
      recycledMaterialRatio: 85,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Chụp đèn kim loại phản chiếu ánh sáng' },
      ],
      materialsNeededExtra: [
        { name: 'Đèn LED nến giả dùng pin 3V', purpose: 'Phát sáng an toàn không sinh nhiệt', estimatedCostVnd: 12000, isEcoFriendly: true },
        { name: 'Dây kẽm uốn hoặc dây dù nhỏ', purpose: 'Làm quai xách treo đèn', estimatedCostVnd: 5000, isEcoFriendly: true },
      ],
      toolsRequired: ['Đinh nhỏ & búa nhẹ (người lớn thao tác)', 'Găng tay bảo hộ', 'Băng keo vải bọc miệng'],
      dimensionsFinished: { lengthCm: smallDim, widthCm: smallDim, heightCm: Math.max(10, Math.round(h)) },
      whySuitable: 'Lòng kim loại sáng bóng phản chiếu ánh sáng LED dịu mắt; tuyệt đối chỉ dùng LED nguội 3V để an toàn.',
      adultSupervisionRequired: true,
      steps: [
        {
          stepNumber: 1,
          title: 'Bọc an toàn miệng kim loại & vẽ chấm mẫu',
          description: 'Dán kín viền miệng bằng băng keo vải; chấm bút lên thân theo họa tiết ngôi sao hoặc hình học.',
          materialsNeeded: [matLabel],
          toolsNeeded: ['Bút dạ', 'Băng keo vải'],
          needsAdultSupervision: true,
          highlightPart: 'cut_line',
        },
        {
          stepNumber: 2,
          title: 'Đục lỗ tạo sáng (do người lớn thực hiện)',
          description: 'Chèn khăn dày hoặc khuôn gỗ vào trong lòng lon để đỡ, sau đó người lớn dùng đinh gõ nhẹ tạo các lỗ tròn.',
          materialsNeeded: [],
          toolsNeeded: ['Đinh nhỏ', 'Búa nhỏ', 'Găng tay bảo hộ'],
          needsAdultSupervision: true,
          safetyWarning: 'Cẩn thận đầu đinh và gờ kim loại bên trong; luôn đeo găng tay bảo hộ.',
          highlightPart: 'body',
        },
        {
          stepNumber: 3,
          title: 'Đặt đèn LED pin 3V an toàn vào lòng đèn',
          description: 'Bật công tắc đèn LED pin 3V đặt ở đáy lon (KHÔNG sử dụng nến cháy thật) và gắn quai treo.',
          materialsNeeded: ['Đèn LED nến giả dùng pin 3V', 'Dây kẽm uốn hoặc dây dù nhỏ'],
          toolsNeeded: [],
          highlightPart: 'assembly',
        },
      ],
    };

    return { group100Percent: [idea1], groupWithAddedMaterials: [idea2] };
  }

  if (cat === 'glass') {
    const idea1: CraftProduct = {
      id: `p7_glass_vase_${Date.now()}`,
      title: `Bình hoa / Lọ trang trí quấn dây thừng từ ${matLabel}`,
      description: `Giữ nguyên hoàn toàn thân thủy tinh ${matLabel} (không cắt hay đập), vệ sinh sạch và quấn dây thừng / vẽ họa tiết bên ngoài để làm bình cắm hoa trang trí.`,
      category: 'decor',
      categoryLabel: 'Trang trí phòng',
      type: 'with_added_materials',
      imageUrl: '',
      model3DType: 'bottle_pot',
      difficulty: 'Dễ',
      estimatedTime: '30 phút',
      recycledMaterialRatio: 85,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Bình chứa nguyên khối chắc chắn' },
      ],
      materialsNeededExtra: [
        { name: 'Dây thừng sợi đay / len màu', purpose: 'Quấn trang trí & chống trượt vỡ', estimatedCostVnd: 10000, isEcoFriendly: true },
        { name: 'Keo sữa PVA an toàn', purpose: 'Cố định vòng dây lên thân kính', estimatedCostVnd: 8000, isEcoFriendly: true },
      ],
      toolsRequired: ['Kéo cắt dây', 'Khăn lau khô', 'Bút vẽ kính / cọ nhỏ'],
      dimensionsFinished: { lengthCm: smallDim, widthCm: smallDim, heightCm: Math.max(12, Math.round(h)) },
      whySuitable: 'Thủy tinh giữ nước rất tốt, trọng lượng đầm giúp bình hoa đứng vững mà không cần cắt phá thủy tinh.',
      adultSupervisionRequired: true,
      steps: [
        {
          stepNumber: 1,
          title: 'Ngâm bóc nhãn & kiểm tra không nứt mẻ',
          description: 'Ngâm lọ trong nước ấm pha xà phòng loãng, bóc sạch nhãn, kiểm tra kỹ miệng bình không bị mẻ cạnh.',
          materialsNeeded: [matLabel],
          toolsNeeded: ['Khăn lau khô'],
          needsAdultSupervision: true,
          safetyWarning: 'Nếu phát hiện vết nứt hoặc sứt mẻ cạnh sắc, dừng thực hiện ngay.',
          highlightPart: 'body',
        },
        {
          stepNumber: 2,
          title: 'Quấn dây thừng bảo vệ & trang trí thân ngoài',
          description: 'Phết từng đoạn keo sữa PVA lên thân ngoài và quấn đều dây thừng sợi đay từ đáy lên vai bình.',
          materialsNeeded: ['Dây thừng sợi đay / len màu', 'Keo sữa PVA an toàn'],
          toolsNeeded: ['Kéo cắt dây', 'Cọ nhỏ'],
          highlightPart: 'assembly',
        },
      ],
    };

    const idea2: CraftProduct = {
      id: `p7_glass_led_${Date.now()}`,
      title: `Đèn thủy tinh đom đóm dây LED pin 3V từ ${matLabel}`,
      description: `Tận dụng độ trong suốt của ${matLabel} (giữ nguyên khối) kết hợp dây đèn LED đồng dùng pin cúc áo 3V để tạo đèn ngủ trang trí bàn học.`,
      category: 'decor',
      categoryLabel: 'Trang trí phòng',
      type: 'with_added_materials',
      imageUrl: '',
      model3DType: 'lantern_lamp',
      difficulty: 'Dễ',
      estimatedTime: '20 phút',
      recycledMaterialRatio: 82,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Vỏ đèn thủy tinh nguyên khối khuếch tán sáng' },
      ],
      materialsNeededExtra: [
        { name: 'Dây đèn LED đom đóm pin 3V', purpose: 'Tạo ánh sáng ấm an toàn không sinh nhiệt', estimatedCostVnd: 15000, isEcoFriendly: true },
      ],
      toolsRequired: ['Khăn mềm lau kính', 'Nút bần hoặc nắp đậy sẵn có'],
      dimensionsFinished: { lengthCm: smallDim, widthCm: smallDim, heightCm: Math.max(12, Math.round(h)) },
      whySuitable: 'Không tác động cơ học lên thủy tinh nên loại bỏ hoàn toàn rủi ro mảnh vỡ; đèn LED 3V không gây nóng kính.',
      adultSupervisionRequired: true,
      steps: [
        {
          stepNumber: 1,
          title: 'Vệ sinh và làm khô hoàn toàn lòng lọ',
          description: 'Rửa sạch và để ráo hẳn nước bên trong lọ thủy tinh trước khi đưa dây đèn pin vào.',
          materialsNeeded: [matLabel],
          toolsNeeded: ['Khăn mềm lau kính'],
          highlightPart: 'body',
        },
        {
          stepNumber: 2,
          title: 'Bố trí dây LED 3V & cố định hộp pin trên nắp',
          description: 'Cuộn nhẹ dây LED vào trong lòng lọ và gài hộp pin công tắc phía trên miệng nắp để dễ bật/tắt.',
          materialsNeeded: ['Dây đèn LED đom đóm pin 3V'],
          toolsNeeded: [],
          needsAdultSupervision: true,
          safetyWarning: 'Đặt đèn ở vị trí chắc chắn trên bàn, tránh mép bàn dễ rơi vỡ.',
          highlightPart: 'top',
        },
      ],
    };

    return { group100Percent: [], groupWithAddedMaterials: [idea1, idea2] };
  }

  if (cat === 'fabric') {
    const idea1: CraftProduct = {
      id: `p7_fabric_tote_${Date.now()}`,
      title: `Túi tote / Túi đựng đồ gập mép từ ${matLabel}`,
      description: `Cắt chỉnh cân đối tấm vải ${matLabel}, khâu tay mũi cơ bản hoặc dán keo vải an toàn để tạo túi đựng sách vở gọn nhẹ.`,
      category: 'home',
      categoryLabel: 'Gia đình & Tiện ích',
      type: '100_percent_recycled',
      imageUrl: '',
      model3DType: 'fabric_tote',
      difficulty: 'Trung bình',
      estimatedTime: '45 phút',
      recycledMaterialRatio: 100,
      materialsUsed: [
        { name: matLabel, fromCurrentInventory: true, role: 'Thân túi & dây quai vải cắt tận dụng' },
      ],
      materialsNeededExtra: [],
      toolsRequired: ['Kéo cắt vải', 'Kim chỉ khâu tay', 'Phấn may / bút chì', 'Thước kẻ'],
      dimensionsFinished: {
        lengthCm: Math.max(18, smallDim),
        widthCm: 8,
        heightCm: Math.max(22, Math.round(h)),
      },
      whySuitable: 'Chất liệu vải mềm dai, chịu lực kéo tốt và có thể giặt sạch dùng nhiều lần.',
      steps: [
        {
          stepNumber: 1,
          title: 'Đo vẽ khung thân túi & 2 dải quai xách',
          description: 'Trải phẳng vải trên bàn, dùng phấn kẻ khung hình chữ nhật cân đối cho thân túi và 2 dải quai dài ~35 cm.',
          materialsNeeded: [matLabel],
          toolsNeeded: ['Thước kẻ', 'Phấn may'],
          highlightPart: 'cut_line',
        },
        {
          stepNumber: 2,
          title: 'Cắt vải & khâu nối mặt trái hai bên hông',
          description: 'Cắt theo đường kẻ, lật mặt trái vào nhau và khâu vắt đều mép đáy + 2 cạnh sườn.',
          materialsNeeded: [],
          toolsNeeded: ['Kéo cắt vải', 'Kim chỉ khâu tay'],
          needsAdultSupervision: true,
          safetyWarning: 'Cẩn thận kim khâu sắc nhọn; có thể dùng băng keo vải dán ép nguội nếu chưa quen khâu.',
          highlightPart: 'body',
        },
        {
          stepNumber: 3,
          title: 'Lộn phải túi & cố định quai xách',
          description: 'Lộn mặt phải ra ngoài, gập miệng túi 2 cm cho gọn sợi rồi khâu chắc hai đầu quai xách.',
          materialsNeeded: [],
          toolsNeeded: ['Kim chỉ khâu tay'],
          highlightPart: 'assembly',
        },
      ],
    };

    return { group100Percent: [idea1], groupWithAddedMaterials: [] };
  }

  // Cardboard / Paper / Wood / Default box structure
  const boxL = Math.max(12, Math.round(Number(input.dimensions?.lengthCm || w || 18)));
  const boxW = Math.max(10, Math.round(w || 14));
  const boxH = Math.max(10, Math.round(h || 16));

  const cardIdea1: CraftProduct = {
    id: `p7_box_org_${Date.now()}`,
    title: `Kệ phân loại bàn học nhiều ngăn từ ${matLabel}`,
    description: `Cắt vát mặt trước của ${matLabel} và tận dụng chính phần bìa cắt thừa làm vách ngăn chia khoang đựng sổ tay, bút thước gọn gàng.`,
    category: 'study',
    categoryLabel: 'Đồ dùng học tập',
    type: '100_percent_recycled',
    imageUrl: '',
    model3DType: 'box_organizer',
    difficulty: 'Dễ',
    estimatedTime: '30 phút',
    recycledMaterialRatio: 100,
    materialsUsed: [
      { name: matLabel, fromCurrentInventory: true, role: 'Khung hộp chính & bìa làm vách ngăn' },
    ],
    materialsNeededExtra: [],
    toolsRequired: ['Thước kẻ', 'Bút chì', 'Kéo lớn hoặc dao rọc giấy (có người lớn hỗ trợ)', 'Keo sữa PVA hoặc băng keo giấy'],
    dimensionsFinished: { lengthCm: boxL, widthCm: boxW, heightCm: boxH },
    whySuitable: `Bìa/khối dạng hộp (${boxL}×${boxW}×${boxH} cm) có mặt phẳng rộng, dễ cắt thẳng và lắp vách chia ngăn chính xác.`,
    steps: [
      {
        stepNumber: 1,
        title: 'Đo và kẻ đường cắt vát mặt trước',
        description: `Dùng thước vẽ đường chéo vát mặt trước hộp từ cao ${boxH} cm xuống còn ${Math.max(6, Math.round(boxH * 0.45))} cm để dễ lấy đồ.`,
        materialsNeeded: [matLabel],
        toolsNeeded: ['Thước kẻ', 'Bút chì'],
        highlightPart: 'cut_line',
      },
      {
        stepNumber: 2,
        title: 'Cắt khung hộp & tạo vách ngăn từ phần bìa dư',
        description: 'Cắt cẩn thận theo đường kẻ; đo phần bìa dư vừa cắt ra để làm 1–2 vách ngăn chia khoang bên trong.',
        materialsNeeded: [],
        toolsNeeded: ['Kéo lớn', 'Dao rọc giấy'],
        needsAdultSupervision: true,
        safetyWarning: 'Lót bìa cứng dưới mặt cắt và luôn cắt hướng ra xa tay giữ.',
        highlightPart: 'body',
      },
      {
        stepNumber: 3,
        title: 'Dán cố định vách ngăn & gia cố góc hộp',
        description: 'Dán vách ngăn bằng keo sữa PVA hoặc băng keo giấy, chờ keo khô hẳn 15 phút trước khi xếp sách vở.',
        materialsNeeded: [],
        toolsNeeded: ['Keo sữa PVA', 'Băng keo giấy'],
        highlightPart: 'assembly',
      },
    ],
  };

  const cardIdea2: CraftProduct = {
    id: `p7_box_house_${Date.now()}`,
    title: `Hộp tiết kiệm / Mô hình nhà mini từ ${matLabel}`,
    description: `Biến đổi ${matLabel} thành mô hình ngôi nhà mini có khe bỏ tiền tiết kiệm trên mái và cửa sổ trang trí màu nước.`,
    category: 'stem_toy',
    categoryLabel: 'Đồ chơi STEM & Sáng tạo',
    type: 'with_added_materials',
    imageUrl: '',
    model3DType: 'cardboard_house',
    difficulty: 'Trung bình',
    estimatedTime: '45 phút',
    recycledMaterialRatio: 90,
    materialsUsed: [
      { name: matLabel, fromCurrentInventory: true, role: 'Thân nhà & mái ghép hình tam giác' },
    ],
    materialsNeededExtra: [
      { name: 'Giấy màu / màu nước gốc nước', purpose: 'Trang trí mái ngói và cửa sổ', estimatedCostVnd: 10000, isEcoFriendly: true },
    ],
    toolsRequired: ['Thước kẻ', 'Bút chì', 'Kéo thủ công', 'Keo sữa PVA'],
    dimensionsFinished: { lengthCm: boxL, widthCm: boxW, heightCm: boxH + 4 },
    whySuitable: 'Dễ gấp nếp tạo mái tam giác, bề mặt thấm màu nước tốt để trẻ tự do trang trí.',
    steps: [
      {
        stepNumber: 1,
        title: 'Tạo nếp gấp mái nhà & kẻ khe tiết kiệm',
        description: 'Gấp hai tai hộp đối xứng tạo mái dốc và đánh dấu khe chữ nhật ~4×0.6 cm trên đỉnh mái.',
        materialsNeeded: [matLabel],
        toolsNeeded: ['Thước kẻ', 'Bút chì'],
        highlightPart: 'top',
      },
      {
        stepNumber: 2,
        title: 'Cắt khe mái & ghép cố định bằng keo sữa',
        description: 'Cắt khe gọn gàng và dán cố định phần mái bằng keo sữa PVA.',
        materialsNeeded: [],
        toolsNeeded: ['Kéo thủ công', 'Keo sữa PVA'],
        needsAdultSupervision: true,
        highlightPart: 'cut_line',
      },
      {
        stepNumber: 3,
        title: 'Trang trí cửa sổ và sơn màu hoàn thiện',
        description: 'Dán giấy màu tạo khung cửa, tô màu nước an toàn và để khô tự nhiên.',
        materialsNeeded: ['Giấy màu / màu nước gốc nước'],
        toolsNeeded: ['Cọ vẽ'],
        highlightPart: 'assembly',
      },
    ],
  };

  return { group100Percent: [cardIdea1], groupWithAddedMaterials: [cardIdea2] };
}

const PHASE7_CRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    group100Percent: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          category: { type: Type.STRING, enum: ['decor', 'study', 'home', 'stem_toy', 'garden'] },
          categoryLabel: { type: Type.STRING },
          model3DType: {
            type: Type.STRING,
            enum: ['bottle_pot', 'pen_holder', 'box_organizer', 'lantern_lamp', 'bird_feeder', 'plastic_planter', 'toy_car', 'cardboard_house', 'fabric_tote', 'cap_mosaic'],
          },
          difficulty: { type: Type.STRING, enum: ['Dễ', 'Trung bình', 'Khó'] },
          estimatedTime: { type: Type.STRING },
          recycledMaterialRatio: { type: Type.NUMBER },
          whySuitable: { type: Type.STRING },
          materialsUsed: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                fromCurrentInventory: { type: Type.BOOLEAN },
                role: { type: Type.STRING },
              },
              required: ['name', 'fromCurrentInventory', 'role'],
            },
          },
          materialsNeededExtra: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                purpose: { type: Type.STRING },
                estimatedCostVnd: { type: Type.NUMBER },
                isEcoFriendly: { type: Type.BOOLEAN },
              },
              required: ['name', 'purpose', 'estimatedCostVnd', 'isEcoFriendly'],
            },
          },
          toolsRequired: { type: Type.ARRAY, items: { type: Type.STRING } },
          dimensionsFinished: {
            type: Type.OBJECT,
            properties: {
              lengthCm: { type: Type.NUMBER },
              widthCm: { type: Type.NUMBER },
              heightCm: { type: Type.NUMBER },
            },
            required: ['lengthCm', 'widthCm', 'heightCm'],
          },
          preparation: {
            type: Type.OBJECT,
            properties: {
              hygieneSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
              sortingAndMarking: { type: Type.ARRAY, items: { type: Type.STRING } },
              workspaceSetup: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['hygieneSteps', 'sortingAndMarking', 'workspaceSetup'],
          },
          expectedResult: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              functionalPurpose: { type: Type.STRING },
              estimatedDimensionsText: { type: Type.STRING },
              durabilityNote: { type: Type.STRING },
            },
            required: ['summary', 'functionalPurpose', 'estimatedDimensionsText', 'durabilityNote'],
          },
          safetyNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                stepNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                materialsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } },
                toolsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } },
                dimensionsNotice: { type: Type.STRING },
                safetyWarning: { type: Type.STRING },
                needsAdultSupervision: { type: Type.BOOLEAN },
                highlightPart: { type: Type.STRING, enum: ['cut_line', 'body', 'assembly', 'top', 'bottom'] },
              },
              required: ['stepNumber', 'title', 'description', 'materialsNeeded', 'toolsNeeded', 'highlightPart'],
            },
          },
        },
        required: ['title', 'description', 'model3DType', 'difficulty', 'estimatedTime', 'toolsRequired', 'whySuitable', 'steps'],
      },
    },
    groupWithAddedMaterials: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          category: { type: Type.STRING, enum: ['decor', 'study', 'home', 'stem_toy', 'garden'] },
          categoryLabel: { type: Type.STRING },
          model3DType: {
            type: Type.STRING,
            enum: ['bottle_pot', 'pen_holder', 'box_organizer', 'lantern_lamp', 'bird_feeder', 'plastic_planter', 'toy_car', 'cardboard_house', 'fabric_tote', 'cap_mosaic'],
          },
          difficulty: { type: Type.STRING, enum: ['Dễ', 'Trung bình', 'Khó'] },
          estimatedTime: { type: Type.STRING },
          recycledMaterialRatio: { type: Type.NUMBER },
          whySuitable: { type: Type.STRING },
          materialsUsed: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                fromCurrentInventory: { type: Type.BOOLEAN },
                role: { type: Type.STRING },
              },
              required: ['name', 'fromCurrentInventory', 'role'],
            },
          },
          materialsNeededExtra: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                purpose: { type: Type.STRING },
                estimatedCostVnd: { type: Type.NUMBER },
                isEcoFriendly: { type: Type.BOOLEAN },
              },
              required: ['name', 'purpose', 'estimatedCostVnd', 'isEcoFriendly'],
            },
          },
          toolsRequired: { type: Type.ARRAY, items: { type: Type.STRING } },
          dimensionsFinished: {
            type: Type.OBJECT,
            properties: {
              lengthCm: { type: Type.NUMBER },
              widthCm: { type: Type.NUMBER },
              heightCm: { type: Type.NUMBER },
            },
            required: ['lengthCm', 'widthCm', 'heightCm'],
          },
          preparation: {
            type: Type.OBJECT,
            properties: {
              hygieneSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
              sortingAndMarking: { type: Type.ARRAY, items: { type: Type.STRING } },
              workspaceSetup: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['hygieneSteps', 'sortingAndMarking', 'workspaceSetup'],
          },
          expectedResult: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              functionalPurpose: { type: Type.STRING },
              estimatedDimensionsText: { type: Type.STRING },
              durabilityNote: { type: Type.STRING },
            },
            required: ['summary', 'functionalPurpose', 'estimatedDimensionsText', 'durabilityNote'],
          },
          safetyNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                stepNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                materialsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } },
                toolsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } },
                dimensionsNotice: { type: Type.STRING },
                safetyWarning: { type: Type.STRING },
                needsAdultSupervision: { type: Type.BOOLEAN },
                highlightPart: { type: Type.STRING, enum: ['cut_line', 'body', 'assembly', 'top', 'bottom'] },
              },
              required: ['stepNumber', 'title', 'description', 'materialsNeeded', 'toolsNeeded', 'highlightPart'],
            },
          },
        },
        required: ['title', 'description', 'model3DType', 'difficulty', 'estimatedTime', 'toolsRequired', 'whySuitable', 'steps'],
      },
    },
  },
  required: ['group100Percent', 'groupWithAddedMaterials'],
};

export interface Phase7AdvisorResponse {
  reusability: MaterialReusabilityAnalysis;
  group100Percent: CraftProduct[];
  groupWithAddedMaterials: CraftProduct[];
  safetyCompliance: SafetyComplianceReport;
  engineUsed: 'gemini' | 'rule_based_advisor';
  disclaimer3D: string;
}

export async function generatePhase7RecyclingAdvisor(
  input: RecyclingAdvisorInput
): Promise<Phase7AdvisorResponse> {
  const reusability = analyzeMaterialReusability(input);

  // Strict honesty & safety gate: never emit crafting ideas for unsafe or insufficient-data materials
  if (
    reusability.suitabilityForManualCrafting === 'unsafe' ||
    reusability.suitabilityForManualCrafting === 'insufficient_data'
  ) {
    return {
      reusability,
      group100Percent: [],
      groupWithAddedMaterials: [],
      safetyCompliance: {
        isSafe: reusability.suitabilityForManualCrafting !== 'unsafe',
        requiresAdultSupervision: true,
        blockedHazards:
          reusability.suitabilityForManualCrafting === 'unsafe'
            ? [reusability.suitabilitySummary]
            : [],
        safetyNotes: reusability.recommendedSafeActions,
        prohibitedMethodsReminder: PROHIBITED_METHODS_NOTICE,
      },
      engineUsed: 'rule_based_advisor',
      disclaimer3D: CONCEPT_3D_PREVIEW_DISCLAIMER,
    };
  }

  let raw100: CraftProduct[] = [];
  let rawAdded: CraftProduct[] = [];
  let engineUsed: 'gemini' | 'rule_based_advisor' = 'rule_based_advisor';

  const apiKey = process.env.GEMINI_API_KEY;
  if (input.allowAi !== false && apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = `Bạn là Chuyên gia Tái Chế Thủ Công An Toàn (Phase 7 - Recycle Art Studio).
Hãy đề xuất các ý tưởng tái chế THỰC TẾ, AN TOÀN và đúng với vật liệu sau:
- Vật thể: ${input.materialName || reusability.materialType}
- Nhóm vật liệu: ${reusability.materialType} (danh mục: ${reusability.materialCategory}, độ tin cậy: ${Math.round(reusability.materialConfidence * 100)}%)
- Tình trạng: ${reusability.objectCondition}
- Bộ phận tái sử dụng được: ${reusability.reusableComponents.join(', ') || 'Thân chính'}
- Hạn chế vật liệu: ${reusability.materialLimitations.join(' | ')}
- Kích thước ước lượng (cm): Cao=${input.dimensions?.heightCm ?? '?'}, Rộng=${input.dimensions?.widthCm ?? '?'}, Dài=${input.dimensions?.lengthCm ?? '?'}
- Ghi chú người dùng: "${input.userNotes || 'Ưu tiên ý tưởng hữu ích, dễ làm tại nhà/trường học.'}"

QUY TẮC BẮT BUỘC:
1. Chỉ đề xuất sản phẩm khả thi đúng chất liệu thật (Ví dụ: KHÔNG làm nhà carton từ chai nhựa nhỏ; KHÔNG cắt thủy tinh bằng kéo/nhiệt; KHÔNG làm chậu thủy canh chứa nước bằng bìa giấy trần).
2. TUYỆT ĐỐI KHÔNG dùng lửa, đốt/nung chảy nhựa, axit, dung môi độc hại, tháo pin, hay máy công nghiệp.
3. Ghi rõ cảnh báo người lớn hỗ trợ (needsAdultSupervision) nếu có cắt dao/kim loại hoặc dùi lỗ.
4. Mỗi ý tưởng có đủ bước Preparation, Materials, Tools, Steps (ngắn gọn, rõ ràng), Expected Result và Safety Notes.`;

      const candidateModels = [GEMINI_ADVISOR_MODEL, GEMINI_ADVISOR_FALLBACK_MODEL];
      const activeModels = candidateModels.filter((m) => !isModelInCooldown(m));
      const advisorModels =
        activeModels.length > 0 ? activeModels : [GEMINI_ADVISOR_FALLBACK_MODEL];

      for (const modelName of advisorModels) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          const geminiCall = ai.models.generateContent({
            model: modelName,
            contents: [{ text: prompt }],
            config: {
              responseMimeType: 'application/json',
              responseSchema: PHASE7_CRAFT_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });

          const timeoutGuard = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Gemini Phase 7 (${modelName}) timeout`)), 15000);
          });

          const res = (await Promise.race([geminiCall, timeoutGuard])) as any;
          if (timer) clearTimeout(timer);
          if (res?.text) {
            clearModelCooldown(modelName);
            const parsed = JSON.parse(res.text);
            const mapRaw = (p: any, idx: number, type: '100_percent_recycled' | 'with_added_materials'): CraftProduct => ({
              id: `ai_p7_${Date.now()}_${idx}`,
              title: p.title || 'Sản phẩm tái chế sáng tạo',
              description: p.description || '',
              category: p.category || 'decor',
              categoryLabel: p.categoryLabel || 'Đồ dùng sáng tạo',
              type,
              imageUrl: '',
              model3DType: p.model3DType || 'bottle_pot',
              difficulty: p.difficulty || 'Dễ',
              estimatedTime: p.estimatedTime || '30 phút',
              recycledMaterialRatio: Number(p.recycledMaterialRatio || (type === '100_percent_recycled' ? 100 : 80)),
              materialsUsed: Array.isArray(p.materialsUsed) ? p.materialsUsed : [],
              materialsNeededExtra: Array.isArray(p.materialsNeededExtra) ? p.materialsNeededExtra : [],
              toolsRequired: Array.isArray(p.toolsRequired) ? p.toolsRequired : ['Kéo thủ công', 'Thước kẻ'],
              dimensionsFinished: p.dimensionsFinished || { lengthCm: 12, widthCm: 10, heightCm: 15 },
              whySuitable: p.whySuitable || reusability.suitabilitySummary,
              preparation: p.preparation,
              expectedResult: p.expectedResult
                ? { ...p.expectedResult, previewDisclaimer: CONCEPT_3D_PREVIEW_DISCLAIMER }
                : undefined,
              safetyNotes: p.safetyNotes,
              steps: Array.isArray(p.steps) ? p.steps : [],
            });

            raw100 = (parsed.group100Percent || []).map((p: any, i: number) =>
              mapRaw(p, i, '100_percent_recycled')
            );
            rawAdded = (parsed.groupWithAddedMaterials || []).map((p: any, i: number) =>
              mapRaw(p, i + 10, 'with_added_materials')
            );
            engineUsed = 'gemini';
            break;
          }
        } catch (err) {
          if (timer) clearTimeout(timer);
          markModelCooldown(modelName, err);
          console.warn(`Gemini Phase 7 (${modelName}) fallback:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn('Gemini Phase 7 advisor fallback to deterministic curated rules:', err);
    }
  }

  // Always run strict safety + relevance audit; fallback cleanly if empty or blocked
  const fallback = buildCuratedIdeasForMaterial(reusability, input);
  const res100 = filterAndSanitizeCraftList(raw100, reusability, input);
  const resAdded = filterAndSanitizeCraftList(rawAdded, reusability, input);

  const safeFallback100 = filterAndSanitizeCraftList(fallback.group100Percent, reusability, input);
  const safeFallbackAdded = filterAndSanitizeCraftList(fallback.groupWithAddedMaterials, reusability, input);

  const final100 = res100.valid.length > 0 ? res100.valid : safeFallback100.valid;
  const finalAdded = resAdded.valid.length > 0 ? resAdded.valid : safeFallbackAdded.valid;
  const blockedHazards = [...res100.blockedHazards, ...resAdded.blockedHazards];

  const allAccepted = [...final100, ...finalAdded];
  const requiresAdultSupervision =
    reusability.requiresAdultSupervision ||
    allAccepted.some((c) => Boolean(c.adultSupervisionRequired));

  return {
    reusability,
    group100Percent: final100,
    groupWithAddedMaterials: finalAdded,
    safetyCompliance: {
      isSafe: true,
      requiresAdultSupervision,
      blockedHazards,
      safetyNotes: Array.from(
        new Set([
          ...(requiresAdultSupervision
            ? ['Có bước sử dụng dụng cụ cắt/ghép cần người lớn giám sát.']
            : []),
          ...reusability.recommendedSafeActions,
        ])
      ),
      prohibitedMethodsReminder: PROHIBITED_METHODS_NOTICE,
    },
    engineUsed,
    disclaimer3D: CONCEPT_3D_PREVIEW_DISCLAIMER,
  };
}

export function buildSafeFallbackIdeas(
  reusability: MaterialReusabilityAnalysis,
  input: RecyclingAdvisorInput
): { group100Percent: CraftProduct[]; groupWithAddedMaterials: CraftProduct[] } {
  if (
    reusability.suitabilityForManualCrafting === 'unsafe' ||
    reusability.suitabilityForManualCrafting === 'insufficient_data'
  ) {
    return { group100Percent: [], groupWithAddedMaterials: [] };
  }
  const raw = buildCuratedIdeasForMaterial(reusability, input);
  return {
    group100Percent: filterAndSanitizeCraftList(raw.group100Percent, reusability, input).valid,
    groupWithAddedMaterials: filterAndSanitizeCraftList(raw.groupWithAddedMaterials, reusability, input).valid,
  };
}

