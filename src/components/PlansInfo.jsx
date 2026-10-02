import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import {
  ORBIT_LEVELS,
  ORBIT_BASE_PRICE,
  ORBIT_PRICE_PLUS,
  ORBIT_PRICE_PREMIUM,
} from '../plans'
import { isSubscribed, badgeForUser, subscriptionStart, formatSubscriberSince } from '../badges'

const TIER_NAMES = { plus: 'Orbit+', premium: 'Orbit Premium' }
const LEVEL_LABELS = { none: 'No Boosts', level_1: 'Level 1', level_2: 'Level 2', level_3: 'Level 3' }
const LEVEL_RANK = { none: 0, level_1: 1, level_2: 2, level_3: 3 }

// ---- Subscriptions -------------------------------------------------

export function SubscriptionsInfo({ user, onChoosePlan }) {
  const [orbitSubs, setOrbitSubs] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const rows = await pb.collection('user_orbits').getFullList({
          filter: `user="${user.id}" && source="standalone" && status != "expired"`,
          requestKey: null,
        })
        if (cancelled) return
        // Group by Stripe subscription so one purchase shows once.
        const bySub = {}
        rows.forEach((r) => {
          const key = r.stripe_subscription_id || r.id
          if (!bySub[key]) bySub[key] = { id: key, count: 0, periodEnd: r.current_period_end }
          bySub[key].count += 1
        })
        setOrbitSubs(Object.values(bySub))
      } catch (err) {
        console.error('Load subscriptions error:', err)
        if (!cancelled) setOrbitSubs([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [user.id])

  const mainSubscribed = isSubscribed(user)

  return (
    <div>
      <h2>Your Subscriptions</h2>
      <p style={{ color: 'var(--text)' }}>
        These are your current subscriptions. They'll be billed on the same billing cycle.
        You can update any subscription at any time.
      </p>

      {(mainSubscribed || (orbitSubs && orbitSubs.length > 0)) ? (
        <ul className="subscription-list">
          {mainSubscribed && (
            <li className="subscription-row">
              <span className="subscription-row-icon">⭐</span>
              <span className="subscription-row-main">
                <strong>{TIER_NAMES[user.subscription_tier]}</strong>
                <span className="subscription-row-sub">
                  {user.subscription_status || 'active'}
                  {subscriptionStart(user) ? ` · since ${formatSubscriberSince(subscriptionStart(user))}` : ''}
                  {badgeForUser(user) ? ` · ${badgeForUser(user).name} badge` : ''}
                </span>
              </span>
            </li>
          )}
          {orbitSubs && orbitSubs.map((s) => (
            <li key={s.id} className="subscription-row">
              <span className="subscription-row-icon">🚀</span>
              <span className="subscription-row-main">
                <strong>{s.count} Orbit{s.count > 1 ? 's' : ''}</strong>
                <span className="subscription-row-sub">
                  active{s.periodEnd ? ` · renews ${new Date(String(s.periodEnd).replace(' ', 'T')).toLocaleDateString()}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="subscription-empty-row">
          <span className="subscription-empty-icon">?</span>
          You have no active subscriptions
        </div>
      )}

      {onChoosePlan && (
        <button className="btn-primary" style={{ marginTop: '16px' }} onClick={onChoosePlan}>
          Browse plans
        </button>
      )}
    </div>
  )
}

// ---- Server Boosts -------------------------------------------------

const BOOST_PERKS = [
  { label: 'Emoji Slots', l1: '50', l2: '75', l3: '100' },
  { label: 'Sticker Slots', l1: '20', l2: '50', l3: '75' },
  { label: 'Audio Quality', l1: '128 kbps', l2: '256 kbps', l3: '384 kbps' },
  { label: 'Streaming Quality', l1: false, l2: '1080p30 / 720p60', l3: '1080p60 / 4K30' },
  { label: 'Upload Size (Free / Orbit+ / Premium)', l1: false, l2: '50 / 275 / 550 MB', l3: '75 / 300 / 600 MB' },
  { label: 'Animated Server Icon', l1: true, l2: true, l3: true },
  { label: 'Custom Invite Banner', l1: true, l2: true, l3: true },
  { label: 'Static Role Icons', l1: true, l2: true, l3: true },
  { label: 'Animated Role Icons', l1: false, l2: true, l3: true },
  { label: 'Gradient Role Icons', l1: false, l2: true, l3: true },
  { label: 'Global Server Emojis', l1: false, l2: '5', l3: '5' },
  { label: 'Custom Invite Link', l1: false, l2: false, l3: true },
  { label: 'Animated Server Banner', l1: false, l2: false, l3: true },
  { label: 'Accent, Font & Channel Styling', l1: false, l2: false, l3: true },
]

function PerkCell({ value }) {
  if (value === true) return <span style={{ color: 'var(--teal)' }}>✓</span>
  if (value === false || value == null) return <span style={{ color: 'var(--text)', opacity: 0.4 }}>✕</span>
  return <span>{value}</span>
}

export function ServerBoostsInfo({ user, onChoosePlan, onBoostServer }) {
  const [servers, setServers] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [owned, memberRecords] = await Promise.all([
          pb.collection('servers').getFullList({ filter: `owner="${user.id}"`, requestKey: null }),
          pb.collection('members').getFullList({ filter: `user="${user.id}"`, expand: 'server', requestKey: null }),
        ])
        if (cancelled) return
        const joined = memberRecords.map((m) => m.expand?.server).filter(Boolean)
        const byId = {}
        ;[...owned, ...joined].forEach((s) => { byId[s.id] = s })
        const combined = Object.values(byId)
        // Servers that most need a boost first (no boosts → lower level → higher).
        combined.sort((a, b) => (LEVEL_RANK[a.orbit_level] ?? 0) - (LEVEL_RANK[b.orbit_level] ?? 0))
        setServers(combined.slice(0, 5))
      } catch (err) {
        console.error('Load boost servers error:', err)
        if (!cancelled) setServers([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [user.id])

  return (
    <div>
      <h2>Server Boosts</h2>
      <p style={{ color: 'var(--text)' }}>
        Boosting a server unlocks perks for everyone in it. You can manage your Boosts here
        (add, remove or cancel) — just mind the cooldown before moving a Boost elsewhere.
      </p>

      <div className="boost-howto">
        <div className="boost-howto-icon">✨</div>
        <div>
          <strong>How do Boosts work?</strong>
          <p style={{ margin: '4px 0 0', color: 'var(--text)' }}>
            Spend Orbits on a server to raise its level. Levels stack, so a server keeps every
            perk it has unlocked. Each Orbit is a monthly subscription and can be moved between
            servers.
          </p>
        </div>
      </div>

      <div className="boost-banner">
        <div>
          <strong>Get 2 free Boosts with Premium</strong>
          <p style={{ margin: '2px 0 0', color: 'var(--text)' }}>
            Orbit Premium includes 2 Orbits to spend on servers every month.
          </p>
        </div>
        {onChoosePlan && <button className="btn-primary" onClick={onChoosePlan}>Get Premium</button>}
      </div>

      <h3 style={{ marginTop: '24px' }}>These servers could do with a Boost</h3>
      {servers === null && <p style={{ color: 'var(--text)' }}>Loading servers...</p>}
      {servers && servers.length === 0 && (
        <p style={{ color: 'var(--text)' }}>You're not in any servers yet.</p>
      )}
      {servers && servers.length > 0 && (
        <ul className="boost-server-list">
          {servers.map((server) => (
            <li key={server.id} className="boost-server-row">
              <span className="boost-server-icon">
                {server.icon ? (
                  <img src={pb.files.getURL(server, server.icon, { thumb: '48x48' })} alt="" />
                ) : (
                  (server.name || '?').slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="boost-server-main">
                <strong>{server.name}</strong>
                <span className="boost-server-sub">
                  {LEVEL_LABELS[server.orbit_level] || 'No Boosts'}
                </span>
              </span>
              <button className="btn-secondary" onClick={() => onBoostServer?.(server.id)}>
                🚀 Boost this server
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ marginTop: '28px' }}>What each Level unlocks</h3>
      <div className="boost-perks-table">
        <div className="boost-perks-head">
          <div>Perks</div>
          {ORBIT_LEVELS.map((level) => (
            <div key={level.key}>
              {level.name}<br /><span>{level.threshold} Orbits</span>
            </div>
          ))}
        </div>
        {BOOST_PERKS.map((row) => (
          <div key={row.label} className="boost-perks-row">
            <div>{row.label}</div>
            <div><PerkCell value={row.l1} /></div>
            <div><PerkCell value={row.l2} /></div>
            <div><PerkCell value={row.l3} /></div>
          </div>
        ))}
      </div>

      <div className="plan-info-card" style={{ maxWidth: '420px', marginTop: '24px' }}>
        <h3>Orbit price</h3>
        <div className="plan-info-price">£{ORBIT_BASE_PRICE.toFixed(2)}<span>/month</span></div>
        <ul className="plan-info-perks">
          <li>£{ORBIT_PRICE_PLUS.toFixed(2)}/month with Orbit+ (15% off)</li>
          <li>£{ORBIT_PRICE_PREMIUM.toFixed(2)}/month with Premium (30% off)</li>
          <li>Buy up to 10 at a time</li>
        </ul>
      </div>

      <p style={{ color: 'var(--text)', marginTop: '16px' }}>
        Levels are cumulative — Level 2 needs 9 active Orbits, Level 3 needs 18, and 18 total must
        be spent to fully unlock Level 3.
      </p>
    </div>
  )
}

// ---- Gifts / Billing -----------------------------------------------

export function GiftInventoryInfo() {
  return (
    <div>
      <h2>Gift Inventory</h2>
      <p style={{ color: 'var(--text)' }}>
        Orbit Premium members can gift a friend <strong>1 week of Premium</strong>, up to
        <strong> 3 people every 3 months</strong>.
      </p>
      <div className="plan-info-card" style={{ maxWidth: '420px' }}>
        <h3>Your gifts</h3>
        <p style={{ color: 'var(--text)', margin: 0 }}>
          No gift codes yet. Gifting opens once Premium is live.
        </p>
      </div>
    </div>
  )
}

export function BillingInfo({ user, onChoosePlan }) {
  const subscribed = isSubscribed(user)
  return (
    <div>
      <h2>Billing</h2>

      <div className="plan-info-card" style={{ maxWidth: '480px', marginBottom: '20px' }}>
        <h3>Payment method</h3>
        <p style={{ color: 'var(--text)', margin: 0 }}>No payment method on file.</p>
      </div>

      <div className="plan-info-card" style={{ maxWidth: '480px', marginBottom: '20px' }}>
        <h3>Invoices</h3>
        <p style={{ color: 'var(--text)', margin: 0 }}>No invoices yet.</p>
      </div>

      <div className="plan-info-card" style={{ maxWidth: '480px', marginBottom: '20px' }}>
        <h3>Billing address</h3>
        <p style={{ color: 'var(--text)', margin: 0 }}>
          A billing address is collected at checkout so tax can be calculated automatically.
        </p>
      </div>

      {!subscribed && onChoosePlan && (
        <button className="btn-primary" onClick={onChoosePlan}>View plans</button>
      )}

      <p style={{ color: 'var(--text)', fontSize: '0.85em', marginTop: '16px' }}>
        Payments aren't live yet — this is a preview of the billing area.
      </p>
    </div>
  )
}
