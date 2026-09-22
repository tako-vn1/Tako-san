import { ZodError } from 'zod';
import { CANONICAL_INGREDIENTS } from '@frigo/domain';
import {
  ExactQuantityDtoSchema,
  MoneyDtoSchema,
  type ExactQuantityDto,
  type MoneyDto,
} from '../../../../packages/domain/src/meal-shopping-api';
import { ApiError } from '../../services/http';

export type PlannerLocale = 'vi' | 'en';

const viCopy = {
  ui: {
    title: 'Kế hoạch bữa ăn',
    subtitle: 'Biết ăn gì, có gì và cần mua thêm gì.',
    generate: 'Lên kế hoạch',
    generating: 'Đang lên kế hoạch…',
    regenerate: 'Lên kế hoạch lại',
    refresh: 'Tải bản mới nhất',
    retry: 'Thử lại',
    cancel: 'Hủy',
    close: 'Đóng',
    back: 'Quay lại',
    loading: 'Đang tải kế hoạch…',
    empty: 'Chưa có kế hoạch bữa ăn',
    emptyHint: 'Chọn ngày bắt đầu và số người để tạo kế hoạch đầu tiên.',
    startDate: 'Ngày bắt đầu',
    horizonDays: 'Số ngày',
    servings: 'Khẩu phần',
    minutes: 'phút',
    cookNow: 'Chỉ dùng nguyên liệu đang có',
    shoppingAllowed: 'Có thể mua thêm nguyên liệu',
    details: 'Xem món ăn',
    swap: 'Đổi món',
    swapping: 'Đang đổi món…',
    alternatives: 'Chọn món thay thế',
    alternativesHint:
      'Máy chủ kiểm tra lại toàn bộ kế hoạch khi đổi món; danh sách này chưa xác nhận món phù hợp.',
    noAlternatives: 'Chưa có món thay thế để hiển thị.',
    shopping: 'Cần mua thêm',
    optimizeShopping: 'Xem gợi ý mua sắm',
    knownTotal: 'Chi phí đã biết',
    completeTotal: 'Tổng chi phí có dữ liệu giá đầy đủ',
    unknownPriceItems: 'Mục chưa đủ dữ liệu giá',
    knownPriceOnly: 'Chi phí đã biết không phải tổng cuối cùng khi còn thiếu giá.',
    budget: 'Ngân sách',
    budgetHint: 'Nhập số tiền không có dấu phân nhóm. Không tự làm tròn số tiền.',
    invalidBudget: 'Số tiền không hợp lệ, vượt giới hạn hỗ trợ hoặc có quá nhiều chữ số thập phân.',
    currency: 'Tiền tệ',
    hardBudget: 'Giới hạn ngân sách bắt buộc',
    softBudget: 'Ngân sách tham khảo',
    largestKnownCosts: 'Các chi phí lớn nhất đã biết',
    knownGap: 'Phần chi phí đã biết vượt ngân sách',
    required: 'Cần dùng',
    covered: 'Đã có trong kế hoạch',
    missing: 'Còn thiếu',
    packages: 'Gói mua được đề xuất',
    sourceMeals: 'Dùng cho các bữa',
    surplus: 'Dự kiến còn lại sau kế hoạch',
    surplusHint: 'Phần mua dư không đồng nghĩa với thực phẩm bị bỏ đi.',
    inventoryRemainder: 'Nguyên liệu đang có dự kiến còn lại',
    noPurchase: 'Đây chỉ là gợi ý. Không đặt mua hay thay đổi tồn kho.',
    noInventoryMutation: 'Lập kế hoạch không trừ nguyên liệu thực tế.',
    instructions: 'Cách nấu',
    noInstructions: 'Chưa có hướng dẫn đã được cung cấp cho món này.',
    ingredients: 'Nguyên liệu',
    unknownIngredient: 'Nguyên liệu chưa có tên hiển thị',
    unknownQuantity: 'Chưa xác định lượng',
    unknownPrice: 'Chưa có dữ liệu giá',
    unknownTime: 'Chưa biết thời gian nấu',
    unknownNutrition: 'Chưa đủ dữ liệu dinh dưỡng',
    optional: 'Tùy chọn',
    diagnostics: 'Thông tin tìm kiếm chi tiết',
    unplannedSlots: 'Bữa chưa được xếp',
    partialShopping: 'Danh sách chỉ bao gồm phần kế hoạch đã xếp được.',
    truncated: 'Đã chạm giới hạn tìm kiếm; kết quả chưa được chứng minh là tối ưu.',
    stale: 'Dữ liệu đã thay đổi. Lên kế hoạch lại trước khi xem gợi ý mua sắm.',
    freshnessHint: 'Cần kiểm tra lại tồn kho trước khi thực sự nấu.',
    explanation: 'Vì sao chọn món này?',
    deterministicExplanation: 'Giải thích từ dữ liệu và lý do của kế hoạch',
    explanationFallback:
      'Dùng lý do xác định từ kế hoạch; phần giải thích bổ sung hiện không khả dụng.',
    explanationUnavailable: 'Kế hoạch chưa cung cấp lý do để giải thích thêm.',
    unknownReason: 'Có thông tin bổ sung chưa được hỗ trợ hiển thị.',
    unknownState: 'Chưa xác định trạng thái',
    liked: 'Thích',
    disliked: 'Không thích',
    cooked: 'Đã nấu',
    skipped: 'Bỏ qua',
    feedbackSaved: 'Đã ghi nhận phản hồi',
    cookedHint: 'Chỉ ghi chú “đã nấu”; không trừ tồn kho và không tự đánh dấu thích.',
    safetyNotRequested: 'Chưa đánh giá ràng buộc an toàn; không có nghĩa là an toàn với dị ứng.',
    safetyRequestedOnly:
      'Chỉ kiểm tra các ràng buộc đã yêu cầu; không bảo đảm an toàn cho mọi dị ứng.',
  },
  mealTypes: { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối' },
  units: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    piece: 'cái',
    pack: 'gói',
    bunch: 'bó',
    slice: 'lát',
  },
  status: {
    feasible: 'Đã xếp đủ các bữa',
    partial: 'Mới xếp được một phần',
    infeasible: 'Không tìm được kế hoạch đáp ứng điều kiện',
    search_limited: 'Chưa tìm được kế hoạch trong giới hạn tìm kiếm',
    incomplete: 'Kết quả chưa đầy đủ',
  },
  conclusion: {
    feasible: 'Có kế hoạch đáp ứng điều kiện',
    proven_infeasible: 'Đã xác định không thể đáp ứng các điều kiện trong phạm vi dữ liệu hiện có',
    no_plan_found_without_proof: 'Chưa tìm được kế hoạch; chưa kết luận là không thể',
  },
  budget: {
    within_budget: 'Trong ngân sách',
    over_budget: 'Vượt ngân sách',
    unknown: 'Chưa thể xác nhận ngân sách',
    not_configured: 'Chưa đặt ngân sách',
  },
  shopping: {
    fulfilled: 'Đã có phương án mua',
    unfulfillable: 'Chưa thể đáp ứng nhu cầu mua',
    unknown: 'Chưa xác định khả năng mua',
  },
  requirement: {
    satisfied: 'Đủ lượng',
    partial: 'Có một phần',
    missing: 'Còn thiếu',
    unresolved: 'Chưa xác định',
  },
  waste: {
    at_risk: 'Có thể còn lại gần hạn dùng',
    no_dated_risk_in_horizon: 'Chưa thấy rủi ro theo ngày hạn trong kỳ này',
    unknown: 'Chưa đủ dữ liệu về rủi ro còn dư',
  },
  freshness: {
    stale_inventory: 'Tồn kho đã thay đổi',
    stale_preferences: 'Tùy chọn đã thay đổi',
    stale_catalog: 'Dữ liệu món ăn đã thay đổi',
    stale_history: 'Lịch sử hoặc phản hồi đã thay đổi',
    catalog_authority_changed: 'Nguồn danh mục món ăn đã thay đổi. Hãy lên kế hoạch lại.',
    planning_time_elapsed: 'Một phần lịch ăn đã qua',
    fresh: 'Đã kiểm tra dữ liệu hiện tại',
    requires_revalidation: 'Cần kiểm tra lại dữ liệu',
  },
  reasons: {
    unknown_canonical: 'Chưa xác định được nguyên liệu chuẩn',
    invalid_inventory: 'Dữ liệu tồn kho cần được kiểm tra',
    duplicate_lot: 'Các bản ghi trùng của thực phẩm có dữ liệu không khớp',
    incompatible_unit: 'Đơn vị tồn kho không tương thích với lượng cần dùng',
    context_required: 'Cần biết lượng thực tế trong gói để so sánh',
    expired: 'Thực phẩm quá hạn sử dụng không được tính vào lượng có thể dùng',
    unavailable: 'Thực phẩm hiện không có lượng dùng được',
    expiry_review_required: 'Cần kiểm tra lại thông tin hạn dùng',
    numeric_range: 'Số lượng vượt phạm vi tính toán được hỗ trợ',
    INVALID_CANDIDATE: 'Dữ liệu món không đủ điều kiện để đưa vào kế hoạch',
    CANDIDATE_MODE: 'Chưa xác nhận đủ nguyên liệu trong chế độ chỉ dùng tồn kho',
    INVENTORY_UNKNOWN_CANONICAL: 'Một số thực phẩm chưa được gắn với nguyên liệu chuẩn',
    INVENTORY_INVALID_INVENTORY: 'Một số dữ liệu tồn kho cần được kiểm tra',
    INVENTORY_DUPLICATE_LOT: 'Các bản ghi trùng của thực phẩm có dữ liệu không khớp',
    INVENTORY_INCOMPATIBLE_UNIT: 'Đơn vị tồn kho không tương thích với lượng cần dùng',
    INVENTORY_CONTEXT_REQUIRED: 'Cần biết lượng thực tế trong gói để tính tồn kho',
    INVENTORY_EXPIRED: 'Thực phẩm quá hạn sử dụng đã bị loại khỏi lượng có thể dùng',
    INVENTORY_UNAVAILABLE: 'Một số thực phẩm hiện không có lượng dùng được',
    INVENTORY_EXPIRY_REVIEW_REQUIRED: 'Thông tin hạn dùng của tồn kho cần được kiểm tra',
    INVENTORY_DUPLICATE_IGNORED: 'Bản ghi tồn kho trùng đã được bỏ qua để tránh tính hai lần',
    INVENTORY_HOUSEHOLD_MISMATCH: 'Tồn kho ngoài hộ gia đình này đã được loại khỏi kế hoạch',
    T02_INVALID_RECIPE: 'Dữ liệu công thức chưa hợp lệ để lập kế hoạch',
    T02_INVALID_FAMILY: 'Dữ liệu nhóm công thức chưa hợp lệ để lập kế hoạch',
    T02_REJECTED_SOURCE: 'Công thức đã bị từ chối khi duyệt nên không được sử dụng',
    T02_UNKNOWN_CANONICAL: 'Công thức có nguyên liệu chưa xác định',
    T02_REQUIRED_SHORTAGE: 'Thiếu nguyên liệu bắt buộc trong chế độ chỉ dùng tồn kho',
    T02_REQUIRED_UNRESOLVED: 'Chưa xác định đủ lượng nguyên liệu bắt buộc',
    T02_SEARCH_TRUNCATED: 'Tìm kiếm biến thể món đã chạm giới hạn',
    T02_NO_VARIANTS_FOR_MODE: 'Chưa tìm thấy biến thể phù hợp chế độ nguyên liệu đã chọn',
    T02_NUMERIC_RANGE: 'Số lượng trong công thức vượt phạm vi tính toán được hỗ trợ',
    T02_CANDIDATE_LIMIT: 'Đã chạm giới hạn số biến thể món được xét',
    T02_SEARCH_STATE_LIMIT: 'Đã chạm giới hạn số bước tìm biến thể món',
    SUBSTITUTION_INVALID_RULE: 'Quy tắc thay nguyên liệu chưa hợp lệ nên không được dùng',
    SUBSTITUTION_DUPLICATE_RULE: 'Quy tắc thay nguyên liệu bị trùng nên không được dùng',
    SUBSTITUTION_UNKNOWN_INGREDIENT: 'Quy tắc thay thế có nguyên liệu chưa xác định',
    OPTIMIZATION_TRUNCATED: 'Tìm phương án mua đã chạm giới hạn; chưa chứng minh tối ưu',
    NO_PURCHASE_FOUND_WITHOUT_PROOF: 'Chưa tìm thấy phương án mua; chưa kết luận là không thể',
    MEAL_PLAN_INCOMPLETE: 'Danh sách mua chỉ đánh giá phần kế hoạch đã xếp được',
    BUDGET_INFEASIBLE: 'Không thể đáp ứng ngân sách bắt buộc trong phạm vi giá đã được chứng minh',
    SOFT_BUDGET_TARGET_EXCEEDED: 'Chi phí đã chọn vượt ngân sách tham khảo',
    WITHIN_BUDGET: 'Phương án mua đã chọn nằm trong ngân sách',
    BEST_KNOWN_OVER_BUDGET: 'Phương án tìm được vượt ngân sách; chưa loại trừ phương án rẻ hơn',
    BUDGET_UNRESOLVED: 'Chưa đủ dữ liệu để xác nhận ngân sách',
    OUT_OF_STOCK: 'Phương án mua hiện hết hàng',
    PACKAGE_CONTENT_UNRESOLVED: 'Chưa xác định được lượng hoặc đơn vị trong gói mua',
    PURCHASE_EXPIRES_BEFORE_LAST_USE: 'Gói mua hết hạn trước bữa cuối cần dùng',
    PARTIAL_HORIZON_PURCHASE_UNSUPPORTED: 'Chưa hỗ trợ chia lần mua theo từng phần của lịch ăn',
    PURCHASE_EXPIRY_REVIEW_REQUIRED: 'Hạn dùng của gói mua cần được kiểm tra',
    AVAILABILITY_UNKNOWN: 'Chưa xác nhận tình trạng còn hàng của gói mua',
    UNSUPPORTED_CURRENCY: 'Giá không cùng tiền tệ đã chọn; không tự quy đổi',
    PRICE_AFTER_SNAPSHOT: 'Giá được ghi nhận sau thời điểm đánh giá nên chưa được tính',
    STALE_PRICE: 'Giá đã cũ và cần được kiểm tra lại',
    ESTIMATED_PRICE: 'Giá ước tính không được dùng làm giá đã xác nhận',
    OPTION_LIMIT: 'Đã giới hạn số lựa chọn gói mua được xét',
    REQUIREMENT_STATE_LIMIT: 'Đã chạm giới hạn tìm gói mua cho một nguyên liệu',
    TOTAL_STATE_LIMIT: 'Đã chạm giới hạn tìm kiếm toàn bộ phương án mua',
    PACKAGE_COUNT_LIMIT: 'Đã chạm giới hạn số gói mua được xét',
    HIGH_T03_UTILITY: 'Được xếp hạng cao trong các món đã xét',
    NUTRITION_BALANCE_SUPPORT: 'Hỗ trợ mục tiêu cân bằng dinh dưỡng của kế hoạch',
    COOK_TIME_PARTIAL: 'Chỉ có một phần dữ liệu thời gian nấu',
    NUTRITION_DATA_PARTIAL: 'Chỉ có một phần dữ liệu dinh dưỡng',
    BEAM_WIDTH: 'Đã giới hạn số nhánh kế hoạch được giữ lại',
    CANDIDATE_LIMIT_PER_SLOT: 'Đã giới hạn số món được xét cho mỗi bữa',
    CATALOG_FAMILY_LIMIT: 'Đã giới hạn số nhóm món được xét',
    CATALOG_RECIPE_LIMIT: 'Đã giới hạn số công thức được xét',
    MAX_SEARCH_STATES: 'Đã chạm giới hạn số bước tìm kiếm',
    SEARCH_LIMIT_REACHED: 'Tìm kiếm đã chạm giới hạn',
    BLOCKED_BY_EARLIER_SLOT: 'Bữa trước chưa xếp được nên chưa thể xếp bữa này',
    CATALOG_DATA_INCOMPLETE: 'Dữ liệu danh mục món ăn chưa đầy đủ',
    INVENTORY_NUMERIC_RANGE: 'Lượng tồn kho vượt phạm vi tính toán được hỗ trợ',
    PROJECTION_NUMERIC_RANGE: 'Lượng dự kiến vượt phạm vi tính toán được hỗ trợ',
    LOCK_UNAVAILABLE: 'Chưa thể đáp ứng lựa chọn đã khóa',
    MEAL_TYPE_CONSTRAINT: 'Không đáp ứng loại bữa ăn đã yêu cầu',
    NO_CANDIDATES_FOR_SLOT: 'Chưa tìm thấy món phù hợp cho bữa này',
    NO_FEASIBLE_TRANSITION: 'Chưa tìm thấy cách tiếp tục kế hoạch đáp ứng điều kiện',
    NO_PLAN_FOUND_WITHOUT_PROOF: 'Chưa tìm được kế hoạch; chưa kết luận là không thể',
    NUTRITION_CONSTRAINT: 'Không đáp ứng ràng buộc dinh dưỡng của kế hoạch',
    NUTRITION_MAX: 'Vượt mức dinh dưỡng tối đa đã yêu cầu',
    NUTRITION_MIN: 'Chưa đạt mức dinh dưỡng tối thiểu đã yêu cầu',
    PLAN_INCOMPLETE: 'Kế hoạch chưa đầy đủ',
    PROVEN_INFEASIBLE: 'Không thể đáp ứng điều kiện trong phạm vi dữ liệu đã xét',
    REPEAT_CONSTRAINT: 'Không đáp ứng giới hạn lặp món',
    T02_FAMILY_SEARCH_INCOMPLETE: 'Tìm kiếm các biến thể nhóm món chưa đầy đủ',
    UNRESOLVED_QUANTITY: 'Chưa xác định đủ lượng nguyên liệu',
    REQUIRES_SHOPPING: 'Cần mua thêm nguyên liệu',
    USES_EXPIRING_INGREDIENTS: 'Ưu tiên dùng nguyên liệu sắp đến hạn',
    USES_SOON_EXPIRING_STOCK: 'Ưu tiên dùng nguyên liệu sắp đến hạn',
    MATCHES_PREFERRED_CUISINE: 'Phù hợp khẩu vị của bạn',
    LOW_SHOPPING_BURDEN: 'Cần mua thêm ít nguyên liệu',
    USES_SUBSTITUTION: 'Có dùng nguyên liệu thay thế',
    AVAILABILITY_UNRESOLVED: 'Chưa xác định đủ lượng nguyên liệu',
    LIKED_RECIPE: 'Món bạn đã thích',
    DISLIKED_RECIPE: 'Món bạn đã không thích',
    LIKED_INGREDIENT: 'Có nguyên liệu bạn thích',
    DISLIKED_INGREDIENT: 'Có nguyên liệu bạn không thích',
    AVOIDED_CUISINE: 'Thuộc nhóm ẩm thực bạn ít ưu tiên',
    RECENT_SKIP_OR_SWAP: 'Gần đây bạn đã bỏ qua hoặc đổi món này',
    RECENTLY_EATEN: 'Gần đây đã ăn món này',
    RECENT_FAMILY_OR_CUISINE: 'Gần đây đã ăn món cùng nhóm hoặc ẩm thực',
    COOK_TIME_UNKNOWN: 'Chưa biết thời gian nấu',
    COOK_TIME_ABOVE_PREFERENCE: 'Thời gian nấu vượt mức bạn ưu tiên',
    NUTRITION_DATA_UNKNOWN: 'Chưa đủ dữ liệu dinh dưỡng',
    NUTRITION_DATA_INCOMPLETE: 'Chưa đủ dữ liệu dinh dưỡng',
    NUTRITION_ESTIMATED: 'Dữ liệu dinh dưỡng là ước tính',
    MEAL_TYPE_UNKNOWN: 'Chưa xác định nhóm bữa ăn của món',
    LOCK_PRESERVED: 'Giữ lại lựa chọn đã khóa',
    EXACT_RECIPE_REPEATED: 'Lặp lại món trong kế hoạch',
    RELATED_FAMILY_REPEATED: 'Lặp lại nhóm món trong kế hoạch',
    CUISINE_REPEATED: 'Lặp lại nhóm ẩm thực trong kế hoạch',
    IMPROVES_FUTURE_VARIETY: 'Tăng sự đa dạng cho các bữa tiếp theo',
    REUSES_AVAILABLE_INGREDIENT: 'Tận dụng nguyên liệu đang có',
    SEARCH_TRUNCATED: 'Tìm kiếm đã chạm giới hạn',
    COLD_START: 'Chưa có đủ phản hồi để cá nhân hóa',
    ALLERGEN_CONFLICT: 'Không đáp ứng ràng buộc dị ứng',
    DIETARY_CONFLICT: 'Không đáp ứng ràng buộc chế độ ăn',
    SAFETY_UNKNOWN: 'Chưa đủ dữ liệu để kiểm tra an toàn',
    FORBIDDEN_INGREDIENT: 'Có nguyên liệu bị loại trừ',
    NEVER_RECOMMEND: 'Món đã được loại khỏi gợi ý',
    COOKING_TIME_UNKNOWN: 'Chưa đủ dữ liệu để kiểm tra giới hạn thời gian',
    COOKING_TIME_LIMIT: 'Vượt giới hạn thời gian nấu',
    NUTRITION_UNKNOWN: 'Chưa đủ dữ liệu để kiểm tra ràng buộc dinh dưỡng',
    NUTRITION_CONFLICT: 'Không đáp ứng ràng buộc dinh dưỡng',
    NO_KNOWN_PRICE: 'Chưa có dữ liệu giá',
    NO_PURCHASE_OPTION: 'Chưa có phương án mua phù hợp',
    UNRESOLVED_PURCHASE_QUANTITY: 'Chưa xác định lượng cần mua',
    BEST_KNOWN_COST: 'Chi phí tốt nhất đã tìm được, chưa chứng minh tối ưu',
    LOWEST_KNOWN_COST: 'Chi phí thấp nhất trong phạm vi danh mục so sánh được',
    BOUNDED_COST_PREMIUM: 'Chọn phương án tăng chi phí trong giới hạn cho phép',
    LOWER_PURCHASE_SURPLUS: 'Phương án có ít phần mua dư hơn',
    PURCHASE_SURPLUS: 'Dự kiến có nguyên liệu mua dư sau kế hoạch',
    EXISTING_STOCK_AT_RISK: 'Nguyên liệu đang có có thể còn lại gần hạn dùng',
    PLAN_REGENERATION_RECOMMENDED: 'Nên lên kế hoạch lại để xem lựa chọn khác',
  },
  errors: {
    offline:
      'Không có kết nối. Chưa xác nhận được thay đổi; hãy kết nối lại và tải bản mới nhất trước khi thử lại.',
    auth: 'Phiên làm việc đã thay đổi. Vui lòng đăng nhập lại.',
    forbidden: 'Tài khoản hiện tại không có quyền dùng kế hoạch này.',
    unavailable: 'Không thể tải kế hoạch lúc này. Vui lòng thử lại sau.',
    invalid: 'Dữ liệu không hợp lệ. Kiểm tra lựa chọn hoặc tải lại kế hoạch.',
    rateLimited: 'Bạn thao tác quá nhanh. Vui lòng đợi trước khi thử lại.',
    notFound: 'Không tìm thấy kế hoạch này hoặc kế hoạch không thuộc tài khoản hiện tại.',
    conflict: 'Kế hoạch đã thay đổi. Tải bản mới nhất trước khi thử lại.',
    MEAL_PLANNER_DISABLED: 'Tính năng kế hoạch bữa ăn chưa được bật.',
    REGISTERED_ACCOUNT_REQUIRED: 'Đăng nhập bằng tài khoản đã đăng ký để dùng kế hoạch bữa ăn.',
    PLAN_REVISION_CONFLICT: 'Kế hoạch đã thay đổi. Tải bản mới nhất trước khi thử lại.',
    PLAN_REVALIDATION_REQUIRED: 'Dữ liệu nguồn đã thay đổi. Hãy lên kế hoạch lại.',
    CATALOG_AUTHORITY_CHANGED: 'Nguồn danh mục món ăn đã thay đổi. Hãy lên kế hoạch lại trước khi tiếp tục.',
    IDEMPOTENCY_CONFLICT:
      'Mã thử lại đã dùng cho thao tác khác. Tải lại trước khi gửi một thao tác mới.',
    SWAP_NOT_FEASIBLE:
      'Món thay thế không đáp ứng toàn bộ kế hoạch. Kế hoạch cũ vẫn được giữ nguyên.',
    REPLACEMENT_NOT_FOUND: 'Món thay thế không còn trong danh mục. Hãy tải lại danh sách.',
    SLOT_NOT_FOUND: 'Bữa ăn không còn trong bản kế hoạch này. Hãy tải bản mới nhất.',
    INVALID_PLANNING_HORIZON: 'Chọn các bữa trong tương lai và trong khoảng ngày lập kế hoạch.',
    INVALID_REQUEST: 'Kiểm tra lại lựa chọn trước khi gửi.',
    REQUEST_TOO_LARGE: 'Lựa chọn vượt giới hạn hỗ trợ. Hãy giảm số bữa.',
  },
};

