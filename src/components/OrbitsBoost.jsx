import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import pb from '../pocketbase'
import { TOKEN_SERVER_URL, STRIPE_PUBLISHABLE_KEY } from '../config'
import { ORBIT_LEVELS as LEVELS, ORBIT_BASE_PRICE, ORBIT_PRICE_PLUS, ORBIT_PRICE_PREMIUM } from '../plans'

const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY)

const MAX_ORBITS_PER_PURCHASE = 10

// Payments are intentionally not wired up yet (no live Stripe). Buttons
// still show the correct pricing but don't start a checkout.
const PAYMENTS_ENABLED = false

// The actual payment form — same pattern as Billing.jsx's CheckoutForm.
function CheckoutForm({ onSuccess, onCancel }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setError('')

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    })

    if (confirmError) {
      setError(confirmError.message || 'Payment failed')
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Full billing address is required for Stripe automatic tax. */}
      <PaymentElement options={{ fields: { billingDetails: { address: 'auto' } } }} />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div style={{ marginTop: '12px' }}>
        <button type="submit" disabled={!stripe || submitting}>
          {submitting ? 'Processing...' : 'Confirm Purchase'}
        </button>
        {' '}
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function LevelCard({ level, activeCount }) {
  const unlocked = activeCount >= level.threshold
  return (
    <div
      style={{
        border: `1px solid ${unlocked ? '#57F287' : '#333'}`,
        borderRadius: '8px',
        padding: '16px',
        width: '220px',
      }}
    >
      <h3 style={{ marginTop: 0 }}>{level.name}</h3>
      <ul style={{ paddingLeft: '18px', margin: 0 }}>
        {level.perks.map((perk) => (
          <li key={perk} style={{ fontSize: '0.85em', color: unlocked ? '#ddd' : 'gray' }}>
            {perk}
          </li>
        ))}
      </ul>
      <p style={{ marginBottom: 0, color: unlocked ? '#57F287' : 'gray' }}>
        {level.threshold} Boosts {unlocked ? '✓' : ''}
      </p>
    </div>
  )
}

