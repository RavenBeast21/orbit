import pb from './pocketbase'
import { formatDate } from './formatting'

// Banner priority: premium image/gif > plus image > solid colour > none.
// Works for both `users` records and `server_profiles` records since they
// share the same three field names.
export function resolveBanner(record) {
  if (!record) return { type: 'none', value: null }

  if (record.banner_premium) {
    return { type: 'image', value: pb.files.getURL(record, record.banner_premium) }
  }
  if (record.banner_plus) {
    return { type: 'image', value: pb.files.getURL(record, record.banner_plus) }
  }
  if (record.banner_colour) {
    return { type: 'colour', value: record.banner_colour }
  }
  return { type: 'none', value: null }
}

// Whether `viewerId` may see `targetUser`'s custom activity, based on
// show_activity + activity_visibility. Returns false if there's no activity.
export async function activityVisibleTo(targetUser, viewerId) {
  if (!targetUser?.show_activity || !targetUser?.custom_activity) return false
  if (viewerId === targetUser.id) return true
  const visibility = targetUser.activity_visibility || 'everyone'
  if (visibility === 'everyone') return true
  if (visibility === 'nobody') return false
  if (visibility === 'friends') return isFriend(viewerId, targetUser.id)
  return false
}

export async function isFriend(viewerId, targetId) {
  if (!viewerId || !targetId) return false
  try {
    const asA = await pb.collection('friends').getFirstListItem(
      `user_a="${viewerId}" && user_b="${targetId}"`,
      { requestKey: null }
    ).catch(() => null)
    if (asA) return true
    const asB = await pb.collection('friends').getFirstListItem(
      `user_a="${targetId}" && user_b="${viewerId}"`,
      { requestKey: null }
    ).catch(() => null)
    return !!asB
  } catch {
    return false
  }
}

async function getServerIdSet(userId) {
  const [memberships, owned] = await Promise.all([
    pb.collection('members').getFullList({ filter: `user="${userId}"`, requestKey: null }),
    pb.collection('servers').getFullList({ filter: `owner="${userId}"`, requestKey: null }),
  ])
  const ids = new Set()
  memberships.forEach((m) => ids.add(m.server))
  owned.forEach((s) => ids.add(s.id))
  return ids
}

// Servers shared between the viewer and `targetUser`, gated by the target's
// mutual_servers_visibility (report §4.22). Returns { allowed, servers }:
// `allowed` is false when the target has hidden them, in which case the UI
// shows a "Hidden" note only if there WOULD have been something to show.
export async function getMutualServers(viewerId, targetUser) {
  if (!viewerId || !targetUser) return { allowed: true, servers: [] }
  if (viewerId === targetUser.id) return { allowed: true, servers: [] }

  const [mine, theirs] = await Promise.all([
    getServerIdSet(viewerId),
    getServerIdSet(targetUser.id),
  ])
  const sharedIds = [...theirs].filter((id) => mine.has(id))
  if (sharedIds.length === 0) return { allowed: true, servers: [] }

  const setting = targetUser.mutual_servers_visibility || 'everyone'
  if (setting === 'nobody') return { allowed: false, servers: [] }
  if (setting === 'friends') {
    const friends = await isFriend(viewerId, targetUser.id)
    if (!friends) return { allowed: false, servers: [] }
  }
  // 'everyone' and 'server_members' both allow it here — the viewer already
  // shares at least one server with the target by definition.

  const filter = sharedIds.map((id) => `id="${id}"`).join(' || ')
  const servers = await pb.collection('servers').getFullList({
    filter,
    fields: 'id,name,icon',
    requestKey: null,
  })
  return { allowed: true, servers }
}

export function formatMemberSince(dateString) {
  if (!dateString) return ''
  return formatDate(dateString)
}

// Checks whether `viewerId` is allowed to see `targetUser`'s full profile
// (bio, connected accounts) based on their profile_privacy setting:
//   all_servers      - anyone sharing a server with them (always true here,
//                       since every place this is called is already
//                       inside a shared-server or DM context)
//   all_friends       - only people on their friends list
//   specific_friends  - only the exact people they've picked
// Always true for viewing your own profile. Defaults to 'all_servers'
// (most permissive) if the field has never been set, matching the field's
// own default.
export async function canViewFullProfile(viewerId, targetUser) {
  if (!targetUser || !viewerId) return false
  if (viewerId === targetUser.id) return true

  const privacy = targetUser.profile_privacy || 'all_servers'

  if (privacy === 'all_servers') return true

  if (privacy === 'specific_friends') {
    return (targetUser.profile_privacy_friends || []).includes(viewerId)
  }

  if (privacy === 'all_friends') {
    try {
      const asA = await pb.collection('friends').getFirstListItem(
        `user_a="${targetUser.id}" && user_b="${viewerId}"`
      ).catch(() => null)
      if (asA) return true
      const asB = await pb.collection('friends').getFirstListItem(
        `user_a="${viewerId}" && user_b="${targetUser.id}"`
      ).catch(() => null)
      return !!asB
    } catch (err) {
      console.error('canViewFullProfile friend check error:', err)
      return false
    }
  }

  return false
}