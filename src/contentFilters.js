import pb from './pocketbase'

// content_filter_media values: 'show_all' | 'blur_non_friends' | 'blur_all'
// Cheap, instant, no ML — purely based on the sender/viewer relationship.
// Returns true if the image should START blurred (still click-to-reveal
// either way; this only decides the DEFAULT state).
export async function shouldBlurByRelationship(senderId, myUserId) {
  const me = pb.authStore.model
  if (!me) return false

  const setting = me.content_filter_media || 'show_all'

  if (setting === 'show_all') return false
  if (setting === 'blur_all') return true
  if (senderId === myUserId) return false // never blur your own sent images to yourself

  // blur_non_friends
  try {
    const asA = await pb.collection('friends').getFirstListItem(
      `user_a="${myUserId}" && user_b="${senderId}"`
    ).catch(() => null)
    if (asA) return false
    const asB = await pb.collection('friends').getFirstListItem(
      `user_a="${senderId}" && user_b="${myUserId}"`
    ).catch(() => null)
    return !asB // blur unless they ARE a friend
  } catch (err) {
    console.error('shouldBlurByRelationship friend check error:', err)
    return true // fail toward MORE cautious (blur) if the check itself breaks
  }
}

// Combined NSFW + NSFL probability above this is treated as flagged.
// Deliberately not per-category — a moderate NSFW score plus a moderate
// NSFL score can add up to something worth flagging even if neither one
// alone crosses a per-category bar. Kept as a named constant rather than
// scattered magic numbers, and easy to move into a user-configurable
// setting later if wanted.
export const NSFW_FLAG_THRESHOLD = 0.5

export function isFlaggedByNsfwScan(probs) {
  if (!probs) return false
  return (probs.NSFW + probs.NSFL) >= NSFW_FLAG_THRESHOLD
}

// Shared friend-check, used by both the relationship blur above and the
// link spam filter below — both need the same "are these two actually
// friends" answer.
export async function areFriends(userIdA, userIdB) {
  if (userIdA === userIdB) return true
  try {
    const asA = await pb.collection('friends').getFirstListItem(
      `user_a="${userIdA}" && user_b="${userIdB}"`
    ).catch(() => null)
    if (asA) return true
    const asB = await pb.collection('friends').getFirstListItem(
      `user_a="${userIdB}" && user_b="${userIdA}"`
    ).catch(() => null)
    return !!asB
  } catch (err) {
    console.error('areFriends check error:', err)
    return false // fail toward MORE cautious (treat as not-friends) if the check breaks
  }
}

const LINK_PATTERN = /https?:\/\/[^\s]+/i

export function containsLink(text) {
  return LINK_PATTERN.test(text || '')
}

// spam_filter_keywords is a free-text field; accept one keyword per line
// and/or comma-separated. Empty/whitespace-only entries are ignored, so an
// empty setting simply disables the filter.
export function parseKeywordList(raw) {
  if (!raw || typeof raw !== 'string') return []
  return raw.split(/[\n,]+/).map((k) => k.trim()).filter(Boolean)
}

export function textHasBlockedKeyword(text, rawKeywords) {
  const keywords = parseKeywordList(rawKeywords)
  if (keywords.length === 0) return false
  const haystack = (text || '').toLowerCase()
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))
}

// Returns 'link' | 'keyword' | null for the logged-in viewer. Links are only
// blocked from non-friends (as before); keywords are matched case-
// insensitively regardless of who sent them. Your own messages are never
// hidden from you.
export async function getTextBlockReason(senderId, text) {
  const me = pb.authStore.model
  if (!me) return null
  if (senderId === me.id) return null

  if (me.spam_filter_block_links && containsLink(text)) {
    const friends = await areFriends(senderId, me.id)
    if (!friends) return 'link'
  }

  if (textHasBlockedKeyword(text, me.spam_filter_keywords)) return 'keyword'

  return null
}

// Viewer-side "spam_filter_rate_limit" helper: true when the message at
// `index` is part of a rapid burst (more than `max` messages from the same
// sender within `windowSeconds`). Used to collapse bursts behind a reveal
// button for users who opted in. The authoritative anti-spam throttle is
// still server-side (pb_hooks/messages_moderation.pb.js).
export function isBurstMessage(messages, index, windowSeconds = 10, max = 5) {
  const msg = messages[index]
  if (!msg) return false
  // PocketBase timestamps use a space separator; normalise to ISO so the
  // parse is reliable across browsers.
  const parseTime = (value) => new Date(String(value).replace(' ', 'T')).getTime()
  const senderOf = (m) => m?.sender || m?.expand?.sender?.id
  const senderId = senderOf(msg)
  if (!senderId) return false
  const t = parseTime(msg.created)
  if (Number.isNaN(t)) return false

  let count = 0
  for (let i = index; i >= 0; i--) {
    const m = messages[i]
    if (senderOf(m) !== senderId) break
    const mt = parseTime(m.created)
    if (Number.isNaN(mt) || t - mt > windowSeconds * 1000) break
    count++
  }
  return count > max
}