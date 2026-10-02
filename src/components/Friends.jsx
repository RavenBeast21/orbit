// Friends.jsx
//
// Discord-style relationships screen: tabs for online/all/pending friends,
// an inline Add Friend form, and an "Active Now" rail. The data access and
// realtime wiring are deliberately kept identical to the original version —
// only the presentation was restructured. Presentational pieces (Avatar, Row,
// Notice, EmptyState…) live at module scope so the main component reads as a
// list of panels rather than a wall of nested markup.
import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import { POCKETBASE_URL } from '../config'
import { formatDate } from '../formatting'
import { getEffectiveStatus } from '../presence'
import { logPbError } from '../pbErrors'
import ConfirmDialog from './ConfirmDialog'

// ---------------------------------------------------------------------------
// Presentation helpers (no data access)
// ---------------------------------------------------------------------------

function statusLabel(status) {
  if (status === 'idle') return 'Idle'
  if (status === 'dnd') return 'Do Not Disturb'
  if (status === 'offline') return 'Offline'
  return 'Online'
}

// A user's custom activity, only if they've allowed it to be shown. The empty
// state promise in Active Now is about activities, so both the row subtitle and
// Active Now share this single source of truth.
function getActivity(user) {
  if (user?.show_activity && user?.custom_activity && user?.activity_visibility !== 'nobody') {
    return user.custom_activity
  }
  return null
}

function friendSubtitle(user) {
  const activity = getActivity(user)
  if (activity) return `🎮 ${activity}`
  return statusLabel(getEffectiveStatus(user))
}

function matchesQuery(user, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (user?.name || '').toLowerCase().includes(q)
    || (user?.username || '').toLowerCase().includes(q)
}

function compareFriends(a, b) {
  return (a.user?.name || '').localeCompare(b.user?.name || '')
}

function IconPeople() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconChat() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

// Avatar + optional presence dot. `imageField` lets the same component render
// server invites (which use `icon` instead of `avatar`).
function Avatar({ user, compact = false, status, shape = 'circle', imageField = 'avatar' }) {
  const [broken, setBroken] = useState(false)
  const size = compact ? 32 : 40
  const file = user?.[imageField]
  const url = file && !broken
    ? pb.files.getURL(user, file, { thumb: `${size}x${size}` })
    : null
  return (
    <span className={`friend-avatar${shape === 'square' ? ' friend-avatar--square' : ''}`}>
      {url ? (
        <img src={url} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="friend-avatar-fallback">{(user?.name || '?').slice(0, 2).toUpperCase()}</span>
      )}
      {status && (
        <span
          className="presence-dot"
          data-status={status}
          title={statusLabel(status)}
          role="img"
          aria-label={statusLabel(status)}
        />
      )}
    </span>
  )
}

// One row used by friends, requests, invites and Active Now.
function Row({
  avatar,
  name,
  username,
  sub,
  meta,
  note,
  actions,
  actionsAlways = false,
  compact = false,
  onClick,
}) {
  const className = [
    'friend-row',
    compact ? 'friend-row--compact' : '',
    onClick ? 'friend-row--button' : '',
  ].filter(Boolean).join(' ')

  const content = (
    <>
      {avatar}
      <div className="friend-info">
        <div className="friend-name">
          <span className="friend-name-text">{name}</span>
          {username && <span className="friend-username">@{username}</span>}
        </div>
        {sub && <div className="friend-sub">{sub}</div>}
        {meta && <div className="friend-meta">{meta}</div>}
        {note && <div className="req-message">{note}</div>}
      </div>
      {actions && (
        <div className={`friend-actions${actionsAlways ? ' friend-actions--always' : ''}`}>
          {actions}
        </div>
      )}
    </>
  )

  if (onClick) {
    return (
      <li
        className={className}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
      >
        {content}
      </li>
    )
  }
  return <li className={className}>{content}</li>
}

function SearchBar({ value, onChange, onClear }) {
  return (
    <div className="friends-search">
      <div className="friends-search-field">
        <IconSearch />
        <input
          type="text"
          value={value}
          placeholder="Search friends"
          aria-label="Search friends"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClear() }}
        />
        {value && (
          <button type="button" className="friends-search-clear" aria-label="Clear search" onClick={onClear}>
            <IconClose />
          </button>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ children }) {
  return <h3 className="friends-section-title">{children}</h3>
}

