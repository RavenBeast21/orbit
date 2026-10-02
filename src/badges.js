// Orbit's evolving subscriber badges.
//
// Tenure-based (the longer someone stays subscribed, the higher the badge),
// using Orbit's own tiers and artwork. The threshold is the number of whole
// months of continuous subscription. `gold` at 6 months matches the example
// in the brief.
export const BADGE_TIERS = [
  { key: 'bronze', name: 'Bronze', months: 1, label: '1 Month', colour: '#c87f33', image: '/badges/bronze_badge.png' },
  { key: 'silver', name: 'Silver', months: 3, label: '3 Months', colour: '#c0c6cf', image: '/badges/silver_badge.png' },
  { key: 'gold', name: 'Gold', months: 6, label: '6 Months', colour: '#f5c542', image: '/badges/gold_badge.png' },
  { key: 'platinum', name: 'Platinum', months: 12, label: '1 Year', colour: '#6fd6d6', image: '/badges/platinum_badge.png' },
  { key: 'sapphire', name: 'Sapphire', months: 24, label: '2 Years', colour: '#3f6fe8', image: '/badges/sapphire_badge.png' },
  { key: 'emerald', name: 'Emerald', months: 36, label: '3 Years', colour: '#2ecc71', image: '/badges/emerald_badge.png' },
  { key: 'ruby', name: 'Ruby', months: 60, label: '5 Years', colour: '#e0264d', image: '/badges/ruby_badge.png' },
  { key: 'astral', name: 'Astral', months: 72, label: '6+ Years', colour: '#a855f7', image: '/badges/astral_badge.png' },
]

export function isSubscribed(user) {
  return !!user && (user.subscription_tier === 'plus' || user.subscription_tier === 'premium')
}

// The date the paid subscription began. Falls back to account creation for
// members who subscribed before `subscription_started_at` existed (a one-time
// gap until the Stripe webhook populates the field going forward).
export function subscriptionStart(user) {
  if (!user) return null
  const raw = user.subscription_started_at || user.created
  if (!raw) return null
  const d = new Date(String(raw).replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

export function monthsSince(date) {
  if (!date) return 0
  const now = new Date()
  let months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth())
  // Count the in-progress month once the monthly anniversary day has passed,
  // so a subscription spanning 3 calendar months (e.g. 17 Jul → 23 Sep) reads
  // as "3 months" rather than "2".
  if (now.getDate() > date.getDate()) months += 1
  return Math.max(0, months)
}

// The highest tier the user currently qualifies for, or null if not subscribed.
export function badgeForUser(user) {
  if (!isSubscribed(user)) return null
  const months = monthsSince(subscriptionStart(user))
  let current = BADGE_TIERS[0]
  for (const tier of BADGE_TIERS) {
    if (months >= tier.months) current = tier
  }
  return current
}

export function formatSubscriberSince(date) {
  if (!date) return ''
  try {
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}
