import { useEffect, useState } from 'react'
import pb from './pocketbase'

// Single source of truth for the current user's DM conversation list.
//
// Previously HomeSidebar and DMs.jsx each ran their own two-query
// dm_threads load WITHOUT `requestKey: null`. Because PocketBase's JS SDK
// auto-cancels same-collection requests by a shared key, those concurrent
// loads could abort each other — which is why one account could show a
// conversation in the DM pane while its sidebar said "No conversations yet",
// intermittently and account-dependently. This module:
//   - runs ONE subscription for the whole app,
//   - always passes requestKey:null,
//   - dedupes concurrent loads,
//   - tears the subscription down on account change,
//   - ignores late responses from a previous account.

let currentUid = null
let threads = []
let loading = false
let inFlight = null
let inFlightUid = null
let unsubscribeRealtime = null
const subscribers = new Set()

function emit() {
  subscribers.forEach((cb) => cb())
}

export async function loadThreads(uid) {
  if (!uid) return []
  if (inFlight && inFlightUid === uid) return inFlight

  inFlightUid = uid
  inFlight = (async () => {
    loading = true
    emit()
    try {
      // requestKey:null on BOTH so they can't auto-cancel each other or any
      // sibling dm_threads request elsewhere.
      const [recordsA, recordsB] = await Promise.all([
        pb.collection('dm_threads').getFullList({
          filter: `user_a="${uid}"`,
          expand: 'user_b',
          requestKey: null,
        }),
        pb.collection('dm_threads').getFullList({
          filter: `user_b="${uid}"`,
          expand: 'user_a',
          requestKey: null,
        }),
      ])

      const combined = [
        ...recordsA.map((t) => ({ id: t.id, otherUser: t.expand?.user_b })),
        ...recordsB.map((t) => ({ id: t.id, otherUser: t.expand?.user_a })),
      ].filter((t) => t.otherUser)

      // If the account changed while this was in flight, drop the result.
      if (uid !== currentUid) return threads

      threads = combined
      return combined
    } catch (err) {
      console.error('Load DM threads error:', err)
      return threads
    } finally {
      loading = false
      inFlight = null
      inFlightUid = null
      emit()
    }
  })()

  return inFlight
}

export function initDmStore(uid) {
  const next = uid || null
  if (currentUid === next) return
  currentUid = next
  threads = []

  if (unsubscribeRealtime) {
    try { unsubscribeRealtime() } catch { /* already gone */ }
    unsubscribeRealtime = null
  }

  if (!next) {
    emit()
    return
  }

  loadThreads(next)

  const subscribedFor = next
  pb.collection('dm_threads').subscribe('*', () => loadThreads(subscribedFor)).then((fn) => {
    // Account changed before the subscribe resolved — don't leak it.
    if (currentUid !== subscribedFor) {
      fn()
      return
    }
    unsubscribeRealtime = fn
  }).catch((err) => console.error('DM threads subscribe error:', err))
}

export function useDmThreads() {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    subscribers.add(cb)
    return () => subscribers.delete(cb)
  }, [])
  return { threads, loading, reload: () => loadThreads(currentUid) }
}
