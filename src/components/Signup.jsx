import { useState } from 'react'
import pb from '../pocketbase'

function Signup() {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [dmPrivacy, setDmPrivacy] = useState('request_to_dm')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (username.length < 6 || username.length > 10) {
      setError('Username must be between 6 and 10 characters')
      return
    }
    if (displayName.length < 3 || displayName.length > 20) {
      setError('Display name must be between 3 and 20 characters')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    try {
      await pb.collection('users').create({
        email,
        password,
        passwordConfirm: confirmPassword,
        username,
        name: displayName,
        dm_privacy: dmPrivacy,
      })

      await pb.collection('users').requestVerification(email)

      setSuccess(true)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong creating your account')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div>
        <h1>Check your email</h1>
        <p>We've sent a verification link to {email}. Click it to activate your account.</p>
      </div>
    )
  }

  return (
    <div>
      <h1>Create your Orbit account</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Email</label>
          <br />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label>Username</label>
          <br />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        <div>
          <label>Display Name</label>
          <br />
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
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

        <div>
          <label>Confirm Password</label>
          <br />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <div>
          <label>Who can DM you?</label>
          <br />
          <label>
            <input
              type="radio"
              name="dmPrivacy"
              value="request_to_dm"
              checked={dmPrivacy === 'request_to_dm'}
              onChange={(e) => setDmPrivacy(e.target.value)}
            />
            Request to DM (recommended)
          </label>
          <br />
          <label>
            <input
              type="radio"
              name="dmPrivacy"
              value="friends_only"
              checked={dmPrivacy === 'friends_only'}
              onChange={(e) => setDmPrivacy(e.target.value)}
            />
            Friends only
          </label>
          <br />
          <label>
            <input
              type="radio"
              name="dmPrivacy"
              value="everyone"
              checked={dmPrivacy === 'everyone'}
              onChange={(e) => setDmPrivacy(e.target.value)}
            />
            Everyone
          </label>
          <br />
          <label>
            <input
              type="radio"
              name="dmPrivacy"
              value="no_one"
              checked={dmPrivacy === 'no_one'}
              onChange={(e) => setDmPrivacy(e.target.value)}
            />
            No one
          </label>
        </div>

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
      </form>
    </div>
  )
}

export default Signup