// App.jsx
import { useState, useEffect, useRef } from 'react'
import pb from './pocketbase'
import { POCKETBASE_URL } from './config'
import { getMyPrivateKey, decryptMessage } from './crypto'
import { HEARTBEAT_INTERVAL_MS, getEffectiveStatus } from './presence'
import { initUnread, bump, markRead, getServerUnread, getDmUnread, useUnread, setNotificationMode } from './unread'
import { initDmStore, useDmThreads } from './dmStore'
import './App.css'
import Login from './components/Login'
import Signup from './components/Signup'
import CreateServer from './components/CreateServer'
import ServerView from './components/ServerView'
import HomeSidebar from './components/HomeSidebar'
import Friends from './components/Friends'
import DMs from './components/DMs'
import Settings from './components/Settings'
import ReportsQueue from './components/ReportsQueue'
import { logPbError } from './pbErrors'
import Discovery from './components/Discovery'
import Billing from './components/Billing'
import Bookmarks from './components/Bookmarks'
import './profile-features.css'

function App() {
  const [view, setView] = useState('login')
  const [page, setPage] = useState('welcome')
  const [activeServer, setActiveServer] = useState(null)
  const [isLoggedIn, setIsLoggedIn] = useState(pb.authStore.isValid)
  const [currentTheme, setCurrentTheme] = useState('dark')
  const [myServers, setMyServers] = useState([])
  const [joinServerId, setJoinServerId] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [dmTargetUserId, setDmTargetUserId] = useState(null)
  // Set alongside dmTargetUserId when "Start a Call" is used from a
  // server context — once DMs.jsx opens that user's thread, it reads
  // this and immediately starts a call, then clears it.
  const [autoStartCallUserId, setAutoStartCallUserId] = useState(null)
  const [accountDisabled, setAccountDisabled] = useState(pb.authStore.model?.account_disabled || false)
  const readPinnedServers = () => {
    const uid = pb.authStore.model?.id
    if (!uid) return []
    try {
      const raw = localStorage.getItem(`orbit_pinned_servers_${uid}`)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }
  const [pinnedServerIds, setPinnedServerIds] = useState(() => readPinnedServers())
  const activeConversationRef = useRef(null)
  // Mirrors activeConversationRef into state so the sidebar can highlight the
  // currently-open DM thread (a ref alone can't trigger a re-render).
  const [activeConversation, setActiveConversationState] = useState(null)
  const isFocusedRef = useRef(!document.hidden)
  const channelServerRef = useRef({})
  // Subscribes this component to unread-state changes so the server rail can
  // show per-server ping dots, and to the canonical DM conversation store so
  // unread DM avatars can appear in the rail.
  useUnread()
  const { threads: dmThreads } = useDmThreads()
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showTimerMenu, setShowTimerMenu] = useState(null)
  // Where "← Back" / a completed purchase on the Billing page should
  // return to. Defaults to 'welcome' (the normal ⭐ Orbit+ button path).
  // Set to 'serverView' when Billing is opened FROM a server's Orbits
  // Boost page, so a successful Premium purchase lands the user back on
  // the same server they were trying to boost — activeServer is never
  // cleared by this navigation, only by ServerView's own onBack, so it's
  // still correct when we return.
  const [billingReturnPage, setBillingReturnPage] = useState('welcome')
  // Set when "Boost this server" is used from Settings; ServerView opens its
  // Boost Perks section for that server, then clears this.
  const [pendingBoostServerId, setPendingBoostServerId] = useState(null)
  // Bookmark jump targets (report §4.23). bookmarkJump carries a channel
  // target for ServerView; pendingDmMessageId carries a DM target for DMs.
  const [bookmarkJump, setBookmarkJump] = useState(null)
  const [pendingDmMessageId, setPendingDmMessageId] = useState(null)
  // Lightweight in-app toasts (currently used for the sender-side status
  // broadcast: "X is now online"). Self-expiring; no persistence needed.
  const [toasts, setToasts] = useState([])
  const pushToast = (text) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setToasts((prev) => [...prev, { id, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
  }

  useEffect(() => {
    const applyTheme = () => {
      const savedTheme = pb.authStore.model?.theme
      const resolvedTheme = savedTheme === 'light' ? 'light' : 'dark'

      // Only set data-theme once we actually know a preference (logged
      // in). Logged-out / not-yet-loaded falls back to index.css's
      // prefers-color-scheme block, defaulting to light unless the OS
      // itself prefers dark — matches "dark is the default for a brand
      // new account" once they DO log in, since users.theme starts blank
      // and the field below treats blank as dark.
      if (pb.authStore.isValid) {
        document.documentElement.setAttribute('data-theme', resolvedTheme)
      }
      setCurrentTheme(resolvedTheme)

      // Favicon swaps with theme too — logo-dark.jpg / logo-light.jpg
      // live in /public. Not gated behind isValid like data-theme above,
      // since the tab icon should still look right on the login screen,
      // not just once logged in — defaults to dark to match index.css's
      // own default-dark fallback.
      let iconLink = document.querySelector("link[rel='icon']")
      if (!iconLink) {
        iconLink = document.createElement('link')
        iconLink.rel = 'icon'
        document.head.appendChild(iconLink)
      }
      iconLink.href = pb.authStore.isValid && resolvedTheme === 'light' ? '/logo-light.jpg' : '/logo-dark.jpg'

      // UI density is also a per-user preference applied globally via a data
      // attribute, exactly like the theme, so it updates live on change.
      const model = pb.authStore.model
      const density = model?.ui_density === 'compact' || model?.ui_density === 'spacious'
        ? model.ui_density
        : 'comfortable'
      if (pb.authStore.isValid) {
        document.documentElement.setAttribute('data-density', density)
      }

      // Accessibility preferences, applied globally through data attributes /
      // CSS variables so they update live across the whole app.
      const root = document.documentElement
      root.setAttribute('data-underline-links', model?.always_underline_links ? 'true' : 'false')
      root.setAttribute('data-high-contrast', model?.high_contrast ? 'true' : 'false')
      root.setAttribute('data-message-display', model?.message_display === 'compact' ? 'compact' : 'default')
      root.setAttribute('data-onoff-icons', model?.show_on_off_indicators ? 'true' : 'false')
      root.setAttribute('data-role-colour-display', model?.role_colour_display || 'in_names')
      root.setAttribute('data-name-styles', model?.display_name_styles ? 'true' : 'false')
      root.style.setProperty('--orbit-message-group-spacing', `${model?.message_group_spacing ?? 0}px`)
      root.style.setProperty('--orbit-saturation', `${model?.saturation ?? 100}%`)

      // Zoom is applied to <body>; saturation is a filter on the app shell.
      document.body.style.zoom = String((model?.zoom_level ?? 100) / 100)
      const shellEl = document.querySelector('.app-shell')
      if (shellEl) {
        const sat = model?.saturation ?? 100
        shellEl.style.filter = sat < 100 ? `saturate(${sat}%)` : ''
      }
    }

    applyTheme()
    const unsubscribeTheme = pb.authStore.onChange(applyTheme)
    return () => unsubscribeTheme()
  }, [])

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => {
      setIsLoggedIn(pb.authStore.isValid)
      setAccountDisabled(pb.authStore.model?.account_disabled || false)
      setPinnedServerIds(readPinnedServers())
      // Keep the unread layer's badge-suppression in sync with the account's
      // notification mode (mute_all hides badges).
      setNotificationMode(pb.authStore.model?.notification_mode || 'normal')
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
      logPbError('Status update error:', err)
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
      logPbError('Load my servers error:', err)
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

    const beat = async () => {
      try {
        await pb.collection('users').update(pb.authStore.model.id, {
          last_seen: new Date().toISOString(),
        }, { requestKey: null }) // fires alongside plenty else, never let it get auto-cancelled
      } catch (err) {
        // Not worth surfacing — a missed heartbeat just means this user
        // looks briefly stale to others until the next one lands.
      }
    }

    beat() // immediately on login, don't wait a full interval to appear online
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
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
    setActiveConversationState(conv)
  }

  // Channel id -> server id, cached, used for per-server unread aggregation.
  const resolveChannelServerId = async (channelId) => {
    const cache = channelServerRef.current
    if (channelId in cache) return cache[channelId]
    try {
      const ch = await pb.collection('channels').getOne(channelId, { requestKey: null })
      cache[channelId] = ch.server
      return ch.server
    } catch {
      cache[channelId] = null
      return null
    }
  }

  // Used by "Start a Call" in UserContextMenu/FullProfileModal — opens
  // the DM thread with that user and flags it to auto-start a call once
  // the thread is open (see DMs.jsx's autoStartCallUserId effect).
  const handleStartCallWithUser = (userId) => {
    saveLastHomeView({ type: 'dm', userId })
    setDmTargetUserId(userId)
    setAutoStartCallUserId(userId)
    setPage('dms')
  }

  useEffect(() => {
    if (!isLoggedIn) return

    const playSound = (defaultFile) => {
      // Orbit+/Premium perk: if the user has uploaded a custom
      // notification sound, use that instead of the default files —
      // applies to ALL notification triggers uniformly (we don't have a
      // separate custom sound per trigger type, just one override).
      const me = pb.authStore.model
      const customSoundUrl = me?.notification_sound
        ? pb.files.getURL(me, me.notification_sound)
        : null

      const audio = new Audio(customSoundUrl || defaultFile)
      audio.play().catch((err) => console.error('Notification sound error:', err))
    }

    // Desktop notification (System setting). Only shown when the browser has
    // granted permission and the user opted in; clicking it focuses Orbit.
    const showDesktopNotification = (title, body) => {
      try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
        const n = new Notification(title, {
          body,
          icon: '/logo-dark.jpg',
          tag: 'orbit-message',
        })
        n.onclick = () => { window.focus(); n.close() }
      } catch {
        // Some browsers require a service worker; ignore silently.
      }
    }

    const handleServerMessage = async (e) => {
      if (e.action !== 'create') return
      const me = pb.authStore.model
      if (e.record.sender === me.id) return

      const channelId = e.record.channel
      const isViewingThisChannel =
        activeConversationRef.current?.type === 'channel' &&
        activeConversationRef.current?.id === channelId

      // Unread/mention tracking runs regardless of the sound setting.
      if (isViewingThisChannel && isFocusedRef.current) {
        markRead('channel', channelId)
      } else {
        const content = e.record.content || ''
        const isMention =
          /@everyone|@here/.test(content) ||
          (me.name && content.includes('@' + me.name)) ||
          (me.username && content.includes('@' + me.username))
        bump('channel', channelId, !!isMention)
        const serverId = await resolveChannelServerId(channelId)
        if (serverId) bump('server', serverId, !!isMention)
      }

      try {
        const channel = await pb.collection('channels').getOne(channelId, { requestKey: null })

        const memberRecords = await pb.collection('members').getFullList({
          filter: `user="${me.id}" && server="${channel.server}"`,
          requestKey: null,
        })
        const mySetting = memberRecords[0]?.notification_setting || 'all'
        if (mySetting === 'nothing') return

        if (isViewingThisChannel && isFocusedRef.current) return

        // Presence/notification split (report §4.10): Quiet and Mute all both
        // suppress SOUNDS; Mute all additionally hides badges (unread.js).
        // Desktop notifications are their own channel and only mute_all
        // silences them.
        const mode = me.notification_mode || 'normal'
        if (me.desktop_notifications && mode !== 'mute_all') {
          showDesktopNotification('New message', (e.record.content || '').slice(0, 140))
        }
        if (mode !== 'normal') return
        if (!me.notif_message_sound) return

        if (isViewingThisChannel && !isFocusedRef.current) {
          playSound('/notification_in_server_or_dms.mp3')
        } else {
          playSound('/notification_not_in_server_or_dms.mp3')
        }
      } catch (err) {
        console.error('Notification check error:', err)
      }
    }

    const handleDmMessage = async (e) => {
      if (e.action !== 'create') return
      const meDm = pb.authStore.model
      if (e.record.sender === meDm.id) return

      const threadId = e.record.dm_thread
      const isViewingThisThread =
        activeConversationRef.current?.type === 'dm' &&
        activeConversationRef.current?.id === threadId

      if (isViewingThisThread && isFocusedRef.current) {
        markRead('dm', threadId)
      }
      // Otherwise the server hook (dm_unread.pb.js) has already incremented
      // the recipient's dm_read_state row, and the realtime subscription in
      // unread.js updates the badge — no client-side counting needed.

      if (isViewingThisThread && isFocusedRef.current) return

      const mode = meDm.notification_mode || 'normal'
      if (meDm.desktop_notifications && mode !== 'mute_all') {
        // Decrypt a short preview for the notification body. DMs stay E2EE —
        // this happens locally, the same way the DM view renders them.
        let title = 'New direct message'
        let body = 'You received a direct message'
        try {
          const sender = await pb.collection('users').getOne(e.record.sender, { requestKey: null })
          title = sender.name || title
          const myKey = getMyPrivateKey()
          if (sender.public_key && myKey) {
            const { text } = decryptMessage(e.record.content, sender.public_key, myKey)
            let preview = text
            try {
              const parsed = JSON.parse(text)
              if (parsed && parsed.kind === 'image') preview = 'Sent an image'
            } catch { /* ordinary text */ }
            if (preview) body = preview.slice(0, 140)
          }
        } catch {
          // Fall back to the generic body above.
        }
        showDesktopNotification(title, body)
      }

      if (mode !== 'normal') return
      if (!meDm.notif_message_sound) return

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

  // Per-user unread tracking (server-backed for DMs) and the shared DM
  // conversation store. Both reset/tear down on logout or account change so
  // nothing leaks between accounts.
  useEffect(() => {
    const uid = pb.authStore.model?.id
    initUnread(uid)
    setNotificationMode(pb.authStore.model?.notification_mode || 'normal')
    initDmStore(uid)
  }, [isLoggedIn])

  // Sender-side status broadcast (report §4.9), receiver half.
  //
  // A status change only ever notifies a friend when BOTH sides opt in:
  //   - the person changing status has users.status_broadcast = true, and
  //   - the friend watching has notif_friends_online enabled.
  // This is why the default is off: without it, coming online is a passive
  // presence change, not a push. We surface it as an in-app toast so it is
  // observable without depending on notification audio files being present.
  useEffect(() => {
    if (!isLoggedIn) return
    const uid = pb.authStore.model?.id
    if (!uid) return

    let cancelled = false
    let unsub
    const friendIds = new Set()
    // Last effective status we saw per friend, so we only fire on a genuine
    // offline -> online transition rather than every 25s heartbeat.
    const lastStatus = {}
    // Last status_shared_at we saw per user, to detect the one-time explicit
    // "Share status update" action.
    const lastSharedAt = {}

    const seed = async () => {
      try {
        const [a, b] = await Promise.all([
          pb.collection('friends').getFullList({ filter: `user_a="${uid}"`, requestKey: null }),
          pb.collection('friends').getFullList({ filter: `user_b="${uid}"`, requestKey: null }),
        ])
        a.forEach((f) => friendIds.add(f.user_b))
        b.forEach((f) => friendIds.add(f.user_a))
        if (cancelled || friendIds.size === 0) return
        const users = await pb.collection('users').getFullList({
          filter: [...friendIds].map((id) => `id="${id}"`).join(' || '),
          requestKey: null,
        })
        users.forEach((u) => {
          lastStatus[u.id] = getEffectiveStatus(u)
          lastSharedAt[u.id] = u.status_shared_at || ''
        })
      } catch (err) {
        console.error('Friend presence seed error:', err)
      }
    }

    seed()

    // Whether the watcher is allowed to receive a broadcast of this audience.
    // 'friends' is a local set check; 'server_members' reuses the members list
    // rule (which only returns rows for servers the watcher is already in);
    // 'everyone' is always allowed.
    const audienceAllows = async (audience, sharerId, isFriend) => {
      if (audience === 'everyone' || isFriend) return true
      if (audience === 'server_members') {
        try {
          const rows = await pb.collection('members').getFullList({
            filter: `user="${sharerId}"`,
            requestKey: null,
          })
          return rows.length > 0
        } catch {
          return false
        }
      }
      return false
    }

    pb.collection('users').subscribe('*', async (e) => {
      if (e.action !== 'update') return
      const record = e.record
      if (record.id === uid) return

      const me = pb.authStore.model
      if ((me?.notification_mode || 'normal') === 'mute_all') return
      if (!me?.notif_friends_online) return

      const isFriend = friendIds.has(record.id)
      const audience = record.status_broadcast_audience || 'friends'

      // One-time explicit share (the "Share status update" button), which is
      // independent of the passive status_broadcast toggle.
      const sharedAt = record.status_shared_at || ''
      const prevShared = lastSharedAt[record.id]
      lastSharedAt[record.id] = sharedAt
      if (sharedAt && prevShared !== undefined && sharedAt !== prevShared) {
        if (await audienceAllows(audience, record.id, isFriend)) {
          pushToast(`${record.name || 'Someone'} shared a status update`)
          return
        }
      }

      // Passive presence broadcast: only friends (we only track friends'
      // transitions), and only when the sender opted in.
      if (!isFriend) return
      const next = getEffectiveStatus(record)
      const prev = lastStatus[record.id] || 'offline'
      lastStatus[record.id] = next
      if (prev !== 'offline' || next === 'offline') return
      if (!record.status_broadcast) return
      pushToast(`${record.name || 'A friend'} is now online`)
    }).then((fn) => {
      if (cancelled) { fn(); return }
      unsub = fn
    }).catch((err) => console.error('Friend presence subscribe error:', err))

    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [isLoggedIn])

  // Bookmark reminders (report §4.23). There is no push/email provider, so a
  // reminder can only surface while a client is open: we poll for due,
  // not-yet-surfaced reminders and toast them, then mark them surfaced.
  useEffect(() => {
    if (!isLoggedIn) return
    const uid = pb.authStore.model?.id
    if (!uid) return
    let cancelled = false

    const check = async () => {
      const now = new Date().toISOString().replace('T', ' ')
      try {
        const due = await pb.collection('bookmarks').getFullList({
          filter: `user="${uid}" && reminded=false && remind_at != "" && remind_at <= "${now}"`,
          requestKey: null,
        })
        for (const b of due) {
          if (cancelled) return
          pushToast(`Bookmark reminder: ${(b.content || 'saved message').slice(0, 80)}`)
          pb.collection('bookmarks').update(b.id, { reminded: true }, { requestKey: null })
            .catch((err) => console.error('Mark reminder surfaced error:', err))
        }
      } catch (err) {
        console.error('Bookmark reminder check error:', err)
      }
    }

    check()
    const interval = setInterval(check, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isLoggedIn])

  const toggleServerPin = (serverId) => {
    const uid = pb.authStore.model?.id
    if (!uid) return
    setPinnedServerIds((prev) => {
      const next = prev.includes(serverId)
        ? prev.filter((id) => id !== serverId)
        : [...prev, serverId]
      try {
        localStorage.setItem(`orbit_pinned_servers_${uid}`, JSON.stringify(next))
      } catch {
        // storage unavailable — pin just won't persist
      }
      return next
    })
  }

  // Pinned servers float to the top of the rail while keeping their relative
  // order otherwise.
  const railServers = [...myServers].sort((a, b) => {
    const ap = pinnedServerIds.includes(a.id) ? 0 : 1
    const bp = pinnedServerIds.includes(b.id) ? 0 : 1
    return ap - bp
  })

  useEffect(() => {
    if (isLoggedIn) goHome()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isLoggedIn && page === 'welcome') {
      loadMyServers()
    }
  }, [isLoggedIn, page])

  const handleLogout = () => {
    pb.authStore.clear()
    setPage('welcome')
  }

  const goHome = () => {
    setActiveServer(null)
    try {
      const saved = localStorage.getItem('orbit_last_home_view')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.type === 'dm' && parsed.userId) {
          setDmTargetUserId(parsed.userId)
          setPage('dms')
          return
        }
        if (parsed.type === 'friends') {
          setPage('friends')
          return
        }
      }
    } catch (err) {
      // localStorage unavailable or bad data — fall through to welcome
    }
    setPage('welcome')
  }

  const saveLastHomeView = (view) => {
    try {
      localStorage.setItem('orbit_last_home_view', JSON.stringify(view))
    } catch (err) {
      // localStorage unavailable — not worth failing navigation over
    }
  }

  // Opens (or creates) the DM with a user, used by both HomeSidebar and the
  // global rail's unread-DM avatars.
  const openDmWithUser = (userId) => {
    saveLastHomeView({ type: 'dm', userId })
    setDmTargetUserId(userId)
    setPage('dms')
  }

  // Bookmark jump (report §4.23): open the saved message's source. Server
  // messages resolve channel -> server; DMs resolve the thread's other user.
  const handleJumpBookmark = async (bookmark) => {
    if (!bookmark) return
    try {
      if (bookmark.channel) {
        const channel = await pb.collection('channels').getOne(bookmark.channel, { requestKey: null })
        const server = await pb.collection('servers').getOne(channel.server, { requestKey: null })
        setActiveServer(server)
        setBookmarkJump({ channelId: channel.id, messageId: bookmark.message_id })
        setPage('serverView')
        return
      }
      if (bookmark.thread) {
        const thread = await pb.collection('dm_threads').getOne(bookmark.thread, { requestKey: null })
        const myId = pb.authStore.model?.id
        const otherId = thread.user_a === myId ? thread.user_b : thread.user_a
        openDmWithUser(otherId)
        setPendingDmMessageId(bookmark.message_id)
      }
    } catch (err) {
      console.error('Jump to bookmark error:', err)
    }
  }

  const handleServerCreated = (server) => {
    setActiveServer(server)
    setPage('serverView')
  }

  const handleOpenServer = (server) => {
    setActiveServer(server)
    setPage('serverView')
  }

  const handleBoostServer = (serverId) => {
    const server = myServers.find((s) => s.id === serverId)
    if (!server) return
    setActiveServer(server)
    setPendingBoostServerId(serverId)
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
      // All invite validation (expiry, uses, target, ban) and the membership
      // creation happen server-side in pb_hooks/join_server.pb.js. The client
      // no longer creates the membership itself, which closed a bypass where
      // any user could join any server (including invite-only ones) by
      // calling the API directly.
      const response = await fetch(`${POCKETBASE_URL}/api/orbit/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ code: joinServerId.trim() }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setJoinError(data.error || 'Could not join that server')
        return
      }

      const server = await pb.collection('servers').getOne(data.serverId)
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

    let pageContent
    if (page === 'createServer') {
      pageContent = (
        <CreateServer
          onCreated={handleServerCreated}
          joinServerId={joinServerId}
          setJoinServerId={setJoinServerId}
          onJoinServer={handleJoinServer}
          joinLoading={joinLoading}
          joinError={joinError}
        />
      )
    } else if (page === 'settings') {
      pageContent = (
        <Settings
          onBack={() => setPage('welcome')}
          onOpenBilling={() => { setBillingReturnPage('welcome'); setPage('billing') }}
          onBoostServer={handleBoostServer}
          onLogout={handleLogout}
        />
      )
    } else if (page === 'reports') {
      pageContent = <ReportsQueue onBack={() => setPage('welcome')} />
    } else if (page === 'dms') {
      pageContent = (
        <DMs
          onBack={() => setPage('welcome')}
          openThreadWithUserId={dmTargetUserId}
          clearOpenThreadRequest={() => setDmTargetUserId(null)}
          setActiveConversation={setActiveConversation}
          autoStartCallUserId={autoStartCallUserId}
          clearAutoStartCallRequest={() => setAutoStartCallUserId(null)}
          highlightMessageId={pendingDmMessageId}
          onHighlightConsumed={() => setPendingDmMessageId(null)}
        />
      )
    } else if (page === 'friends') {
      pageContent = (
        <Friends
          onBack={() => setPage('welcome')}
          onMessageFriend={(userId) => {
            saveLastHomeView({ type: 'dm', userId })
            setDmTargetUserId(userId)
            setPage('dms')
          }}
          onJoined={(server) => {
            setActiveServer(server)
            setPage('serverView')
          }}
        />
      )
    } else if (page === 'bookmarks') {
      pageContent = <Bookmarks onBack={() => setPage('welcome')} onJump={handleJumpBookmark} />
    } else if (page === 'discovery') {
      pageContent = (
        <Discovery
          onBack={() => setPage('welcome')}
          onJoined={(server) => {
            setActiveServer(server)
            setPage('serverView')
          }}
        />
      )
    } else if (page === 'shop') {
      pageContent = (
        <div className="centered-placeholder">
          <h1>Coming Soon</h1>
        </div>
      )
    } else if (page === 'billing') {
      pageContent = (
        <Billing
          onBack={() => setPage(billingReturnPage)}
          onPurchaseComplete={() => {
            // Give the success message a moment to be seen before
            // auto-returning — the webhook activation itself is already
            // polled for inside Billing.jsx.
            setTimeout(() => setPage(billingReturnPage), 2500)
          }}
        />
      )
    } else if (page === 'serverView' && activeServer) {
      pageContent = (
        <ServerView
          server={activeServer}
          onBack={() => {
            setPage('welcome')
            setActiveServer(null)
          }}
          setActiveConversation={setActiveConversation}
          onOpenBilling={() => {
            setBillingReturnPage('serverView')
            setPage('billing')
          }}
          onStartCallWithUser={handleStartCallWithUser}
          onMessageUser={openDmWithUser}
          openSettingsSection={pendingBoostServerId ? 'boosts' : null}
          onSectionOpened={() => setPendingBoostServerId(null)}
          jumpTarget={bookmarkJump}
          onJumpConsumed={() => setBookmarkJump(null)}
          onOpenUserSettings={() => setPage('settings')}
        />
      )
    } else {
      pageContent = (
        <div className="centered-placeholder">
          <p style={{ color: 'var(--text)' }}>Select a friend or a conversation to get started.</p>
        </div>
      )
    }

    // Unread DM conversations for the global rail, most recent activity first.
    // This reuses the canonical dmStore thread list + dm_read_state counts —
    // no new query, subscription, or unread system.
    const unreadDmThreads = dmThreads
      .map((t) => ({ thread: t, unread: getDmUnread(t.id) }))
      .filter((x) => x.unread && x.thread.otherUser)
      .sort((a, b) => {
        const ta = String(a.unread.updatedAt || '')
        const tb = String(b.unread.updatedAt || '')
        return ta < tb ? 1 : ta > tb ? -1 : 0
      })

    return (
      <div className="app-shell">
        <div className="server-rail">
          <button
            className={`server-rail-icon${page === 'welcome' ? ' active' : ''}`}
            onClick={goHome}
            title="Home"
          >
            <img src={currentTheme === 'light' ? '/logo-light.jpg' : '/logo-dark.jpg'} alt="Orbit" />
          </button>

          {unreadDmThreads.map(({ thread, unread }) => (
            <div key={thread.id} className="server-rail-item">
              <button
                className="server-rail-icon"
                title={`${thread.otherUser.name || 'Unknown'} — ${unread.count} unread DM${unread.count > 1 ? 's' : ''}`}
                onClick={() => {
                  // Use the existing canonical read-state, then open the DM.
                  markRead('dm', thread.id)
                  openDmWithUser(thread.otherUser.id)
                }}
              >
                {thread.otherUser.avatar ? (
                  <img
                    src={pb.files.getURL(thread.otherUser, thread.otherUser.avatar, { thumb: '48x48' })}
                    alt=""
                  />
                ) : (
                  (thread.otherUser.name || '?').slice(0, 2).toUpperCase()
                )}
              </button>
              <span
                className="server-rail-dm-badge"
                title={`${unread.count} unread DM${unread.count > 1 ? 's' : ''}`}
              >
                {unread.count > 9 ? '9+' : unread.count}
              </span>
            </div>
          ))}
          <div className="server-rail-divider" />
          {railServers.map((server) => {
            const unread = getServerUnread(server.id)
            const isPinned = pinnedServerIds.includes(server.id)
            const isActive = activeServer?.id === server.id && page === 'serverView'
            const unreadClass = unread
              ? (unread.mention ? ' server-rail-item-mention' : ' server-rail-item-unread')
              : ''
            return (
              <div key={server.id} className={`server-rail-item${unreadClass}${isPinned ? ' server-rail-item-pinned' : ''}`}>
                <button
                  className={`server-rail-icon${isActive ? ' active' : ''}`}
                  onClick={() => handleOpenServer(server)}
                  onContextMenu={(e) => { e.preventDefault(); toggleServerPin(server.id) }}
                  title={`${server.name}${isPinned ? ' (pinned — right-click to unpin)' : ' (right-click to pin)'}`}
                >
                  {server.icon ? (
                    <img src={pb.files.getURL(server, server.icon, { thumb: '48x48' })} alt="" />
                  ) : (
                    server.name.slice(0, 2).toUpperCase()
                  )}
                </button>

                {unread && unread.mention && (
                  <span className="server-rail-badge" title={`${unread.count} unread (you were mentioned)`}>
                    {unread.count > 99 ? '99+' : unread.count}
                  </span>
                )}
              </div>
            )
          })}
          <button
            className={`server-rail-icon${page === 'createServer' ? ' active' : ''}`}
            onClick={() => setPage('createServer')}
            title="Add a Server"
          >
            +
          </button>
          <button
            className={`server-rail-icon${page === 'discovery' ? ' active' : ''}`}
            onClick={() => setPage('discovery')}
            title="Discover Servers"
          >
            🧭
          </button>
        </div>
        {page !== 'serverView' && (
          <HomeSidebar
            page={page}
            activeDmThreadId={activeConversation?.type === 'dm' ? activeConversation.id : null}
            onOpenFriends={() => { saveLastHomeView({ type: 'friends' }); setPage('friends') }}
            onOpenThread={openDmWithUser}
            onOpenSettings={() => setPage('settings')}
            onOpenBilling={() => { setBillingReturnPage('welcome'); setPage('billing') }}
            onOpenShop={() => setPage('shop')}
            onOpenBookmarks={() => setPage('bookmarks')}
            myServers={myServers}
            onOpenServer={handleOpenServer}
            pinnedServerIds={pinnedServerIds}
          />
        )}
        <div className="app-main">
          <div className="app-main-content">
            {pageContent}
          </div>
        </div>
        {toasts.length > 0 && (
          <div className="app-toast-stack">
            {toasts.map((t) => (
              <div key={t.id} className="app-toast">{t.text}</div>
            ))}
          </div>
        )}
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