type PlannerCopy = {
  [Section in keyof typeof viCopy]: Record<keyof (typeof viCopy)[Section], string>;
};

const enCopy: PlannerCopy = {
  ui: {
    title: 'Meal planner',
    subtitle: 'Know what to eat, what you have and what to buy.',
    generate: 'Create plan',
    generating: 'Creating your plan…',
    regenerate: 'Regenerate plan',
    refresh: 'Load latest plan',
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    loading: 'Loading your plan…',
    empty: 'No meal plan yet',
    emptyHint: 'Choose a start date and servings to create your first plan.',
    startDate: 'Start date',
    horizonDays: 'Days',
    servings: 'Servings',
    minutes: 'minutes',
    cookNow: 'Use only available ingredients',
    shoppingAllowed: 'Allow extra shopping',
    details: 'View meal',
    swap: 'Swap meal',
    swapping: 'Swapping meal…',
    alternatives: 'Choose a replacement',
    alternativesHint:
      'The server checks the whole plan when swapping; these choices are not yet confirmed suitable.',
    noAlternatives: 'No replacement choices are available.',
    shopping: 'Shopping needs',
    optimizeShopping: 'View shopping suggestions',
    knownTotal: 'Known cost',
    completeTotal: 'Total with complete price data',
    unknownPriceItems: 'Items without complete price data',
    knownPriceOnly: 'Known cost is not the final total when prices are missing.',
    budget: 'Budget',
    budgetHint: 'Enter an amount without grouping separators. Amounts are never rounded.',
    invalidBudget: 'Invalid amount, unsupported amount range or too many decimal places.',
    currency: 'Currency',
    hardBudget: 'Required budget limit',
    softBudget: 'Budget preference',
    largestKnownCosts: 'Largest known costs',
    knownGap: 'Known cost above budget',
    required: 'Required',
    covered: 'Covered in this plan',
    missing: 'Missing',
    packages: 'Suggested packages',
    sourceMeals: 'Used for',
    surplus: 'Projected remainder after this plan',
    surplusHint: 'Purchase surplus does not mean food will be wasted.',
    inventoryRemainder: 'Projected remaining existing stock',
    noPurchase: 'Suggestions only. No purchase or inventory change is performed.',
    noInventoryMutation: 'Planning does not consume actual inventory.',
    instructions: 'Cooking steps',
    noInstructions: 'No supplied cooking instructions are available for this meal.',
    ingredients: 'Ingredients',
    unknownIngredient: 'Ingredient name unavailable',
    unknownQuantity: 'Quantity unresolved',
    unknownPrice: 'Price unavailable',
    unknownTime: 'Cooking time unknown',
    unknownNutrition: 'Nutrition data incomplete',
    optional: 'Optional',
    diagnostics: 'Search details',
    unplannedSlots: 'Unplanned meals',
    partialShopping: 'This list covers only the planned part of the schedule.',
    truncated: 'Search reached a limit; this result is not proven optimal.',
    stale: 'Source data changed. Regenerate before requesting shopping suggestions.',
    freshnessHint: 'Inventory must be checked again before actual cooking.',
    explanation: 'Why this meal?',
    deterministicExplanation: 'Explanation from plan facts and reason codes',
    explanationFallback:
      'Showing deterministic plan reasons; additional explanation is unavailable.',
    explanationUnavailable: 'The plan has not supplied reasons for an additional explanation.',
    unknownReason: 'Additional information is not yet supported for display.',
    unknownState: 'Status unknown',
    liked: 'Like',
    disliked: 'Dislike',
    cooked: 'Cooked',
    skipped: 'Skip',
    feedbackSaved: 'Feedback recorded',
    cookedHint:
      'Records a cooked annotation only; no inventory is consumed and no like is implied.',
    safetyNotRequested: 'Safety constraints were not assessed; this does not mean allergy-safe.',
    safetyRequestedOnly:
      'Only requested constraints were checked; this is not a guarantee for all allergies.',
  },
  mealTypes: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' },
  units: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    piece: 'piece(s)',
    pack: 'pack(s)',
    bunch: 'bunch(es)',
    slice: 'slice(s)',
  },
  status: {
    feasible: 'All meals planned',
    partial: 'Partly planned',
    infeasible: 'No plan meets the constraints',
    search_limited: 'No plan found within search limits',
    incomplete: 'Incomplete result',
  },
  conclusion: {
    feasible: 'A plan meets the constraints',
    proven_infeasible: 'Constraints cannot be met within the supplied data scope',
    no_plan_found_without_proof: 'No plan found; impossibility has not been proven',
  },
  budget: {
    within_budget: 'Within budget',
    over_budget: 'Over budget',
    unknown: 'Budget status unconfirmed',
    not_configured: 'No budget configured',
  },
  shopping: {
    fulfilled: 'Purchase needs covered',
    unfulfillable: 'Purchase needs cannot be fulfilled',
    unknown: 'Purchase availability unknown',
  },
  requirement: {
    satisfied: 'Covered',
    partial: 'Partly covered',
    missing: 'Missing',
    unresolved: 'Unresolved',
  },
  waste: {
    at_risk: 'May remain near expiry',
    no_dated_risk_in_horizon: 'No dated risk detected within this horizon',
    unknown: 'Insufficient remainder risk data',
  },
  freshness: {
    stale_inventory: 'Inventory changed',
    stale_preferences: 'Preferences changed',
    stale_catalog: 'Recipe data changed',
    stale_history: 'History or feedback changed',
    catalog_authority_changed: 'The recipe catalog source changed. Regenerate the plan.',
    planning_time_elapsed: 'Some scheduled meals are in the past',
    fresh: 'Current source data checked',
    requires_revalidation: 'Source data needs revalidation',
  },
  reasons: {
    unknown_canonical: 'The canonical ingredient has not been identified',
    invalid_inventory: 'Inventory data needs review',
    duplicate_lot: 'Duplicate stock records contain conflicting data',
    incompatible_unit: 'The inventory unit cannot be compared with the required quantity',
    context_required: 'Package contents are needed to compare quantities',
    expired: 'Stock past its use-by date is not counted as usable',
    unavailable: 'No usable quantity is currently available',
    expiry_review_required: 'Expiry information needs review',
    numeric_range: 'Quantity exceeds the supported calculation range',
    INVALID_CANDIDATE: 'Recipe data is not eligible for planning',
    CANDIDATE_MODE: 'Not confirmed cookable from current stock in inventory-only mode',
    INVENTORY_UNKNOWN_CANONICAL: 'Some stock has no identified canonical ingredient',
    INVENTORY_INVALID_INVENTORY: 'Some inventory data needs review',
    INVENTORY_DUPLICATE_LOT: 'Duplicate stock records contain conflicting data',
    INVENTORY_INCOMPATIBLE_UNIT: 'The inventory unit cannot be compared with the required quantity',
    INVENTORY_CONTEXT_REQUIRED: 'Package contents are needed to assess inventory quantities',
    INVENTORY_EXPIRED: 'Stock past its use-by date was excluded from usable quantities',
    INVENTORY_UNAVAILABLE: 'Some stock has no usable quantity available',
    INVENTORY_EXPIRY_REVIEW_REQUIRED: 'Inventory expiry information needs review',
    INVENTORY_DUPLICATE_IGNORED: 'Duplicate stock records were ignored to avoid counting them twice',
    INVENTORY_HOUSEHOLD_MISMATCH: 'Stock outside this household was excluded from planning',
    T02_INVALID_RECIPE: 'Recipe data is invalid for planning',
    T02_INVALID_FAMILY: 'Recipe-family data is invalid for planning',
    T02_REJECTED_SOURCE: 'A rejected recipe was excluded from planning',
    T02_UNKNOWN_CANONICAL: 'A recipe contains an unidentified ingredient',
    T02_REQUIRED_SHORTAGE: 'Required ingredients are missing in inventory-only mode',
    T02_REQUIRED_UNRESOLVED: 'Required ingredient quantities are unresolved',
    T02_SEARCH_TRUNCATED: 'Recipe-variant search reached its limit',
    T02_NO_VARIANTS_FOR_MODE: 'No variant was found for the selected ingredient mode',
    T02_NUMERIC_RANGE: 'Recipe quantities exceed the supported calculation range',
    T02_CANDIDATE_LIMIT: 'The limit on evaluated recipe variants was reached',
    T02_SEARCH_STATE_LIMIT: 'The recipe-variant search-step limit was reached',
    SUBSTITUTION_INVALID_RULE: 'An invalid ingredient-substitution rule was not used',
    SUBSTITUTION_DUPLICATE_RULE: 'Duplicate ingredient-substitution rules were not used',
    SUBSTITUTION_UNKNOWN_INGREDIENT: 'A substitution rule contains an unidentified ingredient',
    OPTIMIZATION_TRUNCATED: 'Purchase search reached its limit; optimality is not proven',
    NO_PURCHASE_FOUND_WITHOUT_PROOF: 'No purchase option was found; impossibility is not proven',
    MEAL_PLAN_INCOMPLETE: 'Shopping evaluates only the planned portion of the meals',
    BUDGET_INFEASIBLE: 'The hard budget cannot be met within the proven price scope',
    SOFT_BUDGET_TARGET_EXCEEDED: 'The selected cost exceeds the soft budget target',
    WITHIN_BUDGET: 'The selected purchase option is within budget',
    BEST_KNOWN_OVER_BUDGET: 'The option found exceeds budget; cheaper options have not been ruled out',
    BUDGET_UNRESOLVED: 'There is not enough data to confirm the budget',
    OUT_OF_STOCK: 'The purchase option is out of stock',
    PACKAGE_CONTENT_UNRESOLVED: 'The purchase package quantity or unit is unresolved',
    PURCHASE_EXPIRES_BEFORE_LAST_USE: 'The purchase package expires before its last planned use',
    PARTIAL_HORIZON_PURCHASE_UNSUPPORTED: 'Splitting purchases across portions of the schedule is not supported',
    PURCHASE_EXPIRY_REVIEW_REQUIRED: 'Purchase package expiry needs review',
    AVAILABILITY_UNKNOWN: 'Availability of the purchase package has not been confirmed',
    UNSUPPORTED_CURRENCY: 'The price uses another currency; no conversion is assumed',
    PRICE_AFTER_SNAPSHOT: 'The price was recorded after this assessment and is not counted',
    STALE_PRICE: 'The price is stale and needs revalidation',
    ESTIMATED_PRICE: 'An estimated price is not treated as a confirmed price',
    OPTION_LIMIT: 'The limit on evaluated package options was reached',
    REQUIREMENT_STATE_LIMIT: 'The package-search limit for an ingredient was reached',
    TOTAL_STATE_LIMIT: 'The overall purchase-search limit was reached',
    PACKAGE_COUNT_LIMIT: 'The evaluated package-count limit was reached',
    HIGH_T03_UTILITY: 'Highly ranked among the recipes evaluated',
    NUTRITION_BALANCE_SUPPORT: 'Supports the plan’s nutrition balance target',
    COOK_TIME_PARTIAL: 'Cooking time data is only partly available',
    NUTRITION_DATA_PARTIAL: 'Nutrition data is only partly available',
    BEAM_WIDTH: 'The number of retained plan branches was limited',
    CANDIDATE_LIMIT_PER_SLOT: 'The number of recipes evaluated per meal was limited',
    CATALOG_FAMILY_LIMIT: 'The number of recipe families evaluated was limited',
    CATALOG_RECIPE_LIMIT: 'The number of recipes evaluated was limited',
    MAX_SEARCH_STATES: 'The search step limit was reached',
    SEARCH_LIMIT_REACHED: 'Search reached a limit',
    BLOCKED_BY_EARLIER_SLOT: 'An earlier unplanned meal prevents planning this meal',
    CATALOG_DATA_INCOMPLETE: 'Recipe catalog data is incomplete',
    INVENTORY_NUMERIC_RANGE: 'Inventory quantity exceeds the supported calculation range',
    PROJECTION_NUMERIC_RANGE: 'Projected quantity exceeds the supported calculation range',
    LOCK_UNAVAILABLE: 'The locked choice cannot currently be satisfied',
    MEAL_TYPE_CONSTRAINT: 'Does not meet the requested meal type',
    NO_CANDIDATES_FOR_SLOT: 'No suitable recipe found for this meal',
    NO_FEASIBLE_TRANSITION: 'No continuation meeting the plan constraints was found',
    NO_PLAN_FOUND_WITHOUT_PROOF: 'No plan found; impossibility has not been proven',
    NUTRITION_CONSTRAINT: 'Does not meet the plan’s nutrition constraint',
    NUTRITION_MAX: 'Exceeds the requested nutrition maximum',
    NUTRITION_MIN: 'Does not reach the requested nutrition minimum',
    PLAN_INCOMPLETE: 'The plan is incomplete',
    PROVEN_INFEASIBLE: 'Constraints cannot be met within the evaluated data scope',
    REPEAT_CONSTRAINT: 'Does not meet the recipe repetition limit',
    T02_FAMILY_SEARCH_INCOMPLETE: 'Recipe family variant search is incomplete',
    UNRESOLVED_QUANTITY: 'Ingredient quantity is unresolved',
    REQUIRES_SHOPPING: 'Requires extra shopping',
    USES_EXPIRING_INGREDIENTS: 'Prioritizes ingredients nearing expiry',
    USES_SOON_EXPIRING_STOCK: 'Prioritizes ingredients nearing expiry',
    MATCHES_PREFERRED_CUISINE: 'Matches your preferred cuisine',
    LOW_SHOPPING_BURDEN: 'Few extra ingredients needed',
    USES_SUBSTITUTION: 'Uses a substitution',
    AVAILABILITY_UNRESOLVED: 'Ingredient availability unresolved',
    LIKED_RECIPE: 'A recipe you liked',
    DISLIKED_RECIPE: 'A recipe you disliked',
    LIKED_INGREDIENT: 'Contains an ingredient you like',
    DISLIKED_INGREDIENT: 'Contains an ingredient you dislike',
    AVOIDED_CUISINE: 'A cuisine you prefer less',
    RECENT_SKIP_OR_SWAP: 'Recently skipped or swapped',
    RECENTLY_EATEN: 'Recently eaten',
    RECENT_FAMILY_OR_CUISINE: 'Similar recipe family or cuisine recently eaten',
    COOK_TIME_UNKNOWN: 'Cooking time unknown',
    COOK_TIME_ABOVE_PREFERENCE: 'Cooking time exceeds your preference',
    NUTRITION_DATA_UNKNOWN: 'Nutrition data incomplete',
    NUTRITION_DATA_INCOMPLETE: 'Nutrition data incomplete',
    NUTRITION_ESTIMATED: 'Nutrition values are estimates',
    MEAL_TYPE_UNKNOWN: 'Recipe meal type unknown',
    LOCK_PRESERVED: 'Preserves a locked choice',
    EXACT_RECIPE_REPEATED: 'Repeats a recipe in this plan',
    RELATED_FAMILY_REPEATED: 'Repeats a recipe family in this plan',
    CUISINE_REPEATED: 'Repeats a cuisine in this plan',
    IMPROVES_FUTURE_VARIETY: 'Adds variety to later meals',
    REUSES_AVAILABLE_INGREDIENT: 'Reuses available ingredients',
    SEARCH_TRUNCATED: 'Search reached a limit',
    COLD_START: 'Not enough feedback yet for personalization',
    ALLERGEN_CONFLICT: 'Does not meet an allergy constraint',
    DIETARY_CONFLICT: 'Does not meet a dietary constraint',
    SAFETY_UNKNOWN: 'Insufficient data to check safety',
    FORBIDDEN_INGREDIENT: 'Contains an excluded ingredient',
    NEVER_RECOMMEND: 'Recipe excluded from recommendations',
    COOKING_TIME_UNKNOWN: 'Insufficient data to check the time limit',
    COOKING_TIME_LIMIT: 'Exceeds the cooking time limit',
    NUTRITION_UNKNOWN: 'Insufficient data to check nutrition constraints',
    NUTRITION_CONFLICT: 'Does not meet a nutrition constraint',
    NO_KNOWN_PRICE: 'Price unavailable',
    NO_PURCHASE_OPTION: 'No suitable purchase option',
    UNRESOLVED_PURCHASE_QUANTITY: 'Purchase quantity unresolved',
    BEST_KNOWN_COST: 'Best known cost, not proven optimal',
    LOWEST_KNOWN_COST: 'Lowest known cost within the comparable catalog scope',
    BOUNDED_COST_PREMIUM: 'Selected a cost premium within the allowed bound',
    LOWER_PURCHASE_SURPLUS: 'Less purchase surplus',
    PURCHASE_SURPLUS: 'Projected purchase remainder after this plan',
    EXISTING_STOCK_AT_RISK: 'Existing stock may remain near expiry',
    PLAN_REGENERATION_RECOMMENDED: 'Consider regenerating the plan for other choices',
  },
  errors: {
    offline:
      'No connection. No change is confirmed; reconnect and load the latest plan before retrying.',
    auth: 'Your session changed. Please sign in again.',
    forbidden: 'Your current account cannot access this plan.',
    unavailable: 'Meal planning is unavailable right now. Please try again later.',
    invalid: 'Invalid data. Check your choices or reload the plan.',
    rateLimited: 'Too many requests. Please wait before trying again.',
    notFound: 'This plan was not found or is not available to your current account.',
    conflict: 'The plan changed. Load the latest version before retrying.',
    MEAL_PLANNER_DISABLED: 'Meal planning is not enabled.',
    REGISTERED_ACCOUNT_REQUIRED: 'Sign in with a registered account to use meal planning.',
    PLAN_REVISION_CONFLICT: 'The plan changed. Load the latest version before retrying.',
    PLAN_REVALIDATION_REQUIRED: 'Source data changed. Regenerate the plan first.',
    CATALOG_AUTHORITY_CHANGED: 'The recipe catalog source changed. Regenerate the plan before continuing.',
    IDEMPOTENCY_CONFLICT:
      'This retry key belongs to another action. Reload before submitting a new action.',
    SWAP_NOT_FEASIBLE:
      'The replacement cannot satisfy the full plan. Your previous plan is unchanged.',
    REPLACEMENT_NOT_FOUND: 'The replacement is no longer in the catalog. Reload the choices.',
    SLOT_NOT_FOUND: 'This meal is not in the current plan. Load the latest version.',
    INVALID_PLANNING_HORIZON: 'Choose future meals inside the planning date range.',
    INVALID_REQUEST: 'Check your choices before submitting.',
    REQUEST_TOO_LARGE: 'Your choices exceed the supported size. Select fewer meals.',
  },
};

