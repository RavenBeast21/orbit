import { useState } from 'react'
import pb from '../pocketbase'

function Login() {
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [mfaId, setMfaId] = useState(null)
  const [otpId, setOtpId] = useState(null)
  const [otpCode, setOtpCode] = useState('')
  const [mfaError, setMfaError] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!identity || !password) {
      setError('Please fill in both fields')
      return
    }

    setLoading(true)

    try {
      await pb.collection('users').authWithPassword(identity, password)
      console.log('Logged in successfully:', pb.authStore.model)
    } catch (err) {
      if (err.response?.mfaId) {
        // Password was correct, but this account has MFA enabled.
        // Request an OTP code to complete the second factor.
        try {
          const result = await pb.collection('users').requestOTP(identity)
          setOtpId(result.otpId)
          setMfaId(err.response.mfaId)
        } catch (otpErr) {
          console.error('OTP request error:', otpErr)
          setError('Something went wrong sending your login code. Please try again.')
        }
      } else {
        console.error(err)
        setError('Incorrect email or password, or your account is not verified yet')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    setMfaError('')

    if (!otpCode.trim()) {
      setMfaError('Enter the code sent to your email')
      return
    }

    setMfaLoading(true)
    try {
      await pb.collection('users').authWithOTP(otpId, otpCode.trim(), { mfaId })
      console.log('Logged in successfully with MFA:', pb.authStore.model)
    } catch (err) {
      console.error('OTP verify error:', err)
      setMfaError('Incorrect or expired code')
    } finally {
      setMfaLoading(false)
    }
  }

  if (mfaId) {
    return (
      <div>
        <h1>Enter your login code</h1>
        <p>We sent a one-time code to your email. It expires in a few minutes.</p>
        <form onSubmit={handleVerifyOtp}>
          <input
            type="text"
            placeholder="Enter code"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
          />
          <button type="submit" disabled={mfaLoading}>
            {mfaLoading ? 'Verifying...' : 'Verify'}
          </button>
        </form>
        {mfaError && <p style={{ color: 'red' }}>{mfaError}</p>}
      </div>
    )
  }

  return (
    <div>
      <h1>Log in to Orbit</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Email</label>
          <br />
          <input
            type="email"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            required
          />
        </div>

        <div>
          <label>Password</label>
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Log In'}
        </button>
      </form>
    </div>
  )
}

export default Login