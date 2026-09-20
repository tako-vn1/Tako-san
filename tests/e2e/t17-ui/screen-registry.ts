/**
 * T17 screen registry used for mechanical route/state certification.
 *
 * Numbering and mappings are the externally reviewer-verified Takosan Redesign
 * OS v2.0.0 contract. The route check and screen-contract proof are deliberately
 * separate: reaching a URL is not evidence that its content contract is met.
 */
export interface RegisteredScreen {
  id: string;
  name: string;
  path: string;
  /** Public surfaces render without a session. */
  auth: 'public' | 'session';
  /** Whether Home gating requires the onboarding flow to be completed first. */
  needsOnboarded?: boolean;
  /** Visible screen-contract proof: accessible content or a state marker. */
  contract: { heading?: RegExp; testId?: string; text?: RegExp };
  /** Primary navigation is hidden on immersive surfaces. */
  nav: 'visible' | 'hidden';
  source: 'reviewer-verified-kit';
}

export const SCREEN_REGISTRY: RegisteredScreen[] = [
  {
    id: '01',
    name: 'landing',
    path: '/landing',
    auth: 'public',
    contract: { heading: /Mở tủ lạnh\. Biết ngay hôm nay ăn gì\./ },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '02',
    name: 'auth',
    path: '/auth',
    auth: 'public',
    contract: { heading: /Đăng nhập vào Takosan/ },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '03',
    name: 'otp',
    path: '/auth/verify',
    auth: 'public',
    contract: { heading: /Xác thực mã OTP/ },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '04',
    name: 'onboarding-household',
    path: '/onboarding/household',
    auth: 'session',
    contract: {
      heading: /Nhà mình thường có bao nhiêu người ăn/,
      text: /Takosan dùng số người để tính khẩu phần phù hợp/,
    },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '05',
    name: 'onboarding-preferences',
    path: '/onboarding/preferences',
    auth: 'session',
    contract: {
      heading: /Nhà mình thích món gì và cần tránh gì/,
      text: /Nền ẩm thực yêu thích/,
    },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '06',
    name: 'onboarding-goals',
    path: '/onboarding/goals',
    auth: 'session',
    contract: {
      heading: /Xem lại sở thích của nhà mình/,
      testId: 'onboarding-preference-review',
    },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '07',
    name: 'home',
    path: '/',
    auth: 'session',
    needsOnboarded: true,
    contract: { heading: /Xin chào/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '08',
    name: 'scan',
    path: '/scan',
    auth: 'session',
    contract: { text: /Quét|Chụp|Camera/i },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '09',
    name: 'scan-review',
    path: '/scan/:id/review',
    auth: 'session',
    contract: { heading: /Kết quả nhận diện AI/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '10',
    name: 'fridge',
    path: '/fridge',
    auth: 'session',
    contract: { heading: /Tủ lạnh của tôi/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '11',
    name: 'fridge-detail',
    path: '/fridge/:id',
    auth: 'session',
    contract: { testId: 'lot-expiry' },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '12',
    name: 'recipes',
    path: '/recipes',
    auth: 'session',
    contract: { heading: /Gợi ý món ngon/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '13',
    name: 'recipe-detail',
    path: '/recipes/:slug',
    auth: 'session',
    contract: { heading: /Canh chua cá lóc/i },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '14',
    name: 'cook',
    path: '/cook/:slug',
    auth: 'session',
    contract: { text: /Bước tiếp theo|Hoàn thành nấu/ },
    nav: 'hidden',
    source: 'reviewer-verified-kit',
  },
  {
    id: '15',
    name: 'shopping',
    path: '/shopping',
    auth: 'session',
    contract: { heading: /Danh sách mua sắm/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '16',
    name: 'planner',
    path: '/planner',
    auth: 'session',
    contract: { heading: /Bữa ngon, tuần nhẹ nhàng|Kế hoạch bữa ăn/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '17',
    name: 'planner-meal',
    path: '/planner/:planId/meal/:slotId',
    auth: 'session',
    contract: {
      heading: /Bữa ngon, tuần nhẹ nhàng/,
      text: /Nguyên liệu cho bữa này/,
    },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '18',
    name: 'planner-shopping',
    path: '/planner/:planId/shopping',
    auth: 'session',
    contract: {
      heading: /Bữa ngon, tuần nhẹ nhàng/,
      text: /Chỉ mua phần còn thiếu theo kế hoạch/,
    },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '19',
    name: 'profile',
    path: '/me',
    auth: 'session',
    contract: { heading: /Hồ sơ/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '20',
    name: 'preferences',
    path: '/me/preferences',
    auth: 'session',
    contract: { heading: /Sở thích & hạn chế/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '21',
    name: 'household',
    path: '/me/household',
    auth: 'session',
    contract: { heading: /Hộ gia đình & chia sẻ/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '22',
    name: 'planning-settings',
    path: '/settings/planning',
    auth: 'session',
    contract: { heading: /Cài đặt lập thực đơn/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '23',
    name: 'notifications',
    path: '/notifications',
    auth: 'session',
    contract: { heading: /^Thông báo$/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '24',
    name: 'notification-preferences',
    path: '/settings/notifications',
    auth: 'session',
    contract: { heading: /Tùy chỉnh thông báo/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '25',
    name: 'app-settings',
    path: '/settings/app',
    auth: 'session',
    contract: { heading: /Cài đặt ứng dụng/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '26',
    name: 'privacy',
    path: '/settings/privacy',
    auth: 'session',
    contract: { heading: /Quyền riêng tư & dữ liệu/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
  {
    id: '27',
    name: 'plus',
    path: '/plus',
    auth: 'session',
    contract: { heading: /Takosan Plus/ },
    nav: 'visible',
    source: 'reviewer-verified-kit',
  },
];
