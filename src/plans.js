// Shared plan / boost data used by the Billing page, the Orbits boost panel,
// and the Settings sections. Kept in one place so prices and perk lists can't
// drift apart between screens.

export const PLAN_TIERS = [
  {
    key: 'plus',
    name: 'Orbit+',
    monthlyPrice: '£1.99',
    yearlyPrice: '£19.99',
    highlight: 'Custom emojis anywhere + 1080p60 streaming',
    perks: [
      'Custom emojis anywhere',
      'Native 250MB uploads (more at Server Level 2/3)',
      '1080p60 streaming',
      '3000 character message limit',
      'Custom entrance sounds when joining a call',
      'Custom notification sounds',
      'Custom app icon',
      'Exclusive Orbit+ badge',
      'Custom badge layout',
      '15% off Shop & Orbits',
      'Early access to new features (3 days early)',
    ],
  },
  {
    key: 'premium',
    name: 'Orbit Premium',
    monthlyPrice: '£5.99',
    yearlyPrice: '£59.99',
    highlight: '2 free Orbits every month + 4K60 streaming',
    perks: [
      'Everything in Orbit+',
      'Native 500MB uploads (more at Server Level 2/3)',
      '4K60 streaming',
      '4000 character message limit',
      '2 free Orbits every month',
      '30% off Shop & Orbits',
      'Global custom theming & per-server profiles',
      'Advanced Theme Builder (accent, background, sidebar, density, radius, font, transparency, animations)',
      'Custom sounds for mentions, DMs, calls, friend requests, mod alerts, and event reminders',
      'Early access to new features (1 week early)',
      'Gift a friend 1 week of Premium, up to 3 people, every 3 months',
    ],
  },
]

// Standalone Orbit (server boost) pricing. Discounted rates already reflect
// the Orbit+ (15%) and Premium (30%) plan discounts.
export const ORBIT_BASE_PRICE = 2.99
export const ORBIT_PRICE_PLUS = 2.54
export const ORBIT_PRICE_PREMIUM = 2.09

// Boost levels are CUMULATIVE active Orbits: Level 1 at 3, Level 2 at 9,
// Level 3 at 18 — matching pb_hooks/orbits.pb.js.
export const ORBIT_LEVELS = [
  {
    key: 'level_1',
    name: 'Level 1',
    threshold: 3,
    perks: [
      '50 Emoji Slots',
      '20 Sticker Slots',
      'Animated Server Icon',
      'Custom Server Invite Banner',
      '128 kbps Audio',
      'Chat Styling Pass',
      'Static Role Icons',
    ],
  },
  {
    key: 'level_2',
    name: 'Level 2',
    threshold: 9,
    perks: [
      '75 Emoji Slots',
      '50 Sticker Slots',
      'Animated Role Icons',
      'Gradient Role Icons',
      'Enhanced Role Styles',
      '1080p30 / 720p60 Streaming',
      '256 kbps Audio',
      '5 Global Server Emojis',
      'Uploads: 50MB (Free) / 275MB (Orbit+) / 550MB (Premium)',
    ],
  },
  {
    key: 'level_3',
    name: 'Level 3',
    threshold: 18,
    perks: [
      '100 Emoji Slots',
      '75 Sticker Slots',
      'Animated Server Banner',
      'Custom Invite Link',
      '384 kbps Audio',
      '1080p60 / 4K30 Streaming',
      'Uploads: 75MB (Free) / 300MB (Orbit+) / 600MB (Premium)',
      'Accent, Background, Button Style, Server Font & Channel Styling',
    ],
  },
]

export function planByKey(key) {
  return PLAN_TIERS.find((t) => t.key === key) || null
}
