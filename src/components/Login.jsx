import { useState } from 'react'
import pb from '../pocketbase'

function Login() {
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      console.error(err)
      setError('Incorrect email/username or password, or your account is not verified yet')
    } finally {
      setLoading(false)
    }
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