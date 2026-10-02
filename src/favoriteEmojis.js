import { useEffect, useState } from 'react'
import pb from './pocketbase'

// Up to 5 favourite emojis per user, stored on users.favorite_emojis (JSON).
// Favourites appear as quick-reactions while Shift is held over a message, and
// are toggled by right-clicking an emoji in the picker.
const MAX_FAVORITES = 5

let favorites = []
const listeners = new Set()

function emit() {
  listeners.forEach((cb) => cb())
}

function readFromModel() {
  const raw = pb.authStore.model?.favorite_emojis
  favorites = Array.isArray(raw) ? raw.slice(0, MAX_FAVORITES) : []
}

export function getFavoriteEmojis() {
  return favorites
}

export function isFavoriteEmoji(emoji) {
  return favorites.includes(emoji)
}

export function toggleFavoriteEmoji(emoji) {
  if (!emoji) return
  readFromModel()
  let next
  if (favorites.includes(emoji)) {
    next = favorites.filter((e) => e !== emoji)
  } else {
    next = [...favorites, emoji]
    // Keep the most recent 5.
    if (next.length > MAX_FAVORITES) next = next.slice(next.length - MAX_FAVORITES)
  }
  favorites = next
  emit()

  const uid = pb.authStore.model?.id
  if (!uid) return
  pb.collection('users').update(uid, { favorite_emojis: next }, { requestKey: null })
    .then(() => pb.collection('users').authRefresh())
    .catch((err) => console.error('Save favourite emoji error:', err))
}

// Re-renders the calling component whenever favourites change.
export function useFavoriteEmojis() {
  const [, force] = useState(0)
  useEffect(() => {
    readFromModel()
    const cb = () => force((n) => n + 1)
    listeners.add(cb)
    const unsub = pb.authStore.onChange(() => { readFromModel(); emit() })
    return () => {
      listeners.delete(cb)
      unsub()
    }
  }, [])
  return favorites
}

export { MAX_FAVORITES }
