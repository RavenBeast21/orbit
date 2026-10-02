import { renderMessageContent } from './EmojiPicker'
import { useFavoriteEmojis } from '../favoriteEmojis'

// The user's favourite emojis, shown as quick-reactions while Shift is held
// over a message. Up to 5 (enforced by the favourites store).
function QuickReactions({ onSelect, emojiCache = {} }) {
  const favorites = useFavoriteEmojis()
  if (favorites.length === 0) return null

  return (
    <div className="quick-reactions">
      {favorites.map((fav) => (
        <button
          key={fav}
          type="button"
          className="quick-reaction-btn"
          onClick={() => onSelect(fav)}
          title="React"
        >
          {renderMessageContent(fav, emojiCache)}
        </button>
      ))}
    </div>
  )
}

export default QuickReactions
