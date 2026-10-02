import { useEffect, useState } from 'react'
import pb from './pocketbase'

// Unread/mention state.
//
// DMs are now server-backed by the `dm_read_state` collection (see
// pb_hooks/dm_unread.pb.js). That is the single source of truth: one row per
// (recipient, thread) with an `unread_count`, incremented server-side when the
// other participant sends a message and zeroed when the recipient reads it.
// The client subscribes to its own rows, so counts update in realtime, survive
// refresh, do not leak across accounts, and a read on one device clears the
// badge on another.
//
// Server channels are still tracked client-side in localStorage (no server
// read-state for channels yet); they use the same public API below.

let uid = null

// Channel/server unread: { [id]: { count, mention } }
let channelState = { channels: {}, servers: {} }

// DM unread, from dm_read_state: threadId -> count / record id / last-updated
// (used to order unread conversations by most recent activity).
let dmCounts = {}
let dmRecordIds = {}
let dmUpdatedAt = {}

// Per-thread DM management state (report §4.38), carried on the same
// dm_read_state row: archived hides the conversation from the list until
// unarchived; closed hides it but the server reopens it on a new message;
// muted keeps it listed but hides its unread badge.
let dmArchived = {}
let dmClosed = {}
let dmMuted = {}
// threadId -> dm_folders record id (or undefined when unfiled).
let dmFolder = {}

// Presence/notification split (report §4.10). 'mute_all' hides unread
// badges; 'quiet' only suppresses sounds (handled in App.jsx).
let notificationMode = 'normal'

let dmUnsub = null
const listeners = new Set()

function emit() {
  listeners.forEach((cb) => cb())
}

function persistChannels() {
  if (!uid) return
  try {
    localStorage.setItem(`orbit_unread_${uid}`, JSON.stringify(channelState))
  } catch {
    // storage unavailable — channel indicators just won't survive reload
  }
}

function loadChannelState() {
  channelState = { channels: {}, servers: {} }
  try {
    const raw = localStorage.getItem(`orbit_unread_${uid}`)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') {
      channelState = {
        channels: parsed.channels || {},
        servers: parsed.servers || {},
      }
      // Drop the legacy client-side DM bucket now that DMs are server-backed.
      if (parsed.dms) persistChannels()
    }
  } catch {
    channelState = { channels: {}, servers: {} }
  }
}

async function loadDmReadState(userId) {
  try {
    const rows = await pb.collection('dm_read_state').getFullList({
      filter: `user="${userId}"`,
      requestKey: null,
    })
    if (uid !== userId) return // account changed while loading
    const counts = {}
    const recordIds = {}
    const updatedAt = {}
    const archived = {}
    const closed = {}
    const muted = {}
    const folder = {}
    rows.forEach((r) => {
      counts[r.thread] = r.unread_count || 0
      recordIds[r.thread] = r.id
      updatedAt[r.thread] = r.updated
      archived[r.thread] = !!r.archived
      closed[r.thread] = !!r.closed
      muted[r.thread] = !!r.muted
      if (r.folder) folder[r.thread] = r.folder
    })
    dmCounts = counts
    dmRecordIds = recordIds
    dmUpdatedAt = updatedAt
    dmArchived = archived
    dmClosed = closed
    dmMuted = muted
    dmFolder = folder
    emit()
  } catch (err) {
    console.error('Load DM read state error:', err)
  }
}

export function initUnread(userId) {
  const next = userId || null
  if (uid === next) return
  uid = next

  // Reset everything so no state leaks between accounts.
  channelState = { channels: {}, servers: {} }
  dmCounts = {}
  dmRecordIds = {}
  dmUpdatedAt = {}
  dmArchived = {}
  dmClosed = {}
  dmMuted = {}
  dmFolder = {}

  if (dmUnsub) {
    try { dmUnsub() } catch { /* already gone */ }
    dmUnsub = null
  }

  if (!uid) {
    emit()
    return
  }

  loadChannelState()
  emit()

  loadDmReadState(uid)

  const subscribedFor = uid
  pb.collection('dm_read_state').subscribe('*', (e) => {
    // Realtime should only deliver our own rows (view rule user=@auth.id),
    // but double-check so a stale subscription can never leak another
    // account's counts.
    if (!e.record || e.record.user !== subscribedFor) return
    if (e.action === 'delete') {
      delete dmCounts[e.record.thread]
      delete dmRecordIds[e.record.thread]
      delete dmUpdatedAt[e.record.thread]
      delete dmArchived[e.record.thread]
      delete dmClosed[e.record.thread]
      delete dmMuted[e.record.thread]
      delete dmFolder[e.record.thread]
    } else {
      dmCounts[e.record.thread] = e.record.unread_count || 0
      dmRecordIds[e.record.thread] = e.record.id
      dmUpdatedAt[e.record.thread] = e.record.updated
      dmArchived[e.record.thread] = !!e.record.archived
      dmClosed[e.record.thread] = !!e.record.closed
      dmMuted[e.record.thread] = !!e.record.muted
      if (e.record.folder) dmFolder[e.record.thread] = e.record.folder
      else delete dmFolder[e.record.thread]
    }
    emit()
  }).then((fn) => {
    if (uid !== subscribedFor) { fn(); return }
    dmUnsub = fn
  }).catch((err) => console.error('dm_read_state subscribe error:', err))
}

