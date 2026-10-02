// presence.js — a user's `status` field is just what they last manually
// chose (online/idle/dnd/invisible) and, on its own, persists forever even
// after they close the app entirely — there was no actual connection-based
// presence before this. HEARTBEAT_STALE_MS is the cutoff: if last_seen is
// older than this, we treat them as offline for DISPLAY purposes no matter
// what their stored status says, since nothing is actually confirming
// they're still connected. The real status field itself is untouched by
// this — only what other users see is affected.

export const HEARTBEAT_INTERVAL_MS = 25000 // how often App.jsx pings last_seen while open
export const HEARTBEAT_STALE_MS = 60000    // comfortably more than one interval, tolerates a missed beat

// Pass the raw user record (or an expanded user object with .status and
// .last_seen). Returns the status that should actually be DISPLAYED.
export function getEffectiveStatus(user) {
  if (!user) return 'offline'

  const lastSeen = user.last_seen ? new Date(user.last_seen).getTime() : 0
  const isStale = !lastSeen || (Date.now() - lastSeen) > HEARTBEAT_STALE_MS

  if (isStale) return 'offline'

  // invisible is a deliberate choice to APPEAR offline to others even
  // while actually connected — that's unrelated to staleness, keep as-is.
  if (user.status === 'invisible') return 'offline'

  return user.status || 'online'
}