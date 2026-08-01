// App.jsx
import { useState, useEffect, useRef } from 'react'
import pb from './pocketbase'
import Login from './components/Login'
import Signup from './components/Signup'
import CreateServer from './components/CreateServer'
import ServerView from './components/ServerView'
import Friends from './components/Friends'
import DMs from './components/DMs'
import Settings from './components/Settings'
import ReportsQueue from './components/ReportsQueue'
import Discovery from './components/Discovery'

function App() {
  const [view, setView] = useState('login')
  const [page, setPage] = useState('welcome')
  const [activeServer, setActiveServer] = useState(null)
  const [isLoggedIn, setIsLoggedIn] = useState(pb.authStore.isValid)
  const [myServers, setMyServers] = useState([])
  const [joinServerId, setJoinServerId] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [dmTargetUserId, setDmTargetUserId] = useState(null)
  const [accountDisabled, setAccountDisabled] = useState(pb.authStore.model?.account_disabled || false)
  const activeConversationRef = useRef(null)
  const isFocusedRef = useRef(!document.hidden)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showTimerMenu, setShowTimerMenu] = useState(null)

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => {
      setIsLoggedIn(pb.authStore.isValid)
      setAccountDisabled(pb.authStore.model?.account_disabled || false)
      if (!pb.authStore.isValid) {
        setPage('welcome')
      }
    })
    return () => unsubscribe()
  }, [])

  const setUserStatus = async (status, durationMinutes) => {
    try {
      let expiresAt = null
      if (durationMinutes && durationMinutes !== 'forever') {
        expiresAt = new Date(Date.now() + durationMinutes * 60000).toISOString()
      }

      await pb.collection('users').update(pb.authStore.model.id, {
        status,
        status_expires_at: expiresAt,
      })
      await pb.collection('users').authRefresh()
      setShowStatusMenu(false)
      setShowTimerMenu(null)
    } catch (err) {
      console.error('Status update error:', err)
    }
  }

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
    if (isLoggedIn) {
      const model = pb.authStore.model
      const hasActiveStatus = model?.status_expires_at && new Date(model.status_expires_at) > new Date()
      const isPermanentManualStatus = model?.status && model.status !== 'online' && !model?.status_expires_at

      if (!hasActiveStatus && !isPermanentManualStatus) {
        setUserStatus('online', null)
      }
    }
  }, [isLoggedIn])

  useEffect(() => {
    if (!isLoggedIn) return

    const checkExpiry = () => {
      const model = pb.authStore.model
      if (model?.status_expires_at && new Date(model.status_expires_at) <= new Date()) {
        setUserStatus('online', null)
      }
    }

    checkExpiry()
    const interval = setInterval(checkExpiry, 30000)
    return () => clearInterval(interval)
  }, [isLoggedIn])

  useEffect(() => {
    const handleVisibility = () => {
      isFocusedRef.current = !document.hidden
    }
    const handleFocus = () => { isFocusedRef.current = true }
    const handleBlur = () => { isFocusedRef.current = false }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  const setActiveConversation = (conv) => {
    activeConversationRef.current = conv
  }

  useEffect(() => {
    if (!isLoggedIn) return

    const playSound = (file) => {
      const audio = new Audio(file)
      audio.play().catch((err) => console.error('Notification sound error:', err))
    }

    const handleServerMessage = async (e) => {
      if (e.action !== 'create') return
      if (e.record.sender === pb.authStore.model.id) return
      if (!pb.authStore.model.notif_message_sound) return

      try {
        const channel = await pb.collection('channels').getOne(e.record.channel)

        const memberRecords = await pb.collection('members').getFullList({
          filter: `user="${pb.authStore.model.id}" && server="${channel.server}"`,
        })
        const mySetting = memberRecords[0]?.notification_setting || 'all'
        if (mySetting === 'nothing') return

        const isViewingThisChannel =
          activeConversationRef.current?.type === 'channel' &&
          activeConversationRef.current?.id === e.record.channel

        if (isViewingThisChannel && isFocusedRef.current) return

        if (isViewingThisChannel && !isFocusedRef.current) {
          playSound('/notification_in_server_or_dms.mp3')
        } else {
          playSound('/notification_not_in_server_or_dms.mp3')
        }
      } catch (err) {
        console.error('Notification check error:', err)
      }
    }

    const handleDmMessage = (e) => {
      if (e.action !== 'create') return
      if (e.record.sender === pb.authStore.model.id) return
      if (!pb.authStore.model.notif_message_sound) return

      const isViewingThisThread =
        activeConversationRef.current?.type === 'dm' &&
        activeConversationRef.current?.id === e.record.dm_thread

      if (isViewingThisThread && isFocusedRef.current) return

      if (isViewingThisThread && !isFocusedRef.current) {
        playSound('/notification_in_server_or_dms.mp3')
      } else {
        playSound('/notification_not_in_server_or_dms.mp3')
      }
    }

    let unsubMessages
    let unsubDmMessages

    pb.collection('messages').subscribe('*', handleServerMessage).then((fn) => {
      unsubMessages = fn
    })
    pb.collection('dm_messages').subscribe('*', handleDmMessage).then((fn) => {
      unsubDmMessages = fn
    })

    return () => {
      if (unsubMessages) unsubMessages()
      if (unsubDmMessages) unsubDmMessages()
    }
  }, [isLoggedIn])

  useEffect(() => {
    const size = pb.authStore.model?.accessibility_text_size || 16
    document.body.style.fontSize = `${size}px`
  }, [isLoggedIn])

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
      setJoinError('Please enter an invite code')
      return
    }

    setJoinLoading(true)

    try {
      const uid = pb.authStore.model.id

      const inviteMatches = await pb.collection('invites').getFullList({
        filter: `code="${joinServerId.trim()}"`,
      })

      if (inviteMatches.length === 0) {
        setJoinError('Invalid invite code')
        setJoinLoading(false)
        return
      }

      const invite = inviteMatches[0]

      if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
        setJoinError('This invite has expired')
        setJoinLoading(false)
        return
      }

      if (invite.max_users && invite.uses >= invite.max_users) {
        setJoinError('This invite has reached its use limit')
        setJoinLoading(false)
        return
      }

      const server = await pb.collection('servers').getOne(invite.server)

      const existingBan = await pb.collection('bans').getFullList({
        filter: `user="${uid}" && server="${server.id}"`,
      })

      if (existingBan.length > 0) {
        setJoinError('You are banned from this server')
        setJoinLoading(false)
        return
      }

      if (server.owner !== uid) {
        const existingMembership = await pb.collection('members').getFullList({
          filter: `user="${uid}" && server="${server.id}"`,
        })

        if (existingMembership.length === 0) {
          await pb.collection('members').create({
            user: uid,
            server: server.id,
            role: 'member',
          })

          const newUses = invite.uses + 1
          const hasReachedLimit = invite.max_users && newUses >= invite.max_users

          if (hasReachedLimit) {
            await pb.collection('invites').delete(invite.id)
          } else {
            await pb.collection('invites').update(invite.id, {
              uses: newUses,
            })
          }
        }
      }

      setActiveServer(server)
      setPage('serverView')
      setJoinServerId('')
    } catch (err) {
      console.error(err)
      setJoinError('Something went wrong joining that server')
    } finally {
      setJoinLoading(false)
    }
  }

  if (isLoggedIn) {
    if (accountDisabled) {
      return (
        <div>
          <h1>Your account is disabled</h1>
          <p>You chose to temporarily disable your account. Reactivate it now to continue?</p>
          <button
            onClick={async () => {
              await pb.collection('users').update(pb.authStore.model.id, { account_disabled: false })
              await pb.collection('users').authRefresh()
              setAccountDisabled(false)
            }}
          >
            Reactivate My Account
          </button>
          <button onClick={handleLogout}>Log Out</button>
        </div>
      )
    }

    if (page === 'createServer') {
      return <CreateServer onCreated={handleServerCreated} />
    }
    if (page === 'settings') {
      return <Settings onBack={() => setPage('welcome')} />
    }
    if (page === 'reports') {
      return <ReportsQueue onBack={() => setPage('welcome')} />
    }
    if (page === 'dms') {
      return (
        <DMs
          onBack={() => setPage('welcome')}
          openThreadWithUserId={dmTargetUserId}
          clearOpenThreadRequest={() => setDmTargetUserId(null)}
          setActiveConversation={setActiveConversation}
        />
      )
    }
    if (page === 'friends') {
      return (
        <Friends
          onBack={() => setPage('welcome')}
          onMessageFriend={(userId) => {
            setDmTargetUserId(userId)
            setPage('dms')
          }}
        />
      )
    }
    if (page === 'discovery') {
      return (
        <Discovery
          onBack={() => setPage('welcome')}
          onJoined={(server) => {
            setActiveServer(server)
            setPage('serverView')
          }}
        />
      )
    }
    if (page === 'serverView' && activeServer) {
      return (
        <ServerView
          server={activeServer}
          onBack={() => {
            setPage('welcome')
            setActiveServer(null)
          }}
          setActiveConversation={setActiveConversation}
        />
      )
    }

    return (
      <div>
        <h1>Welcome to Orbit, {pb.authStore.model.name}</h1>
        <p>You're logged in as @{pb.authStore.model.username}</p>
        <button onClick={() => setPage('createServer')}>Create a Server</button>
        <button onClick={() => setPage('friends')}>Friends</button>
        <button onClick={() => setPage('discovery')}>Discover Servers</button>
        <button onClick={() => setPage('dms')}>Messages</button>
        <button onClick={() => setPage('settings')}>⚙️ Settings</button>
        {pb.authStore.model.is_developer && (
          <button onClick={() => setPage('reports')}>View Reports</button>
        )}
        <br />
        <br />
        <button onClick={handleLogout}>Log Out</button>

        <div style={{ position: 'relative', display: 'inline-block', marginBottom: '150px' }}>
          <button onClick={() => setShowStatusMenu(!showStatusMenu)}>
            Status: {pb.authStore.model.status || 'online'}
          </button>

          {showStatusMenu && (
            <div style={{ border: '1px solid gray', padding: '10px', position: 'absolute', backgroundColor: '#1a1a1a', zIndex: 10, minWidth: '180px' }}>
              <div onClick={() => setUserStatus('online', null)} style={{ cursor: 'pointer' }}>
                🟢 Online
              </div>
              <div onClick={() => setShowTimerMenu(showTimerMenu === 'idle' ? null : 'idle')} style={{ cursor: 'pointer' }}>
                🌙 Idle
              </div>
              {showTimerMenu === 'idle' && (
                <div>
                  {[15, 60, 480, 1440, 4320].map((mins) => (
                    <div key={mins} onClick={() => setUserStatus('idle', mins)} style={{ cursor: 'pointer', paddingLeft: '10px' }}>
                      For {mins < 60 ? `${mins} Minutes` : mins < 1440 ? `${mins / 60} Hour(s)` : `${mins / 1440} Day(s)`}
                    </div>
                  ))}
                  <div onClick={() => setUserStatus('idle', 'forever')} style={{ cursor: 'pointer', paddingLeft: '10px' }}>
                    Forever
                  </div>
                </div>
              )}

              <div onClick={() => setShowTimerMenu(showTimerMenu === 'dnd' ? null : 'dnd')} style={{ cursor: 'pointer' }}>
                ⛔ Do Not Disturb
              </div>
              {showTimerMenu === 'dnd' && (
                <div>
                  {[15, 60, 480, 1440, 4320].map((mins) => (
                    <div key={mins} onClick={() => setUserStatus('dnd', mins)} style={{ cursor: 'pointer', paddingLeft: '10px' }}>
                      For {mins < 60 ? `${mins} Minutes` : mins < 1440 ? `${mins / 60} Hour(s)` : `${mins / 1440} Day(s)`}
                    </div>
                  ))}
                  <div onClick={() => setUserStatus('dnd', 'forever')} style={{ cursor: 'pointer', paddingLeft: '10px' }}>
                    Forever
                  </div>
                </div>
              )}

              <div onClick={() => setShowTimerMenu(showTimerMenu === 'invisible' ? null : 'invisible')} style={{ cursor: 'pointer' }}>
                ⚪ Invisible
              </div>
              {showTimerMenu === 'invisible' && (
                <div>
                  {[15, 60, 480, 1440, 4320].map((mins) => (
                    <div key={mins} onClick={() => setUserStatus('invisible', mins)} style={{ cursor: 'pointer', paddingLeft: '10px' }}>
                      For {mins < 60 ? `${mins} Minutes` : mins < 1440 ? `${mins / 60} Hour(s)` : `${mins / 1440} Day(s)`}
                    </div>
                  ))}
                  <div onClick={() => setUserStatus('invisible', 'forever')} style={{ cursor: 'pointer', paddingLeft: '10px' }}>
                    Forever
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

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
            placeholder="Paste invite code"
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