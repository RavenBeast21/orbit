import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import pb from '../pocketbase'
import { TOKEN_SERVER_URL, STRIPE_PUBLISHABLE_KEY } from '../config'
import { PLAN_TIERS } from '../plans'

const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY)

// TODO: replace these two with real Stripe yearly Price IDs once created
// (£19.99/yr for Orbit+, £59.99/yr for Premium — confirmed pricing) —
// server.js's PRICE_TIER_MAP needs the matching entries uncommented too
// before these will actually work.
const YEARLY_PRICE_ID_PLUS = 'price_REPLACE_WITH_REAL_PLUS_YEARLY_ID'
const YEARLY_PRICE_ID_PREMIUM = 'price_REPLACE_WITH_REAL_PREMIUM_YEARLY_ID'

// Live checkout isn't wired up yet. The plans, prices and comparison table
// are real; the Subscribe buttons just don't start a Stripe flow.
const PAYMENTS_ENABLED = false

// Stripe Price IDs are kept on the Billing page only; the display data
// (prices, perks, highlights) lives in ../plans so Settings can reuse it.
const PRICE_IDS = {
  plus: {
    monthlyPriceId: 'price_1TzZl3KFdvrZLKDRoZjIEXcn',
    yearlyPriceId: YEARLY_PRICE_ID_PLUS,
  },
  premium: {
    monthlyPriceId: 'price_1TzZmiKFdvrZLKDRl7OCmAPp',
    yearlyPriceId: YEARLY_PRICE_ID_PREMIUM,
  },
}

const TIERS = PLAN_TIERS.map((tier) => ({ ...tier, ...PRICE_IDS[tier.key] }))

// Comparison table rows, grouped like Discord's — [label, plusValue, premiumValue].
// true/false render as check/cross; strings render as-is.
const COMPARISON_GROUPS = [
  {
    title: 'Personalisation',
    rows: [
      ['Custom emojis anywhere', true, true],
      ['Custom notification sounds', true, true],
      ['Custom entrance sounds on call join', true, true],
      ['Custom app icon', true, true],
      ['Exclusive badge', true, true],
      ['Custom badge layout', true, true],
      ['Per-server profiles', false, true],
      ['Global custom theming', false, true],
      ['Advanced Theme Builder', false, true],
      ['Custom sounds per event (mentions/DMs/calls/etc)', false, true],
    ],
  },
  {
    title: 'Media & Quality',
    rows: [
      ['Uploads (native; more at Server L2/L3)', '250MB', '500MB'],
      ['Video streaming', '1080p60', '4K60'],
      ['Message character limit', '3000', '4000'],
    ],
  },
  {
    title: 'Server Boosts & Discounts',
    rows: [
      ['Free Orbits every month', false, '2'],
      ['Discount on Shop & Orbits', '15%', '30%'],
    ],
  },
  {
    title: 'Access',
    rows: [
      ['Early access to new features', '3 days early', '1 week early'],
      ['Gift free Premium to friends', false, 'Up to 3, every 3 months'],
    ],
  },
]

function ComparisonCell({ value }) {
  if (value === true) return <span style={{ color: 'var(--teal)' }}>✓</span>
  if (value === false) return <span style={{ color: 'var(--text)', opacity: 0.4 }}>✕</span>
  return <span>{value}</span>
}

