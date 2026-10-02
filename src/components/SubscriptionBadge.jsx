import { useState } from 'react'
import { createPortal } from 'react-dom'
import { badgeForUser, subscriptionStart, formatSubscriberSince } from '../badges'

// The evolving subscriber badge shown next to a user's name on profile
// surfaces. Tier is based on how long they've been subscribed (Orbit+ or
// Premium); hovering shows the tier name and the month the subscription began.
// Respects the user's own `hide_subscription_badge` opt-out.
function SubscriptionBadge({ user, size = 'normal' }) {
  const [tip, setTip] = useState(null)

  if (!user) return null
  if (user.hide_subscription_badge === true) return null

  const badge = badgeForUser(user)
  if (!badge) return null

  const since = formatSubscriberSince(subscriptionStart(user))
  const px = size === 'small' ? 15 : 18

  return (
    <span
      className="profile-badge-wrap"
      aria-label={`${badge.name} badge${since ? `, subscriber since ${since}` : ''}`}
      onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setTip(null)}
    >
      <img
        src={badge.image}
        alt={`${badge.name} badge`}
        className="profile-badge"
        style={{ width: px, height: px }}
      />
      {tip && createPortal(
        // Portaled to <body> so no popup/modal overflow or transform can clip
        // or misposition it.
        <span className="profile-badge-tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <strong style={{ color: badge.colour }}>{badge.name} Badge</strong>
          {since && <span>Subscriber since {since}</span>}
        </span>,
        document.body
      )}
    </span>
  )
}

export default SubscriptionBadge
