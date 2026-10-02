import { useState } from 'react'
import { createPortal } from 'react-dom'
import { BADGE_TIERS, badgeForUser, subscriptionStart, formatSubscriberSince } from '../badges'

// Hero-style subscriber badge showcase (Settings → Orbit+). All tiers are
// shown so users can see the full ladder; the user's current tier is lifted
// and glows in its own colour.
function BadgeShowcase({ user, onGetPlan }) {
  const current = badgeForUser(user)
  const since = formatSubscriberSince(subscriptionStart(user))
  const [tip, setTip] = useState(null)

  return (
    <div className="badge-hero">
      <div
        className="badge-hero-glow"
        style={current ? { background: `radial-gradient(closest-side, ${current.colour}55, transparent)` } : undefined}
      />

      <h1 className="badge-hero-title">Stay subscribed. Watch your badge grow.</h1>
      <p className="badge-hero-sub">
        Every month on Orbit+ or Orbit Premium levels up your profile badge — from Bronze to Astral.
        A badge that shows your history with Orbit at a glance.
      </p>

      <div className="badge-hero-grid">
        {BADGE_TIERS.map((tier) => {
          const active = current?.key === tier.key
          return (
            <div
              key={tier.key}
              className={`badge-hero-item${active ? ' active' : ''}`}
              style={active ? { borderColor: tier.colour, '--badge-colour': tier.colour } : undefined}
              onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, tier })}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, tier })}
              onMouseLeave={() => setTip(null)}
            >
              <img src={tier.image} alt={`${tier.name} badge`} className="badge-hero-img" />
              <div className="badge-hero-name" style={{ color: tier.colour }}>{tier.name}</div>
              <div className="badge-hero-label">{tier.label}</div>
              {active && <div className="badge-hero-current">Your badge</div>}
            </div>
          )
        })}
      </div>

      {current ? (
        <p className="badge-hero-status">
          You're <strong style={{ color: current.colour }}>{current.name}</strong>
          {since ? ` — subscribed since ${since}.` : '.'} Keep it up to reach the next tier.
        </p>
      ) : (
        <>
          <p className="badge-hero-status">Not subscribed yet? Your badge starts at Bronze on day one.</p>
          {onGetPlan && (
            <button className="btn-primary badge-hero-cta" onClick={onGetPlan}>
              Choose a plan
            </button>
          )}
        </>
      )}

      {tip && createPortal(
        <span className="profile-badge-tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <strong style={{ color: tip.tier.colour }}>{tip.tier.name} Badge</strong>
          <span>{tip.tier.label} subscribed</span>
        </span>,
        document.body
      )}
    </div>
  )
}

export default BadgeShowcase