// The actual payment form, rendered once we have a clientSecret from the
// backend. Kept as its own component because useStripe/useElements only
// work inside an <Elements> provider.
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
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button className="btn-primary" type="submit" disabled={!stripe || submitting}>
          {submitting ? 'Processing...' : 'Confirm Subscription'}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Billing({ onBack, onPurchaseComplete }) {
  const [currentTier, setCurrentTier] = useState('none')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [startingTier, setStartingTier] = useState(null)
  const [clientSecret, setClientSecret] = useState(null)
  const [checkoutTier, setCheckoutTier] = useState(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [billingPeriod, setBillingPeriod] = useState('monthly') // 'monthly' | 'yearly'

  const loadCurrentTier = async () => {
    setLoading(true)
    try {
      const user = await pb.collection('users').getOne(pb.authStore.model.id)
      setCurrentTier(user.subscription_tier || 'none')
    } catch (err) {
      console.error('Load subscription error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCurrentTier()
  }, [])

  const handleSubscribe = async (tier) => {
    setError('')
    if (!PAYMENTS_ENABLED) {
      setSuccessMessage('Subscriptions are coming soon — pricing is shown for reference.')
      setTimeout(() => setSuccessMessage(''), 3500)
      return
    }

    setStartingTier(tier.key)

    const priceId = billingPeriod === 'yearly' ? tier.yearlyPriceId : tier.monthlyPriceId

    if (priceId.startsWith('price_REPLACE')) {
      setError('Yearly billing isn\'t fully set up yet — try Monthly for now.')
      setStartingTier(null)
      return
    }

    try {
      const response = await fetch(`${TOKEN_SERVER_URL}/billing/create-subscription-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pb.authStore.token, priceId }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Something went wrong starting your subscription')
        return
      }

      setClientSecret(data.clientSecret)
      setCheckoutTier(tier)
    } catch (err) {
      console.error('Subscribe error:', err)
      setError('Network error contacting the billing server')
    } finally {
      setStartingTier(null)
    }
  }

  const handlePaymentSuccess = () => {
    setClientSecret(null)
    setCheckoutTier(null)
    setSuccessMessage("Payment confirmed! Your subscription may take a few seconds to activate.")
    // The webhook does the real activation — poll briefly so the UI catches up.
    setTimeout(loadCurrentTier, 2000)
    setTimeout(loadCurrentTier, 5000)
    if (onPurchaseComplete) onPurchaseComplete()
  }

  if (checkoutTier && clientSecret) {
    return (
      <div className="panel" style={{ maxWidth: '480px' }}>
        <h1>Subscribe to {checkoutTier.name}</h1>
        <p style={{ color: 'var(--text)' }}>
          {billingPeriod === 'yearly' ? checkoutTier.yearlyPrice + '/year' : checkoutTier.monthlyPrice + '/month'}
        </p>
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <CheckoutForm
            onSuccess={handlePaymentSuccess}
            onCancel={() => { setClientSecret(null); setCheckoutTier(null) }}
          />
        </Elements>
      </div>
    )
  }

  return (
    <div className="panel billing-page">
      {loading && <p style={{ color: 'var(--text)' }}>Loading your subscription status...</p>}
      {!loading && currentTier !== 'none' && (
        <p style={{ color: 'var(--teal)' }}>
          You're currently subscribed to {currentTier === 'plus' ? 'Orbit+' : 'Orbit Premium'}.
        </p>
      )}
      {successMessage && <p style={{ color: 'var(--teal)' }}>{successMessage}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      <h1 className="billing-hero-title">PICK YOUR PLAN</h1>

      <div className="billing-period-toggle">
        <button
          className={billingPeriod === 'monthly' ? 'btn-primary' : ''}
          onClick={() => setBillingPeriod('monthly')}
        >
          Monthly
        </button>
        <button
          className={billingPeriod === 'yearly' ? 'btn-primary' : ''}
          onClick={() => setBillingPeriod('yearly')}
        >
          Yearly
        </button>
      </div>

      <div className="billing-hero-cards">
        {TIERS.map((tier) => (
          <div key={tier.key} className={`billing-hero-card${tier.key === 'premium' ? ' billing-hero-card-featured' : ''}`}>
            <h2>{tier.name}</h2>
            <div className="billing-hero-price">
              {billingPeriod === 'yearly' ? tier.yearlyPrice : tier.monthlyPrice}
              <span style={{ fontSize: '0.5em', color: 'var(--text)' }}>
                /{billingPeriod === 'yearly' ? 'year' : 'month'}
              </span>
            </div>
            <p className="billing-hero-highlight">✨ {tier.highlight}</p>
            <button
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={() => handleSubscribe(tier)}
              disabled={startingTier === tier.key || currentTier === tier.key}
            >
              {currentTier === tier.key
                ? 'Current Plan'
                : startingTier === tier.key
                ? 'Starting...'
                : 'Subscribe'}
            </button>
          </div>
        ))}
      </div>

      <h1 className="billing-hero-title" style={{ marginTop: '48px' }}>COMPARE OUR PLANS</h1>

      <div className="comparison-table">
        <div className="comparison-header-row">
          <div />
          <div className="comparison-header-cell">Orbit+</div>
          <div className="comparison-header-cell comparison-header-cell-featured">Orbit Premium</div>
        </div>

        {COMPARISON_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="comparison-group-title">{group.title}</div>
            {group.rows.map(([label, plusVal, premiumVal]) => (
              <div key={label} className="comparison-row">
                <div>{label}</div>
                <div className="comparison-cell"><ComparisonCell value={plusVal} /></div>
                <div className="comparison-cell comparison-cell-featured"><ComparisonCell value={premiumVal} /></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Billing