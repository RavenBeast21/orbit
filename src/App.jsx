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

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => {
      setIsLoggedIn(pb.authStore.isValid)
    })
    return () => unsubscribe()
  }, [])

  const handleLogout = () => {
    pb.authStore.clear()
    setPage('welcome')
  }

  const handleServerCreated = (server) => {
    setActiveServer(server)
    setPage('serverView')
  }

  if (isLoggedIn) {
    if (page === 'createServer') {
      return <CreateServer onCreated={handleServerCreated} />
    }

    if (page === 'serverView' && activeServer) {
      return <ServerView server={activeServer} />
    }

    return (
      <div>
        <h1>Welcome to Orbit, {pb.authStore.model.name}</h1>
        <p>You're logged in as @{pb.authStore.model.username}</p>
        <button onClick={() => setPage('createServer')}>Create a Server</button>
        <br />
        <br />
        <button onClick={handleLogout}>Log Out</button>
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