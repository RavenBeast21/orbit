import { useState, useEffect } from 'react'
import pb from './pocketbase'
import Login from './components/Login'
import Signup from './components/Signup'

function App() {
  const [view, setView] = useState('login')
  const [isLoggedIn, setIsLoggedIn] = useState(pb.authStore.isValid)

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => {
      setIsLoggedIn(pb.authStore.isValid)
    })
    return () => unsubscribe()
  }, [])

  const handleLogout = () => {
    pb.authStore.clear()
  }

  if (isLoggedIn) {
    return (
      <div>
        <h1>Welcome to Orbit, {pb.authStore.model.name}</h1>
        <p>You're logged in as @{pb.authStore.model.username}</p>
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