export const plannerCopy = { vi: viCopy, en: enCopy };

export function plannerLocale(locale?: string): PlannerLocale {
  return /^en(?:-|$)/i.test(locale ?? '') ? 'en' : 'vi';
}

function label(map: Record<string, string>, key: string, fallback: string): string {
  return Object.hasOwn(map, key) ? map[key] : fallback;
}

export function reasonLabel(code: string, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)];
  return label(copy.reasons, code, copy.ui.unknownReason);
}

export function plannerStatusLabel(status: string, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)];
  return label(copy.status, status, copy.ui.unknownState);
}

export function plannerConclusionLabel(conclusion: string, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)];
  return label(copy.conclusion, conclusion, copy.ui.unknownState);
}

export function budgetStatusLabel(status: string, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)];
  return label(copy.budget, status, copy.budget.unknown);
}

export function shoppingStatusLabel(status: string, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)];
  return label(copy.shopping, status, copy.shopping.unknown);
}

export function wasteRiskLabel(status: string, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)];
  return label(copy.waste, status, copy.waste.unknown);
}

export function freshnessReasonLabel(reason: string, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)];
  return label(copy.freshness, reason, copy.ui.unknownReason);
}

export const freshnessLabel = freshnessReasonLabel;

export function ingredientLabel(id: string, locale?: string): string {
  const language = plannerLocale(locale);
  const ingredient = CANONICAL_INGREDIENTS.find((item) => item.id === id);
  return ingredient
    ? language === 'en'
      ? ingredient.nameEn
      : ingredient.nameVi
    : plannerCopy[language].ui.unknownIngredient;
}

