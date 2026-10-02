import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import pb from '../pocketbase'
import { resolveBanner } from '../profileUtils'

const BANNER_COLOUR_PRESETS = [
  '#5865F2', '#7C5CFC', '#EB459E', '#ED4245',
  '#FEE75C', '#57F287', '#3BA55D', '#1E1F22',
]

// Opened from MyAccountPopup's "Edit Profile" button. Edits the GLOBAL
// profile (users collection) — per-server profile editing is a separate,
// later piece.
//
// Props:
//   onClose - () => void
function ProfileEditor({ onClose }) {
  const me = pb.authStore.model
  const tier = me?.subscription_tier // undefined/free, 'plus', 'premium'
  const canUploadImage = tier === 'plus' || tier === 'premium'
  const canUploadGif = tier === 'premium'

  const [name, setName] = useState(me?.name || '')
  const [bio, setBio] = useState(me?.bio || '')
  const [bannerColour, setBannerColour] = useState(me?.banner_colour || BANNER_COLOUR_PRESETS[0])
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(
    me?.avatar ? pb.files.getURL(me, me.avatar, { thumb: '160x160' }) : null
  )
  const [bannerFile, setBannerFile] = useState(null)
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState(null)
  const [removeBannerImage, setRemoveBannerImage] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const avatarInputRef = useRef(null)
  const bannerInputRef = useRef(null)

  const bioCharsRemaining = 200 - bio.length

  const handleAvatarPick = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarPreviewUrl(URL.createObjectURL(file))
  }

  const handleBannerPick = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const isGif = file.type === 'image/gif'
    if (isGif && !canUploadGif) {
      setError('Animated banners are an Orbit Premium perk.')
      return
    }
    if (!isGif && !canUploadImage) {
      setError('Image banners are an Orbit+/Premium perk.')
      return
    }

    setError('')
    setBannerFile(file)
    setBannerPreviewUrl(URL.createObjectURL(file))
    setRemoveBannerImage(false)
  }

  const handleRemoveBannerImage = () => {
    setBannerFile(null)
    setBannerPreviewUrl(null)
    setRemoveBannerImage(true)
  }

  const handleSave = async () => {
    setError('')
    if (!name.trim()) {
      setError('Display name cannot be empty')
      return
    }

    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('name', name.trim())
      formData.append('bio', bio)
      formData.append('banner_colour', bannerColour)

      if (avatarFile) formData.append('avatar', avatarFile)

      if (bannerFile) {
        const isGif = bannerFile.type === 'image/gif'
        // Uploading a new one always replaces whichever tier field
        // previously held an image — never both at once.
        formData.append(isGif ? 'banner_premium' : 'banner_plus', bannerFile)
        formData.append(isGif ? 'banner_plus' : 'banner_premium', '')
      } else if (removeBannerImage) {
        formData.append('banner_plus', '')
        formData.append('banner_premium', '')
      }

      const updated = await pb.collection('users').update(me.id, formData)
      if (pb.authStore.model) {
        Object.assign(pb.authStore.model, updated)
      }
      onClose()
    } catch (err) {
      console.error('Save profile error:', err)
      setError(err.message || 'Something went wrong saving your profile')
    } finally {
      setSaving(false)
    }
  }

  // Live preview reflects whatever's currently staged (including unsaved
  // picks), not just what's on the server record yet.
  const previewRecordForBanner = {
    banner_colour: bannerColour,
    banner_plus: bannerFile && bannerFile.type !== 'image/gif' ? true : (removeBannerImage ? null : me?.banner_plus),
    banner_premium: bannerFile && bannerFile.type === 'image/gif' ? true : (removeBannerImage ? null : me?.banner_premium),
  }
  const previewBanner = bannerPreviewUrl
    ? { type: 'image', value: bannerPreviewUrl }
    : (removeBannerImage ? { type: 'colour', value: bannerColour } : resolveBanner({ ...me, banner_colour: bannerColour }))

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3000,
      }}
    >
      <div
        className="profile-editor-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '460px',
          maxWidth: '90vw',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--surface, #2b2d31)',
          borderRadius: '20px',
          position: 'relative',
        }}
      >
        <button className="modal-close-btn" onClick={onClose}>✕</button>

        <div className="profile-editor-preview-section">
          <div
            className="profile-editor-preview-banner"
            style={
              previewBanner.type === 'image'
                ? { backgroundImage: `url(${previewBanner.value})` }
                : previewBanner.type === 'colour'
                ? { backgroundColor: previewBanner.value }
                : undefined
            }
          />
          <div className="profile-editor-preview-avatar-wrap">
            {avatarPreviewUrl ? (
              <img src={avatarPreviewUrl} alt="" className="profile-editor-preview-avatar" />
            ) : (
              <div className="profile-editor-preview-avatar profile-editor-preview-avatar-fallback" />
            )}
          </div>
          <div className="profile-editor-preview-body">
            <div className="profile-editor-preview-name">{name || 'Unnamed'}</div>
            {me?.username && <div className="profile-editor-preview-username">{me.username}</div>}
            {bio && <div className="profile-editor-preview-bio">{bio}</div>}
          </div>
        </div>

        <div className="profile-editor-fields">
          <div className="profile-editor-field">
            <label>Avatar</label>
            <div className="profile-editor-file-row">
              <button type="button" onClick={() => avatarInputRef.current?.click()}>Upload Image</button>
              <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={handleAvatarPick} />
            </div>
          </div>

          <div className="profile-editor-field">
            <label>Banner</label>
            <div className="profile-editor-colour-swatches">
              {BANNER_COLOUR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`profile-editor-colour-swatch${bannerColour === c ? ' selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setBannerColour(c)}
                />
              ))}
              <input
                type="color"
                value={bannerColour}
                onChange={(e) => setBannerColour(e.target.value)}
                title="Custom colour"
              />
            </div>

            <div className="profile-editor-file-row">
              <button
                type="button"
                onClick={() => (canUploadImage ? bannerInputRef.current?.click() : setError('Image/gif banners are an Orbit+/Premium perk.'))}
              >
                {canUploadGif ? 'Upload Image or GIF' : canUploadImage ? 'Upload Image' : '🔒 Upload Image (Orbit+)'}
              </button>
              <input
                ref={bannerInputRef}
                type="file"
                accept={canUploadGif ? 'image/png,image/jpeg,image/gif' : 'image/png,image/jpeg'}
                hidden
                onChange={handleBannerPick}
              />
              {(bannerPreviewUrl || (!removeBannerImage && (me?.banner_plus || me?.banner_premium))) && (
                <button type="button" onClick={handleRemoveBannerImage}>Remove Image</button>
              )}
            </div>
            <p className="profile-editor-hint">
              An uploaded image/gif always replaces the colour above — only one or the other is shown.
            </p>
          </div>

          <div className="profile-editor-field">
            <label>Display Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          </div>

          <div className="profile-editor-field">
            <label>About Me</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 200))}
              rows={3}
              placeholder="Tell people about yourself"
            />
            <div className="profile-editor-char-count" style={{ color: bioCharsRemaining <= 20 ? 'var(--danger)' : 'var(--text)' }}>
              {bioCharsRemaining} characters remaining
            </div>
          </div>

          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

          <div className="profile-editor-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default ProfileEditor