function OrbitsBoost({ server, onOpenBilling }) {
  const uid = pb.authStore.model.id
  const isOwner = server.owner === uid

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // My own private balance — never shown to anyone but me.
  const [available, setAvailable] = useState(0)
  const [subscriptionTier, setSubscriptionTier] = useState('none')

  // Owner-only figures.
  const [spent, setSpent] = useState(0)

  // Shared.
  const [activeCount, setActiveCount] = useState(0)
  const [recentActivity, setRecentActivity] = useState([])

  const [quantity, setQuantity] = useState(1)
  const [starting, setStarting] = useState(false)
  const [clientSecret, setClientSecret] = useState(null)

  const discountRate = subscriptionTier === 'premium' ? 0.3 : subscriptionTier === 'plus' ? 0.15 : 0
  const pricePerOrbit = subscriptionTier === 'premium'
    ? ORBIT_PRICE_PREMIUM
    : subscriptionTier === 'plus'
    ? ORBIT_PRICE_PLUS
    : ORBIT_BASE_PRICE

  const loadData = async () => {
    setLoading(true)
    try {
      // All Orbits currently allocated to this server (drives level + the
      // public Recent Activity feed — this part IS visible to everyone).
      const allocatedToServer = await pb.collection('user_orbits').getFullList({
        filter: `allocated_to_server="${server.id}" && status="allocated"`,
        expand: 'user',
        sort: '-allocated_at',
      })
      setActiveCount(allocatedToServer.length)
      setRecentActivity(allocatedToServer.slice(0, 15))

      // My own un-allocated Orbits — PRIVATE. Only ever queried/rendered
      // for the logged-in user's own account, never shown to other members
      // or the server owner. This is not a public "who has how many Orbits"
      // feature — each user only ever sees their own number.
      const mine = await pb.collection('user_orbits').getFullList({
        filter: `user="${uid}" && status="available"`,
        sort: 'created',
      })
      setAvailable(mine.length)

      const me = await pb.collection('users').getOne(uid)
      setSubscriptionTier(me.subscription_tier || 'none')

      if (isOwner) {
        // Spent: Orbits THIS owner has personally given to THIS server.
        const mineSpentHere = allocatedToServer.filter((o) => o.user === uid)
        setSpent(mineSpentHere.length)
      }
    } catch (err) {
      console.error('Load Orbits error:', err)
      setError('Something went wrong loading Orbit data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    let unsub
    pb.collection('user_orbits').subscribe('*', (e) => {
      if (e.record.allocated_to_server === server.id || e.record.user === uid) {
        loadData()
      }
    }).then((fn) => { unsub = fn })

    return () => { if (unsub) unsub() }
  }, [server.id])

  const handleBoostFromBalance = async (orbitId) => {
    try {
      await pb.collection('user_orbits').update(orbitId, {
        allocated_to_server: server.id,
        status: 'allocated',
      })
    } catch (err) {
      console.error('Boost error:', err)
      setError(err.message || 'Something went wrong boosting this server')
    }
  }

  const handleSpendAvailableOrbit = async () => {
    setError('')
    try {
      const mine = await pb.collection('user_orbits').getFullList({
        filter: `user="${uid}" && status="available"`,
        sort: 'created',
      })
      if (mine.length === 0) {
        setError('You have no available Orbits right now.')
        return
      }
      await handleBoostFromBalance(mine[0].id)
      setSuccessMessage('Boosted! Thanks for supporting the server.')
      setTimeout(() => setSuccessMessage(''), 3000)
    } catch (err) {
      console.error(err)
    }
  }

  const handleBuyOrbits = async () => {
    setError('')
    if (!PAYMENTS_ENABLED) {
      setSuccessMessage('Orbit purchases are coming soon — pricing is shown for reference.')
      setTimeout(() => setSuccessMessage(''), 3500)
      return
    }
    setStarting(true)
    try {
      const response = await fetch(`${TOKEN_SERVER_URL}/billing/create-orbit-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pb.authStore.token, quantity }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Something went wrong starting your purchase')
        return
      }

      if (data.immediatelyActive) {
        setSuccessMessage('Orbits added to your balance!')
        setTimeout(() => setSuccessMessage(''), 3000)
        setTimeout(loadData, 1500)
        return
      }

      setClientSecret(data.clientSecret)
    } catch (err) {
      console.error('Buy Orbits error:', err)
      setError('Network error contacting the billing server')
    } finally {
      setStarting(false)
    }
  }

  const handlePaymentSuccess = () => {
    setClientSecret(null)
    setSuccessMessage('Payment confirmed! Your Orbits may take a few seconds to appear.')
    setTimeout(loadData, 2000)
    setTimeout(loadData, 5000)
  }

  if (clientSecret) {
    return (
      <div>
        <h1>Buy {quantity} Orbit{quantity > 1 ? 's' : ''}</h1>
        <p>£{(quantity * pricePerOrbit).toFixed(2)}/mo total</p>
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <CheckoutForm
            onSuccess={handlePaymentSuccess}
            onCancel={() => setClientSecret(null)}
          />
        </Elements>
      </div>
    )
  }

  return (
    <div>
      <h1>⭐ Server Boosts</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {successMessage && <p style={{ color: 'lightgreen' }}>{successMessage}</p>}

      <h2>Levels</h2>
      <p style={{ color: 'gray' }}>Your server will 'level up' automatically once it has enough active Boosts.</p>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        {LEVELS.map((level) => (
          <LevelCard key={level.key} level={level} activeCount={activeCount} />
        ))}
      </div>

      <hr />

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2>Recent Activity</h2>
          {loading && <p>Loading...</p>}
          {!loading && recentActivity.length === 0 && <p style={{ color: 'gray' }}>No boosts yet — be the first!</p>}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {recentActivity.map((orbit) => (
              <li key={orbit.id} style={{ marginBottom: '4px' }}>
                <strong>{orbit.expand?.user?.name || 'Someone'}</strong> gave 1 boost.
                {' '}
                <span style={{ color: 'gray', fontSize: '0.85em' }}>
                  {orbit.allocated_at ? new Date(orbit.allocated_at).toLocaleDateString() : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ width: '280px' }}>
          {isOwner ? (
            <>
              <h2>Server Boosts</h2>
              <p style={{ fontSize: '0.75em', color: 'gray', marginTop: '-8px' }}>
                Private — only you can see these numbers.
              </p>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '8px', flex: 1, textAlign: 'center' }}>
                  <strong>{available}</strong>
                  <br />
                  <span style={{ fontSize: '0.8em', color: 'gray' }}>Available</span>
                </div>
                <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '8px', flex: 1, textAlign: 'center' }}>
                  <strong>{spent}</strong>
                  <br />
                  <span style={{ fontSize: '0.8em', color: 'gray' }}>Spent</span>
                </div>
                <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '8px', flex: 1, textAlign: 'center' }}>
                  <strong>{activeCount}</strong>
                  <br />
                  <span style={{ fontSize: '0.8em', color: 'gray' }}>Total</span>
                </div>
              </div>
              {available > 0 ? (
                <button
                  onClick={handleSpendAvailableOrbit}
                  style={{ width: '100%', marginBottom: '16px' }}
                >
                  🚀 Spend an Available Orbit
                </button>
              ) : (
                <p style={{ color: 'gray', fontSize: '0.85em' }}>
                  No available Orbits to spend — buy some below to boost this server.
                </p>
              )}
            </>
          ) : (
            <>
              <h3>Become a Server Booster</h3>
              <p style={{ color: 'gray' }}>Boosting will unlock new perks for you and everyone in this server!</p>
              {available > 0 ? (
                <button onClick={handleSpendAvailableOrbit} style={{ width: '100%', marginBottom: '16px' }}>
                  🚀 Spend an Available Orbit
                </button>
              ) : (
                <p style={{ color: 'gray', fontSize: '0.85em' }}>
                  You have no available Orbits right now — buy one below, or get Orbit Premium for 2 free ones every month.
                </p>
              )}
            </>
          )}

          <hr />

          <h3>Buy Orbits</h3>

          {subscriptionTier !== 'premium' && (
            <div style={{ border: '1px solid #333', borderRadius: '6px', padding: '10px', marginBottom: '12px', fontSize: '0.85em' }}>
              💜 You could be paying {subscriptionTier === 'plus' ? 'even less' : '30% less'} for each Boost
              {subscriptionTier === 'none' && ' and get 2 free Boosts every month'} with{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); if (onOpenBilling) onOpenBilling() }}>
                Orbit Premium
              </a>!
            </div>
          )}

          <p style={{ color: 'gray', fontSize: '0.85em' }}>
            {discountRate > 0 ? (
              <>£{pricePerOrbit.toFixed(2)}/mo each <s style={{ opacity: 0.6 }}>£{ORBIT_BASE_PRICE.toFixed(2)}</s> ({Math.round(discountRate * 100)}% off with your plan)</>
            ) : (
              <>£{ORBIT_BASE_PRICE.toFixed(2)}/mo per Orbit</>
            )}
            . Buy up to {MAX_ORBITS_PER_PURCHASE} at a time — repeat as often as you like.
          </p>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              style={{ width: '32px' }}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span style={{ width: '32px', textAlign: 'center' }}>{quantity}</span>
            <button
              onClick={() => setQuantity((q) => Math.min(MAX_ORBITS_PER_PURCHASE, q + 1))}
              disabled={quantity >= MAX_ORBITS_PER_PURCHASE}
              style={{ width: '32px' }}
              aria-label="Increase quantity"
            >
              +
            </button>
            <span>Server Boost{quantity > 1 ? 's' : ''}</span>
          </div>
          <p style={{ color: 'gray', fontSize: '0.85em', marginTop: 0 }}>
            Subtotal: £{(quantity * pricePerOrbit).toFixed(2)}/mo
          </p>
          <button onClick={handleBuyOrbits} disabled={starting} style={{ width: '100%' }}>
            {starting ? 'Starting...' : `Buy ${quantity} Orbit${quantity > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OrbitsBoost