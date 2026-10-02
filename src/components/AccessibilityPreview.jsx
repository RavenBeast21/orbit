// Live preview for the Accessibility settings page. It re-renders on every
// change (all values come from the page's state) and mimics the surfaces
// affected: message text size/spacing, link underlining, role/name colour
// display, density, high contrast, saturation, on/off indicators, and the
// styling of official messages.
import { t } from '../i18n'

function AccessibilityPreview({ settings }) {
  const {
    textSize = 16,
    underlineLinks = false,
    displayNameStyles = true,
    density = 'comfortable',
    messageDisplay = 'default',
    messageGroupSpacing = 0,
    saturation = 100,
    highContrast = false,
    roleColourDisplay = 'in_names',
    officialMessagesStyle = 'default',
    showOnOffIndicators = false,
    reducedMotion = false,
  } = settings || {}

  const roleColour = '#5865f2'
  const pad = density === 'compact' ? '2px 0' : density === 'spacious' ? '10px 0' : '6px 0'
  const gap = (messageDisplay === 'compact' ? 0 : 4) + messageGroupSpacing

  const nameStyle = roleColourDisplay === 'in_names' ? { color: roleColour } : undefined
  const nameStyleDecor = displayNameStyles
    ? { textShadow: '0 0 10px rgba(124,58,237,0.35)' }
    : undefined

  const officialClass = {
    default: 'a11y-official a11y-official-default',
    no_text_colour: 'a11y-official a11y-official-no-text',
    no_background: 'a11y-official a11y-official-no-bg',
    none: 'a11y-official a11y-official-none',
  }[officialMessagesStyle] || 'a11y-official a11y-official-default'

  const wrapperStyle = {
    fontSize: `${textSize}px`,
    filter: saturation < 100 ? `saturate(${saturation}%)` : undefined,
    borderColor: highContrast ? 'var(--text)' : undefined,
  }

  return (
    <div className="a11y-preview-card" data-high-contrast={highContrast ? 'true' : undefined} style={wrapperStyle}>
      <div className="a11y-preview-label">{t('a11y.preview')}</div>

      <div className="a11y-msg" style={{ padding: pad, marginBottom: `${gap}px` }}>
        <div className="a11y-avatar" />
        <div className="a11y-msg-body">
          <div className="a11y-msg-head">
            <span className="a11y-msg-name" style={{ ...nameStyle, ...nameStyleDecor }}>Ahmed</span>
            {roleColourDisplay === 'next_to_names' && <span className="a11y-role-pill">Moderator</span>}
            <span className="a11y-msg-time">Today at 14:02</span>
          </div>
          <div className="a11y-msg-text">What happened to all the beans?</div>
          <div className="a11y-reactions">
            <span className="a11y-reaction a11y-reaction-mine">👍 3</span>
            <span className="a11y-reaction">🔥 1</span>
          </div>
        </div>
      </div>

      <div className="a11y-msg" style={{ padding: pad }}>
        <div className="a11y-avatar" />
        <div className="a11y-msg-body">
          <div className="a11y-msg-head">
            <span className="a11y-msg-name" style={{ ...nameStyle, ...nameStyleDecor }}>Ahmed</span>
            {roleColourDisplay === 'next_to_names' && <span className="a11y-role-pill">Moderator</span>}
            <span className="a11y-msg-time">Today at 14:02</span>
          </div>
          <div className="a11y-msg-text">
            here's a link{' '}
            <a
              href="#preview"
              onClick={(e) => e.preventDefault()}
              style={underlineLinks ? { textDecoration: 'underline' } : { textDecoration: 'none' }}
            >
              https://orbit.example/accessibility
            </a>
          </div>
          <button className="a11y-example-btn" type="button">Example Button</button>
        </div>
      </div>

      {officialMessagesStyle !== 'none' && (
        <div className={officialClass}>
          <strong>Official Message.</strong> This is how a verified developer announcement looks.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', color: 'var(--text)', fontSize: '0.85em' }}>
        <span>On/off indicators</span>
        <span
          style={{
            width: '34px', height: '20px', borderRadius: '999px',
            background: showOnOffIndicators ? 'var(--accent)' : 'var(--surface-2)',
            border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center',
            justifyContent: showOnOffIndicators ? 'flex-end' : 'flex-start', padding: '0 2px',
            transition: reducedMotion ? 'none' : 'all .15s',
          }}
        >
          <span style={{
            width: '16px', height: '16px', borderRadius: '50%',
            background: showOnOffIndicators ? '#fff' : 'var(--text)', opacity: showOnOffIndicators ? 1 : 0.6,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', color: showOnOffIndicators ? 'var(--accent)' : 'var(--surface)',
          }}>
            {showOnOffIndicators ? '✓' : '✕'}
          </span>
        </span>
      </div>
    </div>
  )
}

export default AccessibilityPreview
