import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import pb from '../pocketbase'
import { EMOJI_CATEGORIES } from '../emojiData'
import { useFavoriteEmojis, toggleFavoriteEmoji, isFavoriteEmoji } from '../favoriteEmojis'

const PICKER_WIDTH = 340
const PICKER_MAX_HEIGHT = 380

// Emoji picker used by both the composer and message reactions.
//
// Positioning: pass `anchorRect` (the getBoundingClientRect() of the button
// that opened it) and the picker renders into a portal, fixed above that
// button (or below it if there isn't room above). Without an anchor it falls
// back to absolute positioning inside its parent.
function EmojiPicker({ currentUserId, onSelect, onClose, initialSearch, anchorRect }) {
  const [search, setSearch] = useState(initialSearch || '')
  const [serverEmojis, setServerEmojis] = useState([])
  const [loading, setLoading] = useState(true)
  const containerRef = useRef(null)
  const favorites = useFavoriteEmojis()
  const serverEmojiById = {}
  serverEmojis.forEach((em) => { serverEmojiById[em.id] = em })

  useEffect(() => {
    if (initialSearch !== undefined) setSearch(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    const load = async () => {
      try {
        const myMemberships = await pb.collection('members').getFullList({
          filter: `user="${currentUserId}"`,
          requestKey: null,
        })
        const serverIds = myMemberships.map((m) => m.server)
        if (serverIds.length === 0) {
          setServerEmojis([])
          return
        }
        const filter = serverIds.map((id) => `server="${id}"`).join(' || ')
        const emojis = await pb.collection('emojis').getFullList({
          filter,
          expand: 'server',
          sort: 'name',
          requestKey: null,
        })
        setServerEmojis(emojis)
      } catch (err) {
        console.error('Load emoji picker data error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentUserId])

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose()
      }
    }
    const handleEscape = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const searchLower = search.trim().toLowerCase()
  const filteredServerEmojis = searchLower
    ? serverEmojis.filter((em) => em.name.toLowerCase().includes(searchLower))
    : serverEmojis

  const categories = EMOJI_CATEGORIES.map((cat) => ({
    name: cat.name,
    emojis: searchLower
      ? cat.emojis.filter(([, kw]) => kw.includes(searchLower))
      : cat.emojis,
  })).filter((cat) => cat.emojis.length > 0)

  const renderFavourite = (fav) => {
    const tokenMatch = /^:[^:\s]+:([a-zA-Z0-9]{15}):$/.exec(fav)
    if (tokenMatch && serverEmojiById[tokenMatch[1]]) {
      const em = serverEmojiById[tokenMatch[1]]
      return (
        <img
          src={pb.files.getURL(em, em.image, { thumb: '24x24' })}
          alt={em.name}
          style={{ width: '22px', height: '22px', objectFit: 'contain' }}
        />
      )
    }
    return fav
  }

  // Position: above the anchor when there's room, otherwise below.
  let style = {
    position: 'fixed',
    left: 8,
    zIndex: 2000,
    width: `${PICKER_WIDTH}px`,
    maxHeight: `${PICKER_MAX_HEIGHT}px`,
  }
  if (anchorRect) {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200
    const h = typeof window !== 'undefined' ? window.innerHeight : 800
    const left = Math.min(Math.max(8, anchorRect.right - PICKER_WIDTH), w - PICKER_WIDTH - 8)
    const placeAbove = anchorRect.top > PICKER_MAX_HEIGHT + 12
    style = {
      ...style,
      left,
      ...(placeAbove
        ? { bottom: `${h - anchorRect.top + 8}px` }
        : { top: `${anchorRect.bottom + 8}px` }),
    }
  } else {
    style = { ...style, position: 'absolute', left: 0, bottom: '100%', marginBottom: '6px' }
  }

  const picker = (
    <div ref={containerRef} className="emoji-picker" style={style}>
      <input
        type="text"
        className="emoji-picker-search"
        placeholder="Search emoji..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />

      <div className="emoji-picker-scroll">
        {favorites.length > 0 && (
          <div className="emoji-picker-section">
            <div className="emoji-picker-section-label">Favourites</div>
            <div className="emoji-picker-grid">
              {favorites.map((fav) => (
                <button
                  key={'fav-' + fav}
                  type="button"
                  className="emoji-picker-cell emoji-picker-cell-favourite"
                  onClick={() => onSelect(fav)}
                  onContextMenu={(e) => { e.preventDefault(); toggleFavoriteEmoji(fav) }}
                  title="Right-click to remove from favourites"
                >
                  {renderFavourite(fav)}
                </button>
              ))}
            </div>
          </div>
        )}

        {filteredServerEmojis.length > 0 && (
          <div className="emoji-picker-section">
            <div className="emoji-picker-section-label">Server Emojis</div>
            <div className="emoji-picker-grid">
              {filteredServerEmojis.map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  className={`emoji-picker-cell${isFavoriteEmoji(`:${emoji.name}:${emoji.id}:`) ? ' emoji-picker-cell-favourite' : ''}`}
                  onClick={() => onSelect(`:${emoji.name}:${emoji.id}:`)}
                  onContextMenu={(e) => { e.preventDefault(); toggleFavoriteEmoji(`:${emoji.name}:${emoji.id}:`) }}
                  title={`:${emoji.name}: — from ${emoji.expand?.server?.name || 'a server'} (right-click to favourite)`}
                >
                  <img
                    src={pb.files.getURL(emoji, emoji.image, { thumb: '32x32' })}
                    alt={emoji.name}
                    style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {categories.map((cat) => (
          <div key={cat.name} className="emoji-picker-section">
            <div className="emoji-picker-section-label">{cat.name}</div>
            <div className="emoji-picker-grid">
              {cat.emojis.map(([char, kw]) => (
                <button
                  key={char + kw}
                  type="button"
                  className={`emoji-picker-cell${isFavoriteEmoji(char) ? ' emoji-picker-cell-favourite' : ''}`}
                  onClick={() => onSelect(char)}
                  onContextMenu={(e) => { e.preventDefault(); toggleFavoriteEmoji(char) }}
                  title={`${kw} (right-click to favourite)`}
                >
                  {char}
                </button>
              ))}
            </div>
          </div>
        ))}

        {loading && <p className="emoji-picker-empty">Loading server emojis...</p>}
        {!loading && filteredServerEmojis.length === 0 && categories.length === 0 && (
          <p className="emoji-picker-empty">No emoji found.</p>
        )}
      </div>
    </div>
  )

  const canPortal = typeof document !== 'undefined'
  return canPortal ? createPortal(picker, document.body) : picker
}

// Shared render helper — turns :name:id: tokens into <img> tags, leaves
// everything else (including plain unicode emoji) untouched.
export function renderMessageContent(content, emojiCache) {
  if (!content) return content

  const tokenPattern = /:[^:\s]+:([a-zA-Z0-9]{15}):/g
  const parts = []
  let lastIndex = 0
  let match

  while ((match = tokenPattern.exec(content)) !== null) {
    const emojiId = match[1]
    const emoji = emojiCache[emojiId]

    if (emoji) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index))
      }
      parts.push(
        <img
          key={match.index}
          src={pb.files.getURL(emoji, emoji.image, { thumb: '24x24' })}
          alt={`:${emoji.name}:`}
          title={`:${emoji.name}:`}
          style={{ width: '20px', height: '20px', objectFit: 'contain', verticalAlign: 'middle' }}
        />
      )
      lastIndex = tokenPattern.lastIndex
    }
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length > 0 ? parts : content
}

export default EmojiPicker
