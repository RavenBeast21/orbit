import { useEffect, useMemo, useRef, useState } from 'react'
import { TAG_GROUPS, MAX_SERVER_TAGS, SERVER_TAG_MAP, tagMatchesQuery } from '../serverTags'

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

// Grouped, searchable multi-select tag picker shared by CreateServer and the
// server owner's settings. Inline (never a modal), because it is a form field.
function TagPicker({ value = [], onChange, max = MAX_SERVER_TAGS, idPrefix = 'tagpick' }) {
  const [query, setQuery] = useState('')
  const [expandedSubs, setExpandedSubs] = useState({})
  const [limitHint, setLimitHint] = useState(false)
  const hintTimer = useRef(null)

  const selected = Array.isArray(value) ? value : []
  const atMax = selected.length >= max
  const searchRef = useRef(null)

  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current) }, [])

  const toggle = (id) => {
    if (selected.includes(id)) {
      setLimitHint(false)
      onChange(selected.filter((x) => x !== id))
      return
    }
    if (atMax) {
      setLimitHint(true)
      if (hintTimer.current) clearTimeout(hintTimer.current)
      hintTimer.current = setTimeout(() => setLimitHint(false), 4000)
      return
    }
    onChange([...selected, id])
  }

  const { groups, matchCount, firstMatchId } = useMemo(() => {
    const built = TAG_GROUPS.map((group) => {
      const tags = group.tags.filter((tag) => tagMatchesQuery(tag, query))
      const subgroups = (group.subgroups || [])
        .map((sub) => ({ ...sub, tags: sub.tags.filter((tag) => tagMatchesQuery(tag, query)) }))
        .filter((sub) => sub.tags.length > 0)
      return { ...group, tags, subgroups }
    }).filter((group) => group.tags.length > 0 || group.subgroups.length > 0)

    const flat = built.flatMap((group) => [
      ...group.tags,
      ...group.subgroups.flatMap((sub) => sub.tags),
    ])
    return { groups: built, matchCount: flat.length, firstMatchId: flat[0]?.id || null }
  }, [query])

  const onSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (firstMatchId) toggle(firstMatchId)
    } else if (e.key === 'Escape') {
      if (query) setQuery('')
      else e.currentTarget.blur()
    }
  }

  const renderChip = (tag) => {
    const isSelected = selected.includes(tag.id)
    const disabled = !isSelected && atMax
    return (
      <button
        key={tag.id}
        type="button"
        id={`${idPrefix}-${tag.id}`}
        className="tag-chip"
        aria-pressed={isSelected}
        aria-disabled={disabled || undefined}
        onClick={() => toggle(tag.id)}
      >
        {isSelected && <span className="tag-chip-check"><IconCheck /></span>}
        <span className="tag-chip-label">{tag.label}</span>
      </button>
    )
  }

  return (
    <div className="tag-picker" role="group" aria-labelledby={`${idPrefix}-label`}>
      <div className="tag-picker-head">
        <span className="tag-picker-label" id={`${idPrefix}-label`}>Tags</span>
        <span className={`tag-picker-count${atMax ? ' tag-picker-count--max' : ''}`}>
          {selected.length} / {max}
        </span>
      </div>
      <p className="tag-picker-hintline">Help people find this server. Pick up to {max}.</p>

      <div className="tag-picker-selected">
        {selected.length === 0 && <span className="tag-picker-placeholder">No tags selected</span>}
        {selected.map((id) => (
          <button
            key={id}
            type="button"
            className="tag-chip tag-chip--selected"
            onClick={() => toggle(id)}
            aria-label={`Remove ${SERVER_TAG_MAP[id]?.label || id}`}
          >
            <span className="tag-chip-label">{SERVER_TAG_MAP[id]?.label || id}</span>
            <span className="tag-chip-x"><IconX /></span>
          </button>
        ))}
      </div>

      <div className="tag-picker-search">
        <IconSearch />
        <input
          ref={searchRef}
          type="text"
          value={query}
          placeholder="Search tags (e.g. fps, anime, study)"
          aria-label="Search tags"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          autoComplete="off"
        />
        {query && (
          <button type="button" className="tag-picker-clear" aria-label="Clear tag search" onClick={() => setQuery('')}>
            <IconX />
          </button>
        )}
      </div>

      <div className="tag-picker-list">
        {matchCount === 0 && (
          <div className="tag-picker-empty">
            <div className="tag-picker-empty-title">No tags match “{query}”</div>
            <div>Try a shorter word.</div>
          </div>
        )}

        {groups.map((group) => (
          <div className="tag-picker-group" key={group.id} role="group" aria-label={group.label}>
            <div className="tag-picker-group-title">{group.label}</div>
            {group.tags.length > 0 && (
              <div className="tag-picker-group-chips">{group.tags.map((tag) => renderChip(tag))}</div>
            )}
            {group.subgroups.map((sub) => {
              const open = expandedSubs[sub.id] || !!query
                || sub.tags.some((tag) => selected.includes(tag.id))
              return (
                <div className="tag-picker-subgroup" key={sub.id}>
                  <button
                    type="button"
                    className={`tag-picker-subgroup-toggle${open ? ' is-open' : ''}`}
                    aria-expanded={open}
                    onClick={() => setExpandedSubs((prev) => ({ ...prev, [sub.id]: !prev[sub.id] }))}
                  >
                    <span className="tag-picker-chevron"><IconChevron /></span>
                    {sub.label} · {sub.tags.length}
                  </button>
                  {open && (
                    <div className="tag-picker-group-chips">{sub.tags.map((tag) => renderChip(tag))}</div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {limitHint && (
        <p className="tag-picker-limit" role="status">
          You can pick up to {max} tags. Remove one to add another.
        </p>
      )}
      <span className="sr-only" aria-live="polite">
        {selected.length} of {max} tags selected.
      </span>
    </div>
  )
}

export default TagPicker