function bucket(kind) {
  return kind === 'server' ? channelState.servers : channelState.channels
}

export function bump(kind, id, isMention = false) {
  if (!uid || !id) return
  if (kind === 'dm') return // server hook owns DM counts
  const b = bucket(kind)
  const entry = b[id] || { count: 0, mention: false }
  entry.count += 1
  if (isMention) entry.mention = true
  b[id] = entry
  persistChannels()
  emit()
}

export function markRead(kind, id) {
  if (!uid || !id) return
  if (kind === 'dm') {
    markDmRead(id)
    return
  }
  const b = bucket(kind)
  if (b[id]) {
    delete b[id]
    persistChannels()
    emit()
  }
}

function markDmRead(threadId) {
  const current = dmCounts[threadId] || 0
  const recordId = dmRecordIds[threadId]
  if (current === 0 && !recordId) return

  // Optimistic clear, then persist.
  dmCounts[threadId] = 0
  delete dmUpdatedAt[threadId]
  emit()

  if (!recordId) return
  pb.collection('dm_read_state').update(
    recordId,
    { unread_count: 0, last_read_at: new Date().toISOString() },
    { requestKey: null }
  ).catch((err) => console.error('Mark DM read error:', err))
}

export function clearAllUnread() {
  channelState = { channels: {}, servers: {} }
  dmCounts = {}
  dmUpdatedAt = {}
  persistChannels()
  emit()
}

// Presence/notification split (report §4.10). Called on login and whenever the
// account's notification_mode changes.
export function setNotificationMode(mode) {
  const next = mode || 'normal'
  if (notificationMode === next) return
  notificationMode = next
  emit()
}

// Per-thread management state for bulk DM operations (report §4.38).
export function getDmPrefs(threadId) {
  return {
    archived: !!dmArchived[threadId],
    closed: !!dmClosed[threadId],
    muted: !!dmMuted[threadId],
    folder: dmFolder[threadId] || '',
  }
}

// Upserts this user's dm_read_state row with the given management flags.
// Creating the row here is safe (rule: user = @request.auth.id) and means a
// thread can be archived/muted even when it has never had unread messages.
export async function setDmPrefs(threadId, prefs) {
  if (!uid || !threadId) return
  if ('archived' in prefs) dmArchived[threadId] = !!prefs.archived
  if ('closed' in prefs) dmClosed[threadId] = !!prefs.closed
  if ('muted' in prefs) dmMuted[threadId] = !!prefs.muted
  if ('folder' in prefs) {
    if (prefs.folder) dmFolder[threadId] = prefs.folder
    else delete dmFolder[threadId]
  }
  emit()

  const payload = {}
  if ('archived' in prefs) payload.archived = !!prefs.archived
  if ('closed' in prefs) payload.closed = !!prefs.closed
  if ('muted' in prefs) payload.muted = !!prefs.muted
  if ('folder' in prefs) payload.folder = prefs.folder || ''

  try {
    const recordId = dmRecordIds[threadId]
    if (recordId) {
      await pb.collection('dm_read_state').update(recordId, payload, { requestKey: null })
    } else {
      const created = await pb.collection('dm_read_state').create(
        { user: uid, thread: threadId, unread_count: 0, ...payload },
        { requestKey: null }
      )
      dmRecordIds[threadId] = created.id
      dmCounts[threadId] = created.unread_count || 0
    }
  } catch (err) {
    console.error('Set DM prefs error:', err)
  }
}

export function getChannelUnread(channelId) {
  if (notificationMode === 'mute_all') return null
  return channelState.channels[channelId] || null
}

export function getServerUnread(serverId) {
  if (notificationMode === 'mute_all') return null
  return channelState.servers[serverId] || null
}

export function getDmUnread(threadId) {
  // Muted conversations and global mute_all never show a badge.
  if (notificationMode === 'mute_all') return null
  if (dmMuted[threadId]) return null
  const count = dmCounts[threadId] || 0
  // updatedAt is a sortable PocketBase timestamp used only for ordering the
  // global-rail unread avatars (most recent first).
  return count > 0 ? { count, updatedAt: dmUpdatedAt[threadId] || '' } : null
}

// Re-renders the calling component whenever unread state changes.
export function useUnread() {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, [])
}