const minorDigits: Record<MoneyDto['currency'], 0 | 2> = { VND: 0, JPY: 0, USD: 2, EUR: 2 };

export function formatMoney(money: MoneyDto | null | undefined, locale?: string): string {
  const language = plannerLocale(locale);
  const parsed = MoneyDtoSchema.safeParse(money);
  if (!parsed.success) return plannerCopy[language].ui.unknownPrice;
  const digits = minorDigits[parsed.data.currency];
  const amount = BigInt(parsed.data.minorAmount);
  const divisor = 10n ** BigInt(digits);
  const fraction = (amount % divisor).toString().padStart(digits, '0');
  const formatter = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency: parsed.data.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // Format the integral BigInt, then insert exact minor digits without floating point.
  return formatter
    .formatToParts(amount / divisor)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}

export function formatQuantity(
  quantity: ExactQuantityDto | null | undefined,
  locale?: string,
): string {
  const copy = plannerCopy[plannerLocale(locale)];
  const parsed = ExactQuantityDtoSchema.safeParse(quantity);
  if (!parsed.success) return copy.ui.unknownQuantity;
  return `${parsed.data.value} ${copy.units[parsed.data.unit]}`;
}

/** Decimal intent only; no grouping separators, rounding or out-of-range T05 budgets. */
export function parseBudgetMinorAmount(
  input: string,
  currency: MoneyDto['currency'],
  locale?: string,
): string | null {
  const digits = minorDigits[currency];
  if (digits === undefined || input.length > 100) return null;
  const pattern = plannerLocale(locale) === 'vi' ? /^(\d+)(?:[.,](\d+))?$/ : /^(\d+)(?:\.(\d+))?$/;
  const match = pattern.exec(input.trim());
  if (!match || (match[2]?.length ?? 0) > digits) return null;
  const exact = BigInt(match[1] + (match[2] ?? '').padEnd(digits, '0'));
  return exact <= 9007199254740991n ? exact.toString() : null;
}

export function plannerErrorMessage(error: unknown, locale?: string): string {
  const copy = plannerCopy[plannerLocale(locale)].errors;
  if (error instanceof ZodError) return copy.invalid;
  if (!(error instanceof ApiError)) return copy.unavailable;
  if (error.kind === 'offline') return copy.offline;
  const envelope = /^HTTP \d{3}: ([\s\S]*)$/.exec(error.message);
  if (envelope) {
    try {
      const body: unknown = JSON.parse(envelope[1]);
      if (
        body &&
        typeof body === 'object' &&
        'code' in body &&
        typeof body.code === 'string' &&
        Object.hasOwn(copy, body.code)
      )
        return label(copy, body.code, copy.unavailable);
    } catch {
      /* Never display arbitrary server text. */
    }
  }
  if (error.status === 403) return copy.forbidden;
  if (error.kind === 'auth') return copy.auth;
  if (error.status === 404) return copy.notFound;
  if (error.status === 409) return copy.conflict;
  if (error.status === 429) return copy.rateLimited;
  if (error.status === 400 || error.status === 413 || error.status === 422) return copy.invalid;
  return copy.unavailable;
}
