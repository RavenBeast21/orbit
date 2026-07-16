// App.jsx
import { useState, useEffect } from 'react'
import pb from './pocketbase'
import Login from './components/Login'
import Signup from './components/Signup'
import CreateServer from './components/CreateServer'
import ServerView from './components/ServerView'

function App() {
  const [view, setView] = useState('login')
  const [page, setPage] = useState('welcome')
  const [activeServer, setActiveServer] = useState(null)
  const [isLoggedIn, setIsLoggedIn] = useState(pb.authStore.isValid)
  const [myServers, setMyServers] = useState([])
  const [joinServerId, setJoinServerId] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => {
      setIsLoggedIn(pb.authStore.isValid)
    })
    return () => unsubscribe()
  }, [])

  const loadMyServers = async () => {
    try {
      const uid = pb.authStore.model.id

      const owned = await pb.collection('servers').getFullList({
        filter: `owner="${uid}"`,
      })

      const memberRecords = await pb.collection('members').getFullList({
        filter: `user="${uid}"`,
        expand: 'server',
      })
      const joined = memberRecords
        .map((m) => m.expand?.server)
        .filter(Boolean)

      const combined = [...owned]
      joined.forEach((s) => {
        if (!combined.find((existing) => existing.id === s.id)) {
          combined.push(s)
        }
      })

      setMyServers(combined)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    if (isLoggedIn && page === 'welcome') {
      loadMyServers()
    }
  }, [isLoggedIn, page])

  const handleLogout = () => {
    pb.authStore.clear()
    setPage('welcome')
  }

  const handleServerCreated = (server) => {
    setActiveServer(server)
    setPage('serverView')
  }

  const handleOpenServer = (server) => {
    setActiveServer(server)
    setPage('serverView')
  }

  const handleJoinServer = async (e) => {
    e.preventDefault()
    setJoinError('')

    if (!joinServerId.trim()) {
      setJoinError('Please enter a server ID')
      return
    }

    setJoinLoading(true)

    try {
      const uid = pb.authStore.model.id
      const server = await pb.collection('servers').getOne(joinServerId.trim())

      if (server.owner !== uid) {
        const existingMembership = await pb.collection('members').getFullList({
          filter: `user="${uid}" && server="${server.id}"`,
        })

        if (existingMembership.length === 0) {
          await pb.collection('members').create({
            user: uid,
            server: server.id,
          })
        }
      }

      setActiveServer(server)
      setPage('serverView')
      setJoinServerId('')
    } catch (err) {
      console.error(err)
      setJoinError('Server not found. Double check the ID.')
    } finally {
      setJoinLoading(false)
    }
  }

  if (isLoggedIn) {
    if (page === 'createServer') {
      return <CreateServer onCreated={handleServerCreated} />
    }

    if (page === 'serverView' && activeServer) {
      return (
        <ServerView
          server={activeServer}
          onBack={() => {
            setPage('welcome')
            setActiveServer(null)
          }}
        />
      )
    }

    return (
      <div>
        <h1>Welcome to Orbit, {pb.authStore.model.name}</h1>
        <p>You're logged in as @{pb.authStore.model.username}</p>
        <button onClick={() => setPage('createServer')}>Create a Server</button>
        <br />
        <br />
        <button onClick={handleLogout}>Log Out</button>

        <hr />

        <h2>Your Servers</h2>
        {myServers.length === 0 && <p>You're not in any servers yet.</p>}
        <ul>
          {myServers.map((server) => (
            <li key={server.id}>
              <button onClick={() => handleOpenServer(server)}>{server.name}</button>
              {' '}(ID: {server.id})
            </li>
          ))}
        </ul>

        <h2>Join a Server</h2>
        <form onSubmit={handleJoinServer}>
          <input
            type="text"
            placeholder="Paste server ID"
            value={joinServerId}
            onChange={(e) => setJoinServerId(e.target.value)}
          />
          <button type="submit" disabled={joinLoading}>
            {joinLoading ? 'Joining...' : 'Join'}
          </button>
        </form>
        {joinError && <p style={{ color: 'red' }}>{joinError}</p>}
      </div>
    )
  }

  return (
    <div>
      {view === 'login' ? <Login /> : <Signup />}

      <p>
        {view === 'login' ? (
          <>
            Don't have an account?{' '}
            <button onClick={() => setView('signup')}>Sign up</button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button onClick={() => setView('login')}>Log in</button>
          </>
        )}
      </p>
    </div>
  )
}

export default App