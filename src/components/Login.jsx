import { useState } from 'react'
import pb from '../pocketbase'

function Login() {
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [disabledAccount, setDisabledAccount] = useState(false)
  const [reactivating, setReactivating] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setDisabledAccount(false)

    if (!identity || !password) {
      setError('Please fill in both fields')
      return
    }

    setLoading(true)

    try {
      await pb.collection('users').authWithPassword(identity, password)

      if (pb.authStore.model.account_disabled) {
        setDisabledAccount(true)
      }
    } catch (err) {
      console.error(err)
      setError('Incorrect email/username or password, or your account is not verified yet')
    } finally {
      setLoading(false)
    }
  }

  const handleReactivate = async () => {
    setReactivating(true)
    try {
      await pb.collection('users').update(pb.authStore.model.id, { account_disabled: false })
      await pb.collection('users').authRefresh()
      setDisabledAccount(false)
    } catch (err) {
      console.error('Reactivate error:', err)
      setError('Something went wrong reactivating your account')
    } finally {
      setReactivating(false)
    }
  }

  const handleCancelReactivate = () => {
    pb.authStore.clear()
    setDisabledAccount(false)
  }

  if (disabledAccount) {
    return (
      <div>
        <h1>Your account is disabled</h1>
        <p>You chose to temporarily disable your account. Reactivate it now to continue?</p>
        <button onClick={handleReactivate} disabled={reactivating}>
          {reactivating ? 'Reactivating...' : 'Reactivate My Account'}
        </button>
        <button onClick={handleCancelReactivate}>Log Out</button>
      </div>
    )
  }

  return (
    <div>
      <h1>Log in to Orbit</h1>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Email or Username</label>
          <br />
          <input
            type="text"
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