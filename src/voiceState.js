import { useEffect, useState } from 'react'

// Global self mute / deafen state, shared by the always-visible user panel
// and the active voice session (VoiceChannel / DMCall). Kept as a tiny store
// (not context) so any component can read/toggle it and voice UIs can apply
// the state to their LiveKit room.
//
// Deafen implies mute: deafening saves your previous mute state and mutes you;
// un-deafening restores it.

let state = { muted: false, deafened: false, mutedBeforeDeafen: false }
const listeners = new Set()

function emit() {
  listeners.forEach((cb) => cb())
}

export function getVoiceState() {
  return state
}

export function toggleMute() {
  if (state.deafened) {
    state = { ...state, deafened: false, muted: state.mutedBeforeDeafen }
  } else {
    state = { ...state, muted: !state.muted }
  }
  emit()
}

export function toggleDeafen() {
  if (state.deafened) {
    state = { ...state, deafened: false, muted: state.mutedBeforeDeafen }
  } else {
    state = { ...state, mutedBeforeDeafen: state.muted, deafened: true, muted: true }
  }
  emit()
}

export function resetVoiceState() {
  if (!state.muted && !state.deafened) return
  state = { muted: false, deafened: false, mutedBeforeDeafen: false }
  emit()
}

export function useVoiceState() {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, [])
  return state
}
