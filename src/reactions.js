import { useCallback, useEffect, useState } from 'react'
import pb from './pocketbase'

// Loads and tracks reactions for one scope — a server channel
// (scopeField='channel') or a DM thread (scopeField='thread'). Grouped by the
// target message id so each message row renders its own bar.
export function useReactions({ scopeField, scopeId }) {
  const [byTarget, setByTarget] = useState({})
  const enabled = !!scopeField && !!scopeId
  const scopeFilter = enabled ? `${scopeField}="${scopeId}"` : null

  const load = useCallback(async () => {
    if (!scopeFilter) return
    try {
      const rows = await pb.collection('reactions').getFullList({
        filter: scopeFilter,
        requestKey: null,
      })
      const map = {}
      rows.forEach((r) => {
        if (!r.message_id) return
        if (!map[r.message_id]) map[r.message_id] = []
        map[r.message_id].push(r)
      })
      setByTarget(map)
    } catch (err) {
      console.error('Load reactions error:', err)
    }
  }, [scopeFilter])

  useEffect(() => {
    if (!scopeFilter) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    let unsub
    pb.collection('reactions').subscribe('*', () => load()).then((fn) => { unsub = fn })
    return () => { if (unsub) unsub() }
  }, [load, scopeFilter])

  const toggle = useCallback(async (targetId, emoji, currentUserId) => {
    if (!targetId || !emoji || !currentUserId || !scopeFilter) return
    const rows = byTarget[targetId] || []
    const mine = rows.find((r) => r.emoji === emoji && r.user === currentUserId)
    try {
      if (mine) {
        setByTarget((prev) => ({
          ...prev,
          [targetId]: (prev[targetId] || []).filter((r) => r.id !== mine.id),
        }))
        await pb.collection('reactions').delete(mine.id, { requestKey: null })
      } else {
        const optimistic = { id: `tmp-${Date.now()}`, user: currentUserId, emoji, message_id: targetId }
        setByTarget((prev) => ({ ...prev, [targetId]: [...(prev[targetId] || []), optimistic] }))
        await pb.collection('reactions').create(
          { [scopeField]: scopeId, message_id: targetId, user: currentUserId, emoji },
          { requestKey: null }
        )
      }
    } catch (err) {
      console.error('Toggle reaction error:', err)
      load()
    }
  }, [byTarget, scopeField, scopeId, scopeFilter, load])

  return { byTarget, toggle }
}
