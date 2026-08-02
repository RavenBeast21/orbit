import { useState, useEffect } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import pb from '../pocketbase'

const TOKEN_SERVER_URL = 'http://localhost:3001'
const STRIPE_PUBLISHABLE_KEY = 'pk_test_51TzZWVKFdvrZLKDR3jUpt8BuiP4cCT3cvl6naUQSsOIlGgbWpbY2KCk5B3ynmGruzlKJD6okzSXnskGj6DFoathQ00F7q7ni5c'

const stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY)

const TIERS = [
  {
    key: 'plus',
    name: 'Orbit+',
    price: '£1.99/mo',
    priceId: 'price_1TzZl3KFdvrZLKDRoZjIEXcn',
    perks: [
      'Custom emojis',
      '250MB uploads',
      'Per-server profiles',
      '2 free Server Boosts',
      '1080p60 video',
      'Animated avatar/banner',
      'Custom background',
      '3000 character message limit',
      'Custom notification sounds',
      'Discount on other in-app purchases',
    ],
  },
  {
    key: 'premium',
    name: 'Orbit Premium',
    price: '£5.99/mo',
    priceId: 'price_1TzZmiKFdvrZLKDRl7OCmAPp',
    perks: [
      'Everything in Orbit+',
      '500MB uploads',
      '4K60 video',
      '4000 character message limit',
      'Early access to new features',
      'Global custom theming',
      'Bigger discount on other in-app purchases',
    ],
  },
]

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
      <PaymentElement />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div style={{ marginTop: '12px' }}>
        <button type="submit" disabled={!stripe || submitting}>
          {submitting ? 'Processing...' : 'Confirm Subscription'}
        </button>
        {' '}
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Billing({ onBack }) {
  const [currentTier, setCurrentTier] = useState('none')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [startingTier, setStartingTier] = useState(null)
  const [clientSecret, setClientSecret] = useState(null)
  const [checkoutTier, setCheckoutTier] = useState(null)
  const [successMessage, setSuccessMessage] = useState('')

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
    setStartingTier(tier.key)

    try {
      const response = await fetch(`${TOKEN_SERVER_URL}/billing/create-subscription-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pb.authStore.token, priceId: tier.priceId }),
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
  }

  if (checkoutTier && clientSecret) {
    return (
      <div>
        <h1>Subscribe to {checkoutTier.name}</h1>
        <p>{checkoutTier.price}</p>
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
    <div>
      <button onClick={onBack}>← Back</button>
      <h1>Orbit+ & Premium</h1>

      {loading && <p>Loading your subscription status...</p>}
      {!loading && currentTier !== 'none' && (
        <p style={{ color: 'lightgreen' }}>
          You're currently subscribed to {currentTier === 'plus' ? 'Orbit+' : 'Orbit Premium'}.
        </p>
      )}
      {successMessage && <p style={{ color: 'lightgreen' }}>{successMessage}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '16px' }}>
        {TIERS.map((tier) => (
          <div key={tier.key} style={{ border: '1px solid #333', borderRadius: '8px', padding: '16px', width: '260px' }}>
            <h2>{tier.name}</h2>
            <p style={{ fontSize: '1.2em' }}>{tier.price}</p>
            <ul>
              {tier.perks.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
            <button
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
    </div>
  )
}

export default Billing