function EmptyState({ title, body, action }) {
  return (
    <div className="friends-empty">
      <div className="friends-empty-title">{title}</div>
      {body && <p className="friends-empty-body">{body}</p>}
      {action && <div className="friends-empty-action">{action}</div>}
    </div>
  )
}

function Notice({ type, children, onDismiss }) {
  return (
    <div className={`friends-notice friends-notice--${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <p>{children}</p>
      {onDismiss && (
        <button type="button" className="friends-notice-dismiss" aria-label="Dismiss" onClick={onDismiss}>
          <IconClose />
        </button>
      )}
    </div>
  )
}

function RowSkeleton({ compact = false }) {
  return (
    <li className={`friend-row friend-row--skeleton${compact ? ' friend-row--compact' : ''}`} aria-hidden="true">
      <span className="friends-skeleton-avatar" />
      <span className="friends-skeleton-lines">
        <span className="friends-skeleton-bar friends-skeleton-bar--long" />
        <span className="friends-skeleton-bar friends-skeleton-bar--short" />
      </span>
    </li>
  )
}

function SkeletonList({ count = 6, compact = false }) {
  return (
    <ul className="friends-list list-reset" aria-busy="true">
      {Array.from({ length: count }, (_, i) => <RowSkeleton key={i} compact={compact} />)}
    </ul>
  )
}

const TABS = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'add', label: 'Add Friend', cta: true },
]

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

function Friends({ onMessageFriend, onJoined }) {
  const [tab, setTab] = useState('online')
  const [query, setQuery] = useState('')

  const [searchInput, setSearchInput] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchSuccess, setSearchSuccess] = useState('')
  const [searching, setSearching] = useState(false)

  const [incomingRequests, setIncomingRequests] = useState([])
  const [outgoingRequests, setOutgoingRequests] = useState([])
  const [friendsList, setFriendsList] = useState([])
  const [serverInvites, setServerInvites] = useState([])
  const [inviteError, setInviteError] = useState('')
  // Optional short note attached to a friend request (report §4.21).
  const [requestMessage, setRequestMessage] = useState('')
  // Per-requester context (mutual friends/servers, account age) keyed by user id.
  const [requestContexts, setRequestContexts] = useState({})
  const [reportingRequestId, setReportingRequestId] = useState(null)
  // Busy bookkeeping: only set for the first load so realtime refreshes don't
  // make the list flicker back to skeletons.
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [pendingUnfriend, setPendingUnfriend] = useState(null)

  // Presence (last_seen) is only ever noticed by comparing against the current
  // time, so a slow tick keeps the online/offline dots honest without polling
  // the server.
  const [, forcePresence] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => forcePresence((t) => t + 1), 20000)
    return () => clearInterval(interval)
  }, [])

  const uid = pb.authStore.model.id

  const buildRequestContexts = async (incoming) => {
    if (incoming.length === 0) { setRequestContexts({}); return }
    try {
      const [myFriendsA, myFriendsB, myMemberships, myOwned] = await Promise.all([
        pb.collection('friends').getFullList({ filter: `user_a="${uid}"`, requestKey: null }),
        pb.collection('friends').getFullList({ filter: `user_b="${uid}"`, requestKey: null }),
        pb.collection('members').getFullList({ filter: `user="${uid}"`, requestKey: null }),
        pb.collection('servers').getFullList({ filter: `owner="${uid}"`, requestKey: null }),
      ])
      const myFriendIds = new Set([
        ...myFriendsA.map((f) => f.user_b),
        ...myFriendsB.map((f) => f.user_a),
      ])
      const myServerIds = new Set([
        ...myMemberships.map((m) => m.server),
        ...myOwned.map((s) => s.id),
      ])

      const entries = await Promise.all(incoming.map(async (req) => {
        const otherId = req.from_user
        const [theirA, theirB, theirMemberships, theirOwned] = await Promise.all([
          pb.collection('friends').getFullList({ filter: `user_a="${otherId}"`, requestKey: null }),
          pb.collection('friends').getFullList({ filter: `user_b="${otherId}"`, requestKey: null }),
          pb.collection('members').getFullList({ filter: `user="${otherId}"`, requestKey: null }),
          pb.collection('servers').getFullList({ filter: `owner="${otherId}"`, requestKey: null }),
        ])
        const theirFriendIds = [
          ...theirA.map((f) => f.user_b),
          ...theirB.map((f) => f.user_a),
        ]
        const theirServerIds = new Set([
          ...theirMemberships.map((m) => m.server),
          ...theirOwned.map((s) => s.id),
        ])
        return [otherId, {
          mutualFriends: theirFriendIds.filter((id) => myFriendIds.has(id)).length,
          mutualServers: [...theirServerIds].filter((id) => myServerIds.has(id)).length,
        }]
      }))
      setRequestContexts(Object.fromEntries(entries))
    } catch (err) {
      console.error('Friend request context error:', err)
    }
  }

  const loadEverything = async () => {
    try {
      const incoming = await pb.collection('friend_requests').getFullList({
        filter: `to_user="${uid}" && status="pending"`,
        expand: 'from_user,context_server',
      })
      setIncomingRequests(incoming)
      buildRequestContexts(incoming)

      const outgoing = await pb.collection('friend_requests').getFullList({
        filter: `from_user="${uid}" && status="pending"`,
        expand: 'to_user',
      })
      setOutgoingRequests(outgoing)

      const friendsA = await pb.collection('friends').getFullList({
        filter: `user_a="${uid}"`,
        expand: 'user_b',
      })
      const friendsB = await pb.collection('friends').getFullList({
        filter: `user_b="${uid}"`,
        expand: 'user_a',
      })

      const combinedFriends = [
        ...friendsA.map((f) => ({ recordId: f.id, user: f.expand?.user_b })),
        ...friendsB.map((f) => ({ recordId: f.id, user: f.expand?.user_a })),
      ].filter((f) => f.user)
      setFriendsList(combinedFriends)

      const invites = await pb.collection('invites').getFullList({
        filter: `target_user="${uid}" && status="active"`,
        expand: 'server',
        sort: '-created',
        requestKey: null,
      })
      setServerInvites(invites)
    } catch (err) {
      logPbError('Load friends error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptServerInvite = async (invite) => {
    setInviteError('')
    setBusyId(invite.id)
    try {
      const response = await fetch(`${POCKETBASE_URL}/api/orbit/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ code: invite.code }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setInviteError(data.error || 'Could not join that server')
        return
      }
      const server = await pb.collection('servers').getOne(data.serverId)
      if (onJoined) onJoined(server)
    } catch (err) {
      console.error('Accept server invite error:', err)
      setInviteError(err?.message || 'Could not join that server')
    } finally {
      setBusyId(null)
    }
  }

  const handleDeclineServerInvite = async (invite) => {
    setInviteError('')
    setBusyId(invite.id)
    try {
      await pb.collection('invites').update(invite.id, { status: 'declined' })
      setServerInvites((prev) => prev.filter((i) => i.id !== invite.id))
    } catch (err) {
      console.error('Decline server invite error:', err)
      setInviteError('Could not decline that invitation')
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    loadEverything()

    pb.collection('friend_requests').subscribe('*', (e) => {
      if (e.record.from_user === uid || e.record.to_user === uid) loadEverything()
    })
    pb.collection('friends').subscribe('*', (e) => {
      if (e.record.user_a === uid || e.record.user_b === uid) loadEverything()
    })
    pb.collection('invites').subscribe('*', (e) => {
      if (e.record.target_user === uid) loadEverything()
    })

    return () => {
      pb.collection('friend_requests').unsubscribe('*')
      pb.collection('friends').unsubscribe('*')
      pb.collection('invites').unsubscribe('*')
    }
  }, [])

  const handleSendRequest = async (e) => {
    e.preventDefault()
    setSearchError('')
    setSearchSuccess('')

    if (!searchInput.trim()) {
      setSearchError('Enter a username or ID')
      return
    }

    setSearching(true)

    try {
      const matches = await pb.collection('users').getFullList({
        filter: `username="${searchInput.trim()}" || id="${searchInput.trim()}"`,
      })

      if (matches.length === 0) {
        setSearchError('No user found with that username or ID')
        return
      }

      const targetUser = matches[0]

      if (targetUser.id === uid) {
        setSearchError("You can't add yourself")
        return
      }

      const alreadyFriends = friendsList.some((f) => f.user?.id === targetUser.id)
      if (alreadyFriends) {
        setSearchError('You are already friends with this user')
        return
      }

      const requestPrivacy = targetUser.friend_request_privacy || 'everyone'

      if (requestPrivacy === 'no_one') {
        setSearchError("This user isn't accepting friend requests")
        return
      }

      if (requestPrivacy === 'friends_of_friends') {
        const [myFriendsA, myFriendsB, theirFriendsA, theirFriendsB] = await Promise.all([
          pb.collection('friends').getFullList({ filter: `user_a="${uid}"`, requestKey: null }),
          pb.collection('friends').getFullList({ filter: `user_b="${uid}"`, requestKey: null }),
          pb.collection('friends').getFullList({ filter: `user_a="${targetUser.id}"`, requestKey: null }),
          pb.collection('friends').getFullList({ filter: `user_b="${targetUser.id}"`, requestKey: null }),
        ])

        const myFriendIds = new Set([
          ...myFriendsA.map((f) => f.user_b),
          ...myFriendsB.map((f) => f.user_a),
        ])
        const theirFriendIds = new Set([
          ...theirFriendsA.map((f) => f.user_b),
          ...theirFriendsB.map((f) => f.user_a),
        ])

        const hasMutualFriend = [...myFriendIds].some((id) => theirFriendIds.has(id))
        if (!hasMutualFriend) {
          setSearchError('You need a mutual friend to send this user a friend request')
          return
        }
      }

      const existingRequest = await pb.collection('friend_requests').getFullList({
        filter: `(from_user="${uid}" && to_user="${targetUser.id}") || (from_user="${targetUser.id}" && to_user="${uid}")`,
      })
      if (existingRequest.some((r) => r.status === 'pending')) {
        setSearchError('A pending request already exists with this user')
        return
      }

      const note = requestMessage.trim()
      if (note.length > 160) {
        setSearchError('Your message can be at most 160 characters')
        return
      }
      if (/(https?:\/\/|www\.)/i.test(note)) {
        setSearchError("Friend request messages can't contain links")
        return
      }

      await pb.collection('friend_requests').create({
        from_user: uid,
        to_user: targetUser.id,
        status: 'pending',
        message: note || undefined,
      })

      setSearchSuccess(`Friend request sent to ${targetUser.name || targetUser.username}`)
      setSearchInput('')
      setRequestMessage('')
      loadEverything()
    } catch (err) {
      console.error(err)
      setSearchError('Something went wrong sending the request')
    } finally {
      setSearching(false)
    }
  }

  const handleAccept = async (request) => {
    setBusyId(request.id)
    try {
      await pb.collection('friend_requests').update(request.id, { status: 'accepted' })
      await pb.collection('friends').create({ user_a: request.from_user, user_b: request.to_user })
      loadEverything()
    } catch (err) {
      console.error(err)
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (request) => {
    setBusyId(request.id)
    try {
      await pb.collection('friend_requests').update(request.id, { status: 'rejected' })
      loadEverything()
    } catch (err) {
      console.error(err)
    } finally {
      setBusyId(null)
    }
  }

  const handleReportRequest = async (request) => {
    const reason = window.prompt('Why are you reporting this friend request?')
    if (!reason || !reason.trim()) return
    setReportingRequestId(request.id)
    try {
      await pb.collection('reports').create({
        reported_by: uid,
        target_type: 'user',
        target_id: request.from_user,
        reason: `Friend request: ${reason.trim()}`,
        status: 'pending',
      })
      setSearchSuccess('Report submitted')
    } catch (err) {
      console.error('Report friend request error:', err)
      setSearchError('Could not submit that report')
    } finally {
      setReportingRequestId(null)
    }
  }

  const handleUnfriend = async () => {
    const friend = pendingUnfriend
    if (!friend) return
    setBusyId(friend.recordId)
    try {
      await pb.collection('friends').delete(friend.recordId)
      setPendingUnfriend(null)
      loadEverything()
    } catch (err) {
      console.error(err)
    } finally {
      setBusyId(null)
    }
  }

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const friendsWithStatus = friendsList.map((f) => ({ ...f, status: getEffectiveStatus(f.user) }))
  const onlineFriends = friendsWithStatus.filter((f) => f.status !== 'offline').sort(compareFriends)
  const pendingCount = incomingRequests.length + serverInvites.length
  // Active Now is about what friends are *doing*, matching its empty-state copy.
  const activeFriends = onlineFriends.filter((f) => getActivity(f.user)).slice(0, 12)

  const notice = searchError
    ? { type: 'error', text: searchError }
    : searchSuccess
      ? { type: 'success', text: searchSuccess }
      : inviteError
        ? { type: 'error', text: inviteError }
        : null

  const dismissNotice = () => {
    setSearchError('')
    setSearchSuccess('')
    setInviteError('')
  }

  const selectTab = (id) => {
    setTab(id)
    setQuery('')
    dismissNotice()
  }

  const changeQuery = (value) => {
    setQuery(value)
    dismissNotice()
  }

  const renderFriendRows = (list) => (
    <ul className="friends-list list-reset">
      {list.map((friend) => (
        <Row
          key={friend.recordId}
          avatar={<Avatar user={friend.user} status={friend.status} />}
          name={friend.user?.name || 'Unknown'}
          username={friend.user?.username}
          sub={friendSubtitle(friend.user)}
          actions={(
            <>
              <button
                type="button"
                className="friend-action-btn"
                title={`Message ${friend.user?.name || 'friend'}`}
                aria-label={`Message ${friend.user?.name || 'friend'}`}
                onClick={() => onMessageFriend(friend.user.id)}
              >
                <IconChat />
              </button>
              <button
                type="button"
                className="friend-action-btn danger"
                title={`Remove ${friend.user?.name || 'friend'}`}
                aria-label={`Remove ${friend.user?.name || 'friend'}`}
                onClick={() => setPendingUnfriend(friend)}
              >
                <IconClose />
              </button>
            </>
          )}
        />
      ))}
    </ul>
  )

  const noFriendsEmpty = (
    <EmptyState
      title="No friends yet"
      body="Add someone by their Orbit username or ID to get started."
      action={(
        <button type="button" className="friends-action friends-action--primary" onClick={() => selectTab('add')}>
          Add Friend
        </button>
      )}
    />
  )

  const renderOnlinePanel = () => {
    if (loading) return <SkeletonList count={6} />
    if (friendsList.length === 0) return noFriendsEmpty

    const results = onlineFriends.filter((f) => matchesQuery(f.user, query))
    return (
      <>
        <SearchBar value={query} onChange={changeQuery} onClear={() => changeQuery('')} />
        {results.length === 0 && query ? (
          <EmptyState title={`No matches for “${query}”`} body="Check the spelling, or try their username." />
        ) : onlineFriends.length === 0 ? (
          <EmptyState
            title="No one's online right now"
            body="Friends who are active will show up here."
            action={(
              <button type="button" className="friends-action" onClick={() => selectTab('all')}>
                View all friends
              </button>
            )}
          />
        ) : (
          <>
            <SectionTitle>Online — {results.length}</SectionTitle>
            {renderFriendRows(results)}
          </>
        )}
      </>
    )
  }

  const renderAllPanel = () => {
    if (loading) return <SkeletonList count={6} />
    if (friendsList.length === 0) return noFriendsEmpty

    const results = friendsWithStatus.filter((f) => matchesQuery(f.user, query))
    const online = results.filter((f) => f.status !== 'offline').sort(compareFriends)
    const offline = results.filter((f) => f.status === 'offline').sort(compareFriends)

    return (
      <>
        <SearchBar value={query} onChange={changeQuery} onClear={() => changeQuery('')} />
        {results.length === 0 ? (
          <EmptyState title={`No matches for “${query}”`} body="Check the spelling, or try their username." />
        ) : (
          <>
            {online.length > 0 && (
              <>
                <SectionTitle>Online — {online.length}</SectionTitle>
                {renderFriendRows(online)}
              </>
            )}
            {offline.length > 0 && (
              <>
                <SectionTitle>Offline — {offline.length}</SectionTitle>
                {renderFriendRows(offline)}
              </>
            )}
          </>
        )}
      </>
    )
  }

  const renderPendingPanel = () => {
    if (loading) return <SkeletonList count={3} />
    const hasAny = incomingRequests.length > 0 || outgoingRequests.length > 0 || serverInvites.length > 0
    if (!hasAny) {
      return (
        <EmptyState
          title="No pending requests"
          body="Friend requests and server invites you receive will appear here."
        />
      )
    }

    return (
      <>
        {incomingRequests.length > 0 && (
          <>
            <SectionTitle>Incoming — {incomingRequests.length}</SectionTitle>
            <ul className="friends-list list-reset">
              {incomingRequests.map((req) => {
                const from = req.expand?.from_user
                const ctx = requestContexts[req.from_user]
                const meta = ctx === undefined
                  ? 'Checking mutual connections…'
                  : [
                    `${ctx.mutualFriends} mutual friend(s)`,
                    `${ctx.mutualServers} mutual server(s)`,
                    from?.created ? `Account created ${formatDate(from.created)}` : null,
                    req.expand?.context_server ? `Sent from ${req.expand.context_server.name}` : null,
                  ].filter(Boolean).join(' · ')
                return (
                  <Row
                    key={req.id}
                    avatar={<Avatar user={from} />}
                    name={from?.name || 'Unknown'}
                    username={from?.username}
                    sub={`Incoming friend request · Received ${formatDate(req.created)}`}
                    meta={meta}
                    note={req.message ? `“${req.message}”` : null}
                    actionsAlways
                    actions={(
                      <>
                        <button
                          type="button"
                          className="friends-action friends-action--primary"
                          onClick={() => handleAccept(req)}
                          disabled={busyId === req.id}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="friends-action"
                          onClick={() => handleReject(req)}
                          disabled={busyId === req.id}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="friends-action friends-action--ghost"
                          onClick={() => handleReportRequest(req)}
                          disabled={reportingRequestId === req.id}
                        >
                          {reportingRequestId === req.id ? 'Reporting…' : 'Report'}
                        </button>
                      </>
                    )}
                  />
                )
              })}
            </ul>
          </>
        )}

        {outgoingRequests.length > 0 && (
          <>
            <SectionTitle>Outgoing — {outgoingRequests.length}</SectionTitle>
            <ul className="friends-list list-reset">
              {outgoingRequests.map((req) => {
                const to = req.expand?.to_user
                return (
                  <Row
                    key={req.id}
                    avatar={<Avatar user={to} />}
                    name={to?.name || 'Unknown'}
                    username={to?.username}
                    sub={`Outgoing friend request · Sent ${formatDate(req.created)}`}
                  />
                )
              })}
            </ul>
          </>
        )}

        {serverInvites.length > 0 && (
          <>
            <SectionTitle>Server Invites — {serverInvites.length}</SectionTitle>
            <ul className="friends-list list-reset">
              {serverInvites.map((invite) => (
                <Row
                  key={invite.id}
                  avatar={<Avatar user={invite.expand?.server} shape="square" imageField="icon" />}
                  name={invite.expand?.server?.name || 'A server'}
                  sub="Server invitation"
                  actionsAlways
                  actions={(
                    <>
                      <button
                        type="button"
                        className="friends-action friends-action--primary"
                        onClick={() => handleAcceptServerInvite(invite)}
                        disabled={busyId === invite.id}
                      >
                        Join
                      </button>
                      <button
                        type="button"
                        className="friends-action"
                        onClick={() => handleDeclineServerInvite(invite)}
                        disabled={busyId === invite.id}
                      >
                        Decline
                      </button>
                    </>
                  )}
                />
              ))}
            </ul>
          </>
        )}
      </>
    )
  }

  const noteLength = requestMessage.length
  const counterClass = noteLength >= 160
    ? 'friends-counter friends-counter--max'
    : noteLength >= 140
      ? 'friends-counter friends-counter--warn'
      : 'friends-counter'

  const renderAddPanel = () => (
    <div className="friends-add">
      <h2>Add Friend</h2>
      <p className="friends-add-hint">
        You can add friends with their Orbit username or ID. Notes can't contain links and are capped at 160 characters.
      </p>
      <form className="friends-add-form" onSubmit={handleSendRequest} aria-busy={searching}>
        <div className="friends-field">
          <div className="friends-field-head">
            <label htmlFor="friends-add-username">Username or ID</label>
          </div>
          <input
            id="friends-add-username"
            type="text"
            placeholder="Enter a username or ID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="friends-field">
          <div className="friends-field-head">
            <label htmlFor="friends-add-note">Note (optional)</label>
            <span className={counterClass}>{noteLength}/160</span>
          </div>
          <input
            id="friends-add-note"
            type="text"
            placeholder="Add a short note"
            value={requestMessage}
            maxLength={160}
            onChange={(e) => setRequestMessage(e.target.value)}
          />
        </div>
        <div className="friends-submit">
          <button type="submit" className="friends-action friends-action--primary" disabled={searching}>
            {searching && <span className="friends-spinner" aria-hidden="true" />}
            {searching ? 'Sending…' : 'Send Friend Request'}
          </button>
        </div>
      </form>
    </div>
  )

  const renderActiveNow = () => (
    <aside className="friends-active">
      <div className="friends-active-header">
        <h2 className="friends-active-title">Active Now</h2>
      </div>
      <div className="friends-active-list">
        {loading ? (
          <SkeletonList count={2} compact />
        ) : activeFriends.length === 0 ? (
          <div className="friends-active-empty">
            <strong>It's quiet for now…</strong>
            <p>When a friend starts an activity — like playing a game or hanging out on voice — we'll show it here!</p>
          </div>
        ) : (
          <ul className="friends-list list-reset">
            {activeFriends.map((friend) => (
              <Row
                key={friend.recordId}
                compact
                onClick={() => onMessageFriend(friend.user.id)}
                avatar={<Avatar user={friend.user} compact status={friend.status} />}
                name={friend.user?.name || 'Unknown'}
                sub={`🎮 ${getActivity(friend.user)}`}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )

  return (
    <>
      <div className="friends-shell">
        <div className="friends-main">
          <div className="friends-topbar">
            <div className="friends-topbar-title">
              <IconPeople />
              <span>Friends</span>
            </div>
            <span className="friends-topbar-divider" aria-hidden="true" />
            <div className="friends-tabs" role="tablist" aria-label="Friends sections">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`friends-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`friends-panel-${t.id}`}
                  className={`friends-tab${t.cta ? ' friends-tab--cta' : ''}`}
                  onClick={() => selectTab(t.id)}
                >
                  {t.label}
                  {t.id === 'pending' && pendingCount > 0 && (
                    <span className="friends-tab-badge">{pendingCount > 99 ? '99+' : pendingCount}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="friends-body">
            <div
              key={tab}
              id={`friends-panel-${tab}`}
              role="tabpanel"
              aria-labelledby={`friends-tab-${tab}`}
              className="friends-panel"
            >
              {notice && (
                <Notice type={notice.type} onDismiss={dismissNotice}>{notice.text}</Notice>
              )}
              {tab === 'online' && renderOnlinePanel()}
              {tab === 'all' && renderAllPanel()}
              {tab === 'pending' && renderPendingPanel()}
              {tab === 'add' && renderAddPanel()}
            </div>
          </div>
        </div>

        {renderActiveNow()}
      </div>

      {pendingUnfriend && (
        <ConfirmDialog
          title="Remove friend"
          message={`Remove ${pendingUnfriend.user?.name || 'this user'} from your friends?`}
          confirmLabel="Remove"
          onConfirm={handleUnfriend}
          onCancel={() => setPendingUnfriend(null)}
        />
      )}
    </>
  )
}

export default Friends
