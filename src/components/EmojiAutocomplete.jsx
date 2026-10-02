import { useEffect, useState } from 'react'
import pb from '../pocketbase'
import { EMOJI_CATEGORIES } from '../emojiData'

// Standard emojis with a searchable name (derived from the first keyword).
const STANDARD_EMOJIS = EMOJI_CATEGORIES.flatMap((c) => c.emojis).map(([char, keywords]) => ({
  char,
  name: keywords.split(' ')[0],
  keywords,
}))

// Inline ":" autocomplete list shown above the composer while typing :query.
// Standard emojis come first (available to everyone); custom server emojis
// follow, each labelled with the server it belongs to. Scrollable.
function EmojiAutocomplete({ query, currentUserId, onSelect, onFirstMatch, maxResults = 8 }) {
  const [custom, setCustom] = useState([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const memberships = await pb.collection('members').getFullList({
          filter: `user="${currentUserId}"`,
          requestKey: null,
        })
        const ids = memberships.map((m) => m.server)
        if (ids.length === 0) {
          if (!cancelled) setCustom([])
          return
        }
        const filter = ids.map((id) => `server="${id}"`).join(' || ')
        const rows = await pb.collection('emojis').getFullList({
          filter,
          expand: 'server',
          sort: 'name',
          requestKey: null,
        })
        if (!cancelled) setCustom(rows)
      } catch (err) {
        console.error('Load emoji autocomplete error:', err)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentUserId])

  const q = (query || '').toLowerCase()
  const stdMatches = q ? STANDARD_EMOJIS.filter((e) => e.keywords.includes(q)).slice(0, maxResults) : []
  const customMatches = q ? custom.filter((e) => e.name.toLowerCase().includes(q)).slice(0, maxResults) : []

  const firstValue = stdMatches[0]
    ? stdMatches[0].char
    : (customMatches[0] ? `:${customMatches[0].name}:${customMatches[0].id}:` : null)

  useEffect(() => {
    if (onFirstMatch) onFirstMatch(firstValue)
    return () => { if (onFirstMatch) onFirstMatch(null) }
  }, [firstValue, onFirstMatch])

  if (!q || (stdMatches.length === 0 && customMatches.length === 0)) return null

  return (
    <div className="emoji-autocomplete">
      <div className="emoji-autocomplete-header">EMOJI MATCHING :{query.toUpperCase()}</div>
      <div className="emoji-autocomplete-list">
        {stdMatches.map((e) => (
          <button
            key={e.char + e.name}
            type="button"
            className="emoji-autocomplete-row"
            onClick={() => onSelect(e.char)}
          >
            <span className="emoji-autocomplete-emoji">{e.char}</span>
            <span className="emoji-autocomplete-name">:{e.name}:</span>
          </button>
        ))}
        {customMatches.map((e) => (
          <button
            key={e.id}
            type="button"
            className="emoji-autocomplete-row"
            onClick={() => onSelect(`:${e.name}:${e.id}:`)}
          >
            <img
              className="emoji-autocomplete-emoji"
              src={pb.files.getURL(e, e.image, { thumb: '24x24' })}
              alt={e.name}
            />
            <span className="emoji-autocomplete-name">:{e.name}:</span>
            <span className="emoji-autocomplete-server">{e.expand?.server?.name || ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default EmojiAutocomplete
