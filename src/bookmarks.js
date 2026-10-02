import pb from './pocketbase'

// Personal, private bookmarks (report §4.23). Every row is owned by the user
// and only that user can read it (see the `bookmarks` collection rules), so
// saving a message never depends on server pin permissions or channel access.

// Loads the set of message ids this user has bookmarked within one scope
// (a channel or a DM thread), for reflecting toggled state in the message
// list without a per-message lookup.
export async function loadBookmarkedMessageIds(userId, { channelId, threadId }) {
  if (!userId) return new Set()
  const scope = channelId ? `channel="${channelId}"` : `thread="${threadId}"`
  try {
    const rows = await pb.collection('bookmarks').getFullList({
      filter: `user="${userId}" && ${scope}`,
      fields: 'message_id',
      requestKey: null,
    })
    return new Set(rows.map((r) => r.message_id))
  } catch (err) {
    console.error('Load bookmarks error:', err)
    return new Set()
  }
}

export async function toggleBookmark({ userId, messageId, channelId, threadId, content, authorName, sourceLabel }) {
  const existing = await pb.collection('bookmarks').getFirstListItem(
    `user="${userId}" && message_id="${messageId}"`,
    { requestKey: null }
  ).catch(() => null)

  if (existing) {
    await pb.collection('bookmarks').delete(existing.id, { requestKey: null })
    return false
  }

  await pb.collection('bookmarks').create({
    user: userId,
    message_id: messageId,
    channel: channelId || undefined,
    thread: threadId || undefined,
    content: content || '',
    author_name: authorName || '',
    source_label: sourceLabel || '',
  }, { requestKey: null })
  return true
}
