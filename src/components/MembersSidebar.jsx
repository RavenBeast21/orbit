import { useState, useEffect } from 'react'
import pb from '../pocketbase'
import { getEffectiveStatus } from '../presence'
import UserContextMenu from './UserContextMenu'
import ServerProfilePopup from './ServerProfilePopup'
import FullProfileModal from './FullProfileModal'
import InviteToServerModal from './InviteToServerModal'
import SubscriptionBadge from './SubscriptionBadge'

function statusColor(status) {
  if (status === 'idle') return 'var(--warning)'
  if (status === 'dnd') return 'var(--danger)'
  if (status === 'offline') return 'var(--border)'
  return 'var(--teal)'
}

function MembersSidebar({
  members,
  ownerName,
  ownerStatus,
  ownerAvatarUrl,
  ownerLastSeen,
  ownerId,
  serverId,
  showOfflineMembers,
  onStartCall,
  onMessage,
  onInsertMention,
}) {
  // Per-server profiles are an Orbit+/Premium perk — a user with one set
  // for THIS server shows their chosen nickname/avatar here instead of
  // their global name/avatar. Keyed by user id for fast lookup below.
  const [profilesByUser, setProfilesByUser] = useState({})

  // Staleness (going offline) is only ever DETECTED by comparing last_seen
  // against the current time — if nobody sends any new event (e.g. someone
  // just closes their tab and goes fully silent), nothing would otherwise
  // ever trigger a re-render to notice they've gone stale. This tick forces
  // one periodically so presence actually catches up.
  const [, forcePresenceTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => forcePresenceTick((t) => t + 1), 15000)
    return () => clearInterval(interval)
  }, [])

  // Roles with "display separately" enabled, sorted highest-rank first,
  // and which user id holds each one — drives the role-grouped sections
  // above the plain Online/Offline list (matches Discord's behaviour).
  const [displayRoles, setDisplayRoles] = useState([])
  const [roleUserIds, setRoleUserIds] = useState({}) // roleId -> Set of user ids

  // --- Click / right-click state for the profile UI ---
  const [contextMenu, setContextMenu] = useState(null) // { x, y, userId, isSelf }
  const [serverPopup, setServerPopup] = useState(null) // { x, y, userId }
  const [fullProfileUserId, setFullProfileUserId] = useState(null)
  const [inviteTargetUserId, setInviteTargetUserId] = useState(null)
  const [blockedUserIds, setBlockedUserIds] = useState(new Set())
  const [friendUserIds, setFriendUserIds] = useState(new Set())

  const myUid = pb.authStore.model?.id

  useEffect(() => {
    if (!serverId) return

    let cancelled = false

    const loadProfiles = async () => {
      try {
        const records = await pb.collection('server_profiles').getFullList({
          filter: `server="${serverId}"`,
          requestKey: null,
        })
        if (cancelled) return
        const byUser = {}
        records.forEach((p) => { byUser[p.user] = p })
        setProfilesByUser(byUser)
      } catch (err) {
        console.error('Load server profiles error:', err)
      }
    }

    const loadDisplayRoles = async () => {
      try {
        const roles = await pb.collection('roles').getFullList({
          filter: `server="${serverId}" && display_separately=true`,
          requestKey: null,
        })
        roles.sort((a, b) => b.position - a.position)
        if (cancelled) return
        setDisplayRoles(roles)

        if (roles.length === 0) {
          setRoleUserIds({})
          return
        }

        const roleFilter = roles.map((r) => `role="${r.id}"`).join(' || ')
        const links = await pb.collection('member_roles').getFullList({
          filter: roleFilter,
          expand: 'member.user',
          requestKey: null,
        })
        if (cancelled) return

        const map = {}
        for (const link of links) {
          const userId = link.expand?.member?.expand?.user?.id
          if (!userId) continue
          if (!map[link.role]) map[link.role] = new Set()
          map[link.role].add(userId)
        }
        setRoleUserIds(map)
      } catch (err) {
        console.error('Load display roles error:', err)
      }
    }

    loadProfiles()
    loadDisplayRoles()

    let unsubProfiles
    let unsubRoles
    let unsubMemberRoles
    pb.collection('server_profiles').subscribe('*', (e) => {
      if (e.record.server !== serverId) return
      loadProfiles()
    }).then((fn) => { unsubProfiles = fn })
    pb.collection('roles').subscribe('*', (e) => {
      if (e.record.server !== serverId) return
      loadDisplayRoles()
    }).then((fn) => { unsubRoles = fn })
    pb.collection('member_roles').subscribe('*', () => {
      loadDisplayRoles()
    }).then((fn) => { unsubMemberRoles = fn })

    return () => {
      cancelled = true
      if (unsubProfiles) unsubProfiles()
      if (unsubRoles) unsubRoles()
      if (unsubMemberRoles) unsubMemberRoles()
    }
  }, [serverId])

  // Load my own blocked list + friends list once, so the context menu can
  // show the right label (Block vs Unblock, hide Add Friend if already
  // friends) without a fresh query on every right-click.
  useEffect(() => {
    if (!myUid) return
    let cancelled = false

    const loadRelations = async () => {
      try {
        const blocked = await pb.collection('blocked_users').getFullList({
          filter: `blocker="${myUid}"`,
          requestKey: null,
        })
        if (!cancelled) setBlockedUserIds(new Set(blocked.map((b) => b.blocked)))
      } catch (err) {
        console.error('Load blocked users error:', err)
      }

      try {
        const friendsA = await pb.collection('friends').getFullList({
          filter: `user_a="${myUid}"`,
          requestKey: null,
        })
        const friendsB = await pb.collection('friends').getFullList({
          filter: `user_b="${myUid}"`,
          requestKey: null,
        })
        if (!cancelled) {
          setFriendUserIds(new Set([
            ...friendsA.map((f) => f.user_b),
            ...friendsB.map((f) => f.user_a),
          ]))
        }
      } catch (err) {
        console.error('Load friends error:', err)
      }
    }

    loadRelations()
  }, [myUid])

  const handleAddFriend = async (targetUserId) => {
    try {
      const existing = await pb.collection('friend_requests').getFullList({
        filter: `(from_user="${myUid}" && to_user="${targetUserId}") || (from_user="${targetUserId}" && to_user="${myUid}")`,
      })
      if (existing.some((r) => r.status === 'pending')) return
      await pb.collection('friend_requests').create({
        from_user: myUid,
        to_user: targetUserId,
        status: 'pending',
        context_server: serverId || undefined,
      })
    } catch (err) {
      console.error('Add friend error:', err)
    }
  }

  const handleToggleBlock = async (targetUserId) => {
    try {
      if (blockedUserIds.has(targetUserId)) {
        const existing = await pb.collection('blocked_users').getFullList({
          filter: `blocker="${myUid}" && blocked="${targetUserId}"`,
        })
        if (existing[0]) await pb.collection('blocked_users').delete(existing[0].id)
        setBlockedUserIds((prev) => {
          const next = new Set(prev)
          next.delete(targetUserId)
          return next
        })
      } else {
        await pb.collection('blocked_users').create({ blocker: myUid, blocked: targetUserId })
        setBlockedUserIds((prev) => new Set(prev).add(targetUserId))
      }
    } catch (err) {
      console.error('Toggle block error:', err)
    }
  }

  const handleReportUserProfile = async (targetUserId) => {
    try {
      await pb.collection('reports').create({
        reported_by: myUid,
        target_type: 'user_profile',
        target_id: targetUserId,
        reason: 'Reported from profile',
        status: 'pending',
      })
    } catch (err) {
      console.error('Report user profile error:', err)
    }
  }

  const renderRow = (entry) => (
    <div
      key={entry.key}
      className="members-sidebar-row"
      onClick={(e) => {
        if (!entry.userId) return
        setServerPopup({ x: e.clientX, y: e.clientY, userId: entry.userId })
      }}
      onContextMenu={(e) => {
        if (!entry.userId) return
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, userId: entry.userId, isSelf: entry.userId === myUid })
      }}
    >
      <div className="members-sidebar-avatar-wrap">
        {entry.avatarUrl ? (
          <img src={entry.avatarUrl} alt="" className="members-sidebar-avatar" />
        ) : (
          <div className="members-sidebar-avatar members-sidebar-avatar-fallback" />
        )}
        <span className="members-sidebar-status-dot" style={{ backgroundColor: statusColor(entry.status) }} />
      </div>
      <div>
        <div className="members-sidebar-name" style={entry.nameColour ? { color: entry.nameColour } : undefined}>
          {entry.name}{entry.isOwner && ' 👑'}
          <SubscriptionBadge user={entry.badgeUser} size="small" />
        </div>
      </div>
    </div>
  )

  const allEntries = [
    {
      key: 'owner',
      userId: ownerId,
      name: ownerName || 'Unknown',
      avatarUrl: ownerAvatarUrl,
      status: getEffectiveStatus({ status: ownerStatus, last_seen: ownerLastSeen }),
      isOwner: true,
    },
    ...members.map((member) => {
      const user = member.expand?.user
      const status = getEffectiveStatus(user)
      const profile = user ? profilesByUser[user.id] : null
      const displayName = profile?.nickname || user?.name || 'Unknown'
      const displayAvatarUrl = profile?.avatar
        ? pb.files.getURL(profile, profile.avatar, { thumb: '28x28' })
        : (user?.avatar ? pb.files.getURL(user, user.avatar, { thumb: '28x28' }) : null)

      return {
        key: member.id,
        userId: user?.id,
        name: displayName,
        avatarUrl: displayAvatarUrl,
        status,
        isOwner: false,
        badgeUser: user,
      }
    }),
  ]

  // Each entry belongs to at most ONE display-separately group — whichever
  // such role is HIGHEST ranked among the ones they hold (displayRoles is
  // already sorted highest-first, so the first match wins). Offline
  // members are NEVER grouped here, even if they hold a display-separately
  // role — they always fall through to the single Offline section below,
  // matching Discord's behaviour. Their role colour still carries over
  // (see offlineEntries below), just not the group placement.
  const groupedEntryKeys = new Set()
  const roleGroups = displayRoles.map((role) => {
    const userIds = roleUserIds[role.id] || new Set()
    const entries = allEntries.filter((e) => {
      if (!e.userId || groupedEntryKeys.has(e.key)) return false
      if (!userIds.has(e.userId)) return false
      if (e.status === 'offline') return false
      groupedEntryKeys.add(e.key)
      return true
    }).map((e) => ({ ...e, nameColour: role.colour }))

    return { role, entries }
  }).filter((g) => g.entries.length > 0)

  // Highest-ranked display-separately role each user holds, purely for
  // colour — reuses the same displayRoles/roleUserIds data the groups
  // above use, just without the grouping/exclusion behaviour.
  const colourForUser = (userId) => {
    for (const role of displayRoles) {
      if ((roleUserIds[role.id] || new Set()).has(userId)) return role.colour
    }
    return undefined
  }

  const ungroupedEntries = allEntries.filter((e) => !groupedEntryKeys.has(e.key))
  const onlineEntries = ungroupedEntries.filter((e) => e.status !== 'offline')
  const offlineEntries = ungroupedEntries
    .filter((e) => e.status === 'offline')
    .map((e) => ({ ...e, nameColour: e.userId ? colourForUser(e.userId) : undefined }))

  return (
    <div className="members-sidebar">
      {roleGroups.map(({ role, entries }) => (
        <div key={role.id}>
          <div className="members-sidebar-group-label" style={{ color: role.colour || undefined }}>
            {role.name} — {entries.length}
          </div>
          {entries.map(renderRow)}
        </div>
      ))}

      {onlineEntries.length > 0 && (
        <>
          <div className="members-sidebar-group-label">Online — {onlineEntries.length}</div>
          {onlineEntries.map(renderRow)}
        </>
      )}

      {showOfflineMembers && offlineEntries.length > 0 && (
        <>
          <div className="members-sidebar-group-label">Offline — {offlineEntries.length}</div>
          {offlineEntries.map(renderRow)}
        </>
      )}

      {contextMenu && (
        <UserContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          targetUser={{ id: contextMenu.userId }}
          isSelf={contextMenu.isSelf}
          isFriend={friendUserIds.has(contextMenu.userId)}
          isBlocked={blockedUserIds.has(contextMenu.userId)}
          onClose={() => setContextMenu(null)}
          onProfile={() => setFullProfileUserId(contextMenu.userId)}
          onMention={() => onInsertMention?.(contextMenu.userId)}
          onStartCall={() => onStartCall?.(contextMenu.userId)}
          onInviteToServer={() => { setInviteTargetUserId(contextMenu.userId); setContextMenu(null) }}
          onAddFriend={() => handleAddFriend(contextMenu.userId)}
          onBlock={() => handleToggleBlock(contextMenu.userId)}
        />
      )}

      {serverPopup && (
        <ServerProfilePopup
          x={serverPopup.x}
          y={serverPopup.y}
          targetUserId={serverPopup.userId}
          serverId={serverId}
          onClose={() => setServerPopup(null)}
          onMessage={() => { onMessage?.(serverPopup.userId); setServerPopup(null) }}
          onViewFullProfile={() => { setFullProfileUserId(serverPopup.userId); setServerPopup(null) }}
        />
      )}

      {fullProfileUserId && (
        <FullProfileModal
          targetUserId={fullProfileUserId}
          serverId={serverId}
          isBlocked={blockedUserIds.has(fullProfileUserId)}
          onClose={() => setFullProfileUserId(null)}
          onViewPerServerProfile={() => {
            const userId = fullProfileUserId
            setFullProfileUserId(null)
            setServerPopup({ x: window.innerWidth / 2 - 140, y: 100, userId })
          }}
          onInviteToServer={() => { setInviteTargetUserId(fullProfileUserId); setFullProfileUserId(null) }}
          onBlock={() => handleToggleBlock(fullProfileUserId)}
          onReport={() => handleReportUserProfile(fullProfileUserId)}
          onMessage={() => { onMessage?.(fullProfileUserId); setFullProfileUserId(null) }}
        />
      )}

      {inviteTargetUserId && (
        <InviteToServerModal
          serverId={serverId}
          targetUserId={inviteTargetUserId}
          onClose={() => setInviteTargetUserId(null)}
        />
      )}
    </div>
  )
}

export default MembersSidebar