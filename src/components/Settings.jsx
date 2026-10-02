// Settings.jsx
import { useState, useEffect, useRef } from 'react'
import pb from '../pocketbase'
import { resetKeypair } from '../crypto'
import { preloadNsfwModel } from '../nsfwScan'
import { formatDateTime } from '../formatting'
import BadgeShowcase from './BadgeShowcase'
import AccessibilityPreview from './AccessibilityPreview'
import { useI18n } from '../i18n'
import { ServerBoostsInfo, SubscriptionsInfo, GiftInventoryInfo, BillingInfo } from './PlansInfo'

const LOCALES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Español' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'pl-PL', label: 'Polski' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'tr-TR', label: 'Türkçe' },
  { value: 'ar-SA', label: 'العربية' },
  { value: 'hi-IN', label: 'हिन्दी' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'zh-CN', label: '简体中文' },
]

// Small, shared building blocks so every sub-setting looks the same instead
// of each section hand-rolling its own inline styles.
function SettingsSection({ title, description, children }) {
  return (
    <section className="settings-section">
      {title && <h3 className="settings-section-title">{title}</h3>}
      {description && <p className="settings-section-desc">{description}</p>}
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

function SettingToggle({ label, description, checked, disabled, onChange }) {
  return (
    <label className={`settings-row${disabled ? ' is-disabled' : ''}`}>
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </span>
      <span className="settings-row-control">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      </span>
    </label>
  )
}

function SettingRadio({ name, value, current, label, description, disabled, onChange }) {
  return (
    <label className={`settings-row settings-row-radio${disabled ? ' is-disabled' : ''}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </span>
    </label>
  )
}

function SettingSlider({ label, description, value, min, max, step = 1, ticks = [], unit = '', disabled, onChange }) {
  return (
    <div className="settings-slider-row">
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {ticks.length > 0 && (
        <div className="settings-slider-ticks">
          {ticks.map((tick) => (
            <button
              key={tick}
              type="button"
              className={`settings-slider-tick${tick === value ? ' active' : ''}`}
              disabled={disabled}
              onClick={() => onChange(tick)}
            >
              {tick}{unit}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SettingField({ label, description, children }) {
  return (
    <div className="settings-row settings-row-field">
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </span>
      <span className="settings-row-control settings-row-control-wide">{children}</span>
    </div>
  )
}

function Settings({ onBack, onOpenBilling, onBoostServer, onLogout }) {
  const { t } = useI18n()
  const user = pb.authStore.model
  const avatarUrl = user.avatar
    ? pb.files.getURL(user, user.avatar, { thumb: '100x100' })
    : null

  // Two-level nav: `section` is the top-level page (account, data-privacy,
  // messaging-permissions, notifications, voice, appearance, accessibility,
  // system, language, games, activity-privacy, apps, orbit-plus,
  // server-boosts, subscriptions, gifts, billing), `accountTab` is which
  // sub-page within Account is showing.
  const [section, setSection] = useState('account')
  const [accountTab, setAccountTab] = useState('info') // 'info' | 'security' | 'standing' | 'danger' — now just drives which sidebar item is highlighted, not which content renders (Account is one continuous scroll)

  const accountScrollRef = useRef(null)
  const accountInfoRef = useRef(null)
  const accountSecurityRef = useRef(null)
  const accountStandingRef = useRef(null)
  const accountDangerRef = useRef(null)

  // Scroll-spy: whichever section's top is closest to (but not past) the
  // top of the scroll container is the "active" one for sidebar
  // highlighting — matches Discord's account settings behaviour of one
  // continuous page with a nav that tracks scroll position.
  const handleAccountScroll = () => {
    const container = accountScrollRef.current
    if (!container) return

    const containerTop = container.getBoundingClientRect().top
    const sections = [
      { key: 'info', ref: accountInfoRef },
      { key: 'security', ref: accountSecurityRef },
      { key: 'standing', ref: accountStandingRef },
      { key: 'danger', ref: accountDangerRef },
    ]

    let current = sections[0].key
    for (const s of sections) {
      if (!s.ref.current) continue
      const top = s.ref.current.getBoundingClientRect().top
      // A section counts as "reached" once its top has scrolled to within
      // 40px of the container's top edge.
      if (top - containerTop < 40) {
        current = s.key
      }
    }
    setAccountTab((prev) => (prev === current ? prev : current))
  }

  const scrollToAccountSection = (key) => {
    setAccountTab(key)
    const refs = {
      info: accountInfoRef,
      security: accountSecurityRef,
      standing: accountStandingRef,
      danger: accountDangerRef,
    }
    refs[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [dataPrivacyTab, setDataPrivacyTab] = useState('usage') // 'usage' | 'profile' | 'encryption'
  const dataPrivacyScrollRef = useRef(null)
  const dataPrivacyUsageRef = useRef(null)
  const dataPrivacyProfileRef = useRef(null)
  const dataPrivacyEncryptionRef = useRef(null)

  const handleDataPrivacyScroll = () => {
    const container = dataPrivacyScrollRef.current
    if (!container) return

    const containerTop = container.getBoundingClientRect().top
    const sections = [
      { key: 'usage', ref: dataPrivacyUsageRef },
      { key: 'profile', ref: dataPrivacyProfileRef },
      { key: 'encryption', ref: dataPrivacyEncryptionRef },
    ]

    let current = sections[0].key
    for (const s of sections) {
      if (!s.ref.current) continue
      const top = s.ref.current.getBoundingClientRect().top
      if (top - containerTop < 40) current = s.key
    }
    setDataPrivacyTab((prev) => (prev === current ? prev : current))
  }

  const scrollToDataPrivacySection = (key) => {
    setDataPrivacyTab(key)
    const refs = {
      usage: dataPrivacyUsageRef,
      profile: dataPrivacyProfileRef,
      encryption: dataPrivacyEncryptionRef,
    }
    refs[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [msgPermTab, setMsgPermTab] = useState('content-filters')
  const msgPermScrollRef = useRef(null)
  const msgPermContentFiltersRef = useRef(null)
  const msgPermSpamFiltersRef = useRef(null)
  const msgPermDirectMessagesRef = useRef(null)
  const msgPermFriendRequestsRef = useRef(null)
  const msgPermIgnoreBlockRef = useRef(null)

  const handleMsgPermScroll = () => {
    const container = msgPermScrollRef.current
    if (!container) return

    const containerTop = container.getBoundingClientRect().top
    const sections = [
      { key: 'content-filters', ref: msgPermContentFiltersRef },
      { key: 'spam-filters', ref: msgPermSpamFiltersRef },
      { key: 'direct-messages', ref: msgPermDirectMessagesRef },
      { key: 'friend-requests', ref: msgPermFriendRequestsRef },
      { key: 'ignore-block', ref: msgPermIgnoreBlockRef },
    ]

    let current = sections[0].key
    for (const s of sections) {
      if (!s.ref.current) continue
      const top = s.ref.current.getBoundingClientRect().top
      if (top - containerTop < 40) current = s.key
    }
    setMsgPermTab((prev) => (prev === current ? prev : current))
  }

  const scrollToMsgPermSection = (key) => {
    setMsgPermTab(key)
    const refs = {
      'content-filters': msgPermContentFiltersRef,
      'spam-filters': msgPermSpamFiltersRef,
      'direct-messages': msgPermDirectMessagesRef,
      'friend-requests': msgPermFriendRequestsRef,
      'ignore-block': msgPermIgnoreBlockRef,
    }
    refs[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [usernameSaving, setUsernameSaving] = useState(false)

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState('')
  const [nameSaving, setNameSaving] = useState(false)

  const [editingEmail, setEditingEmail] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailPasswordConfirm, setEmailPasswordConfirm] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailSuccess, setEmailSuccess] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailRevealed, setEmailRevealed] = useState(false)

  const [editingPassword, setEditingPassword] = useState(false)
  const [currentPasswordInput, setCurrentPasswordInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [newPasswordConfirmInput, setNewPasswordConfirmInput] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [showResetKeyConfirm, setShowResetKeyConfirm] = useState(false)
  const [resetKeyConfirmInput, setResetKeyConfirmInput] = useState('')
  const [resetKeyError, setResetKeyError] = useState('')
  const [resetKeySuccess, setResetKeySuccess] = useState('')
  const [resettingKey, setResettingKey] = useState(false)

  const [microphones, setMicrophones] = useState([])
  const [cameras, setCameras] = useState([])
  const [selectedMicId, setSelectedMicId] = useState(localStorage.getItem('orbit_mic_id') || '')
  const [selectedCameraId, setSelectedCameraId] = useState(localStorage.getItem('orbit_camera_id') || '')
  const [deviceError, setDeviceError] = useState('')

  // Voice-note send/receive preference (report §4.46). The web client has no
  // voice-message UI; this is the account-level contract the mobile client
  // reads, so it is exposed here for both.
  const [voiceNotesSend, setVoiceNotesSend] = useState(user.voice_notes_send ?? true)
  const [voiceNotesReceive, setVoiceNotesReceive] = useState(user.voice_notes_receive ?? true)
  const [voicePrefSaving, setVoicePrefSaving] = useState(false)

  const [disabling, setDisabling] = useState(false)
  const [disableError, setDisableError] = useState('')

  const [notifMessageSound, setNotifMessageSound] = useState(user.notif_message_sound ?? true)
  const [notifFriendsOnline, setNotifFriendsOnline] = useState(user.notif_friends_online ?? true)
  const [notifSaving, setNotifSaving] = useState(false)
  // Presence and notification behaviour are separate (report §4.10):
  // status controls how you appear; this controls what your device does.
  const [notificationMode, setNotificationMode] = useState(user.notification_mode || 'normal')

  const [textSize, setTextSize] = useState(user.accessibility_text_size || 16)
  const [reducedMotion, setReducedMotion] = useState(user.accessibility_reduced_motion ?? false)
  const [accessibilitySaving, setAccessibilitySaving] = useState(false)
  const [alwaysUnderlineLinks, setAlwaysUnderlineLinks] = useState(user.always_underline_links ?? false)
  const [displayNameStyles, setDisplayNameStyles] = useState(user.display_name_styles ?? true)
  const [messageDisplay, setMessageDisplay] = useState(user.message_display || 'default')
  const [messageGroupSpacing, setMessageGroupSpacing] = useState(user.message_group_spacing ?? 0)
  const [zoomLevel, setZoomLevel] = useState(user.zoom_level ?? 100)
  const [saturation, setSaturation] = useState(user.saturation ?? 100)
  const [saturationCustomColours, setSaturationCustomColours] = useState(user.saturation_custom_colours ?? false)
  const [highContrast, setHighContrast] = useState(user.high_contrast ?? false)
  const [roleColourDisplay, setRoleColourDisplay] = useState(user.role_colour_display || 'in_names')
  const [officialMessagesStyle, setOfficialMessagesStyle] = useState(user.official_messages_style || 'default')
  const [showOnOffIndicators, setShowOnOffIndicators] = useState(user.show_on_off_indicators ?? false)

  const [uiDensity, setUiDensity] = useState(user.ui_density === 'compact' ? 'compact' : 'comfortable')
  const [asciiEmoticons, setAsciiEmoticons] = useState(user.ascii_emoticons ?? false)
  const [hideSubscriptionBadge, setHideSubscriptionBadge] = useState(user.hide_subscription_badge ?? false)
  const [appearanceSaving, setAppearanceSaving] = useState(false)

  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')

  const [dataUseImprove, setDataUseImprove] = useState(user.data_use_improve ?? true)
  const [dataUsePersonalize, setDataUsePersonalize] = useState(user.data_use_personalize ?? true)
  const [dataPrivacySaving, setDataPrivacySaving] = useState(false)
  const [requestingData, setRequestingData] = useState(false)
  const [requestDataError, setRequestDataError] = useState('')

  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState(null)
  const importFileInputRef = useRef(null)

  const [profilePrivacy, setProfilePrivacy] = useState(user.profile_privacy || 'all_servers')
  const [profileShareUpdates, setProfileShareUpdates] = useState(user.profile_share_updates ?? false)
  const [profilePrivacyFriendIds, setProfilePrivacyFriendIds] = useState(user.profile_privacy_friends || [])
  const [profilePrivacySaving, setProfilePrivacySaving] = useState(false)
  // Sender-side status broadcast (report §4.9) — opt-in, default off.
  const [statusBroadcast, setStatusBroadcast] = useState(user.status_broadcast ?? false)
  const [statusAudience, setStatusAudience] = useState(user.status_broadcast_audience || 'friends')
  // Mutual-server visibility (report §4.22).
  const [mutualServersVisibility, setMutualServersVisibility] = useState(user.mutual_servers_visibility || 'everyone')

  // Language & Time
  const [locale, setLocale] = useState(user.locale || 'system')
  const [timeFormat, setTimeFormat] = useState(user.time_format || 'auto')
  const [dateFormat, setDateFormat] = useState(user.date_format || 'auto')
  const [languageSaving, setLanguageSaving] = useState(false)

  // System
  const [desktopNotifications, setDesktopNotifications] = useState(user.desktop_notifications ?? false)
  const [hardwareAcceleration, setHardwareAcceleration] = useState(user.hardware_acceleration ?? true)
  const [startMinimized, setStartMinimized] = useState(user.start_minimized ?? false)
  const [systemSaving, setSystemSaving] = useState(false)
  const [systemNotice, setSystemNotice] = useState('')

  // Activity
  const [showActivity, setShowActivity] = useState(user.show_activity ?? false)
  const [activityVisibility, setActivityVisibility] = useState(user.activity_visibility || 'everyone')
  const [customActivity, setCustomActivity] = useState(user.custom_activity || '')
  const [customActivitySaved, setCustomActivitySaved] = useState(user.custom_activity || '')
  const [activitySaving, setActivitySaving] = useState(false)

  // Connected Apps
  const [connectedAccounts, setConnectedAccounts] = useState([])
  const [connectedLoaded, setConnectedLoaded] = useState(false)
  const [disconnectingId, setDisconnectingId] = useState(null)
  const [friendsList, setFriendsList] = useState([])
  const [friendsLoaded, setFriendsLoaded] = useState(false)

  const [dmPrivacy, setDmPrivacy] = useState(user.dm_privacy || 'request_to_dm')
  const [dmPrivacySaving, setDmPrivacySaving] = useState(false)

  const [friendRequestPrivacy, setFriendRequestPrivacy] = useState(user.friend_request_privacy || 'everyone')
  const [friendRequestPrivacySaving, setFriendRequestPrivacySaving] = useState(false)

  const [blockedUsers, setBlockedUsers] = useState([])
  const [blockedUsersLoaded, setBlockedUsersLoaded] = useState(false)
  const [unblockingId, setUnblockingId] = useState(null)

  const [contentFilterMedia, setContentFilterMedia] = useState(user.content_filter_media || 'show_all')
  const [contentFilterNsfwScan, setContentFilterNsfwScan] = useState(user.content_filter_nsfw_scan ?? false)
  const [contentFilterSaving, setContentFilterSaving] = useState(false)

  const [spamFilterBlockLinks, setSpamFilterBlockLinks] = useState(user.spam_filter_block_links ?? false)
  const [spamFilterRateLimit, setSpamFilterRateLimit] = useState(user.spam_filter_rate_limit ?? false)
  const [spamFilterKeywords, setSpamFilterKeywords] = useState(user.spam_filter_keywords || '')
  const [spamFilterKeywordsSaved, setSpamFilterKeywordsSaved] = useState(user.spam_filter_keywords || '')
  const [spamFilterSaving, setSpamFilterSaving] = useState(false)

  // Orbit+/Premium perks — enforced server-side in pb_hooks/perk_settings.pb.js
  const myTier = user.subscription_tier || 'none'
  const hasPlan = myTier === 'plus' || myTier === 'premium'
  const isPremium = myTier === 'premium'

  const [backgroundUploading, setBackgroundUploading] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')

  const [soundUploading, setSoundUploading] = useState(false)
  const [soundError, setSoundError] = useState('')

  const [currentTheme, setCurrentTheme] = useState(user.theme === 'light' ? 'light' : 'dark')
  const [themeSaving, setThemeSaving] = useState(false)

  const handleThemeChange = async (newTheme) => {
    setCurrentTheme(newTheme) // instant feedback, don't wait on the network
    setThemeSaving(true)
    try {
      await pb.collection('users').update(user.id, { theme: newTheme })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Theme update error:', err)
      setCurrentTheme(user.theme === 'light' ? 'light' : 'dark') // revert on failure
    } finally {
      setThemeSaving(false)
    }
  }

  const [mfaEnabled, setMfaEnabled] = useState(user.mfa_enabled ?? false)
  const [mfaPasswordConfirm, setMfaPasswordConfirm] = useState('')
  const [mfaError, setMfaError] = useState('')
  const [mfaSuccess, setMfaSuccess] = useState('')
  const [mfaSaving, setMfaSaving] = useState(false)
  const [showMfaConfirm, setShowMfaConfirm] = useState(false)

  const handleToggleMfa = async () => {
    setMfaError('')
    setMfaSuccess('')

    if (!mfaPasswordConfirm) {
      setMfaError('Enter your current password to confirm this change')
      return
    }

    setMfaSaving(true)
    try {
      await pb.collection('users').authWithPassword(user.username, mfaPasswordConfirm)

      const newValue = !mfaEnabled
      await pb.collection('users').update(user.id, { mfa_enabled: newValue })
      await pb.collection('users').authRefresh()

      setMfaEnabled(newValue)
      setMfaSuccess(newValue ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled')
      setMfaPasswordConfirm('')
      setShowMfaConfirm(false)
    } catch (err) {
      console.error('MFA toggle error:', err)
      if (err.status === 400) {
        setMfaError('Incorrect password')
      } else {
        setMfaError(err.message || 'Something went wrong updating two-factor authentication')
      }
    } finally {
      setMfaSaving(false)
    }
  }

  const handleAvatarUpload = async (e) => {
    setAvatarError('')
    const file = e.target.files[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Image must be under 5MB')
      return
    }

    setAvatarUploading(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)

      await pb.collection('users').update(user.id, formData)
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Avatar upload error:', err)
      setAvatarError(err.message || 'Something went wrong uploading your avatar')
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleRemoveAvatar = async () => {
    setAvatarUploading(true)
    try {
      await pb.collection('users').update(user.id, { avatar: null })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Avatar remove error:', err)
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleBackgroundUpload = async (e) => {
    setBackgroundError('')
    const file = e.target.files[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setBackgroundError('Please choose an image file')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setBackgroundError('Image must be under 10MB')
      return
    }

    setBackgroundUploading(true)
    try {
      const formData = new FormData()
      formData.append('custom_background', file)
      await pb.collection('users').update(user.id, formData)
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Background upload error:', err)
      setBackgroundError(err.message || 'Something went wrong uploading your background')
    } finally {
      setBackgroundUploading(false)
    }
  }

  const handleRemoveBackground = async () => {
    setBackgroundUploading(true)
    try {
      await pb.collection('users').update(user.id, { custom_background: null })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Background remove error:', err)
    } finally {
      setBackgroundUploading(false)
    }
  }

  const handleSoundUpload = async (e) => {
    setSoundError('')
    const file = e.target.files[0]
    if (!file) return

    if (!file.type.startsWith('audio/')) {
      setSoundError('Please choose an audio file')
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setSoundError('Sound must be under 2MB')
      return
    }

    setSoundUploading(true)
    try {
      const formData = new FormData()
      formData.append('notification_sound', file)
      await pb.collection('users').update(user.id, formData)
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Notification sound upload error:', err)
      setSoundError(err.message || 'Something went wrong uploading your sound')
    } finally {
      setSoundUploading(false)
    }
  }

  const handleRemoveSound = async () => {
    setSoundUploading(true)
    try {
      await pb.collection('users').update(user.id, { notification_sound: null })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Notification sound remove error:', err)
    } finally {
      setSoundUploading(false)
    }
  }

  const daysRemainingForUsernameChange = () => {
    if (!user.username_changed_at) return 0

    const lastChanged = new Date(user.username_changed_at)
    const now = new Date()
    const daysSince = (now - lastChanged) / (1000 * 60 * 60 * 24)
    const remaining = Math.ceil(30 - daysSince)

    return remaining > 0 ? remaining : 0
  }

  const canChangeUsername = daysRemainingForUsernameChange() === 0

  const startEditUsername = () => {
    if (!canChangeUsername) return
    setUsernameInput(user.username)
    setUsernameError('')
    setEditingUsername(true)
  }

  const saveUsername = async () => {
    setUsernameError('')

    if (!canChangeUsername) {
      setUsernameError(`You can change your username again in ${daysRemainingForUsernameChange()} day(s)`)
      return
    }

    if (usernameInput.length < 6 || usernameInput.length > 10) {
      setUsernameError('Username must be between 6 and 10 characters')
      return
    }

    setUsernameSaving(true)
    try {
      await pb.collection('users').update(user.id, {
        username: usernameInput,
        username_changed_at: new Date().toISOString(),
      })
      await pb.collection('users').authRefresh()
      setEditingUsername(false)
    } catch (err) {
      console.error(err)
      setUsernameError(err.message || 'Something went wrong updating your username')
    } finally {
      setUsernameSaving(false)
    }
  }

  const startEditName = () => {
    setNameInput(user.name)
    setNameError('')
    setEditingName(true)
  }

  const saveName = async () => {
    setNameError('')

    if (nameInput.length < 3 || nameInput.length > 20) {
      setNameError('Display name must be between 3 and 20 characters')
      return
    }

    setNameSaving(true)
    try {
      await pb.collection('users').update(user.id, { name: nameInput })
      await pb.collection('users').authRefresh()
      setEditingName(false)
    } catch (err) {
      console.error(err)
      setNameError(err.message || 'Something went wrong updating your display name')
    } finally {
      setNameSaving(false)
    }
  }

  const startEditEmail = () => {
    setEmailInput('')
    setEmailPasswordConfirm('')
    setEmailError('')
    setEmailSuccess('')
    setEditingEmail(true)
  }

  const saveEmail = async () => {
    setEmailError('')
    setEmailSuccess('')

    if (!emailInput.trim() || !emailInput.includes('@')) {
      setEmailError('Enter a valid email address')
      return
    }

    if (emailInput.trim().toLowerCase() === user.email.toLowerCase()) {
      setEmailError('That is already your current email')
      return
    }

    const passwordAttempt = emailPasswordConfirm.trim()

    if (!passwordAttempt) {
      setEmailError('Enter your current password to confirm this change')
      return
    }

    setEmailSaving(true)
    try {
      await pb.collection('users').authWithPassword(user.username, passwordAttempt)
      await pb.collection('users').requestEmailChange(emailInput.trim())

      setEmailSuccess(`Confirmation link sent to ${emailInput.trim()}. Your email won't change until you click it.`)
      setEmailPasswordConfirm('')
    } catch (err) {
      console.error('Email change error:', err.status, err.response || err.message)
      if (err.status === 400) {
        setEmailError('Incorrect password')
      } else {
        setEmailError(err.message || 'Something went wrong requesting the email change')
      }
    } finally {
      setEmailSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    setDeleteError('')

    if (deleteConfirmInput !== user.username) {
      setDeleteError('Username does not match')
      return
    }

    setDeleting(true)
    try {
      const ownedServers = await pb.collection('servers').getFullList({
        filter: `owner="${user.id}"`,
      })

      for (const server of ownedServers) {
        await pb.collection('servers').delete(server.id)
      }

      await pb.collection('users').delete(user.id)
      pb.authStore.clear()
    } catch (err) {
      console.error('Delete account error:', err)
      setDeleteError(err.message || 'Something went wrong deleting your account')
    } finally {
      setDeleting(false)
    }
  }

  const handleResetKey = async () => {
    setResetKeyError('')

    if (resetKeyConfirmInput !== user.username) {
      setResetKeyError('Username does not match')
      return
    }

    setResettingKey(true)
    try {
      await resetKeypair()
      setResetKeySuccess('Your encryption key has been reset. Past DMs from before this reset can no longer be decrypted.')
      setShowResetKeyConfirm(false)
      setResetKeyConfirmInput('')
    } catch (err) {
      console.error('Reset key error:', err)
      setResetKeyError(err.message || 'Something went wrong resetting your key')
    } finally {
      setResettingKey(false)
    }
  }

  const handleDisableAccount = async () => {
    setDisableError('')
    setDisabling(true)
    try {
      await pb.collection('users').update(user.id, { account_disabled: true })
      pb.authStore.clear()
    } catch (err) {
      console.error('Disable account error:', err)
      setDisableError(err.message || 'Something went wrong disabling your account')
      setDisabling(false)
    }
  }

  const startEditPassword = () => {
    setCurrentPasswordInput('')
    setNewPasswordInput('')
    setNewPasswordConfirmInput('')
    setPasswordError('')
    setPasswordSuccess('')
    setEditingPassword(true)
  }

  const savePassword = async () => {
    setPasswordError('')
    setPasswordSuccess('')

    if (!currentPasswordInput) {
      setPasswordError('Enter your current password')
      return
    }

    if (newPasswordInput.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }

    if (newPasswordInput !== newPasswordConfirmInput) {
      setPasswordError('New passwords do not match')
      return
    }

    if (newPasswordInput === currentPasswordInput) {
      setPasswordError('New password must be different from your current password')
      return
    }

    setPasswordSaving(true)
    try {
      await pb.collection('users').authWithPassword(user.username, currentPasswordInput)

      await pb.collection('users').update(user.id, {
        password: newPasswordInput,
        passwordConfirm: newPasswordConfirmInput,
        oldPassword: currentPasswordInput,
      })

      setPasswordSuccess('Password updated successfully')
      setCurrentPasswordInput('')
      setNewPasswordInput('')
      setNewPasswordConfirmInput('')
      setTimeout(() => setEditingPassword(false), 1500)
    } catch (err) {
      console.error('Password change error:', err.status, err.response || err.message)
      if (err.status === 400) {
        setPasswordError('Incorrect current password')
      } else {
        setPasswordError(err.message || 'Something went wrong updating your password')
      }
    } finally {
      setPasswordSaving(false)
    }
  }

  const loadDevices = async () => {
    setDeviceError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      stream.getTracks().forEach((track) => track.stop())

      const devices = await navigator.mediaDevices.enumerateDevices()
      setMicrophones(devices.filter((d) => d.kind === 'audioinput'))
      setCameras(devices.filter((d) => d.kind === 'videoinput'))
    } catch (err) {
      console.error('Device list error:', err)
      setDeviceError('Could not access camera/microphone. Check your browser permissions.')
    }
  }

  const saveDevicePreference = (type, deviceId) => {
    if (type === 'mic') {
      setSelectedMicId(deviceId)
      localStorage.setItem('orbit_mic_id', deviceId)
    } else {
      setSelectedCameraId(deviceId)
      localStorage.setItem('orbit_camera_id', deviceId)
    }
  }

  const toggleVoiceNotePref = async (field, currentValue, setter) => {
    const newValue = !currentValue
    setter(newValue)
    setVoicePrefSaving(true)
    try {
      await pb.collection('users').update(user.id, { [field]: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Voice note preference save error:', err)
      setter(currentValue)
    } finally {
      setVoicePrefSaving(false)
    }
  }

  const toggleNotifSetting = async (field, currentValue, setter) => {
    const newValue = !currentValue
    setter(newValue)
    setNotifSaving(true)
    try {
      await pb.collection('users').update(user.id, { [field]: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Notification setting error:', err)
      setter(currentValue) // revert on failure
    } finally {
      setNotifSaving(false)
    }
  }

  const saveNotificationMode = async (newValue) => {
    const previous = notificationMode
    setNotificationMode(newValue)
    setNotifSaving(true)
    try {
      await pb.collection('users').update(user.id, { notification_mode: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Notification mode save error:', err)
      setNotificationMode(previous) // revert on failure
    } finally {
      setNotifSaving(false)
    }
  }

  const saveTextSize = async (newSize) => {
    setTextSize(newSize)
    document.body.style.fontSize = `${newSize}px`
    try {
      await pb.collection('users').update(user.id, { accessibility_text_size: newSize })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Text size save error:', err)
    }
  }

  const toggleReducedMotion = async () => {
    const newValue = !reducedMotion
    setReducedMotion(newValue)
    setAccessibilitySaving(true)
    try {
      await pb.collection('users').update(user.id, { accessibility_reduced_motion: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Reduced motion save error:', err)
      setReducedMotion(!newValue)
    } finally {
      setAccessibilitySaving(false)
    }
  }

  // Generic accessibility preference saver that also applies the change to
  // the DOM immediately (the auth refresh later re-applies it globally).
  const saveA11yPref = async (field, value, setter, previous) => {
    setter(value)
    setAccessibilitySaving(true)
    const root = document.documentElement
    if (field === 'always_underline_links') root.setAttribute('data-underline-links', value ? 'true' : 'false')
    if (field === 'high_contrast') root.setAttribute('data-high-contrast', value ? 'true' : 'false')
    if (field === 'message_group_spacing') root.style.setProperty('--orbit-message-group-spacing', `${value}px`)
    if (field === 'message_display') root.setAttribute('data-message-display', value)
    if (field === 'display_name_styles') root.setAttribute('data-name-styles', value ? 'true' : 'false')
    if (field === 'show_on_off_indicators') root.setAttribute('data-onoff-icons', value ? 'true' : 'false')
    if (field === 'role_colour_display') root.setAttribute('data-role-colour-display', value)
    if (field === 'zoom_level') document.body.style.zoom = String(value / 100)
    if (field === 'saturation') {
      root.style.setProperty('--orbit-saturation', `${value}%`)
      const shell = document.querySelector('.app-shell')
      if (shell) shell.style.filter = value < 100 ? `saturate(${value}%)` : ''
    }
    try {
      await pb.collection('users').update(user.id, { [field]: value })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Accessibility save error:', err)
      setter(previous)
    } finally {
      setAccessibilitySaving(false)
    }
  }

  const saveUiDensity = async (newValue) => {
    const previous = uiDensity
    setUiDensity(newValue)
    document.documentElement.setAttribute('data-density', newValue)
    setAppearanceSaving(true)
    try {
      await pb.collection('users').update(user.id, { ui_density: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('UI density save error:', err)
      setUiDensity(previous)
    } finally {
      setAppearanceSaving(false)
    }
  }

  const toggleAsciiEmoticons = async () => {
    const newValue = !asciiEmoticons
    setAsciiEmoticons(newValue)
    setAppearanceSaving(true)
    try {
      await pb.collection('users').update(user.id, { ascii_emoticons: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('ASCII emoticon save error:', err)
      setAsciiEmoticons(!newValue)
    } finally {
      setAppearanceSaving(false)
    }
  }

  const toggleSubscriptionBadge = async () => {
    // Only paid subscribers have a badge to show or hide.
    if (!hasPlan) return
    const newValue = !hideSubscriptionBadge
    setHideSubscriptionBadge(newValue)
    setAppearanceSaving(true)
    try {
      await pb.collection('users').update(user.id, { hide_subscription_badge: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Badge visibility save error:', err)
      setHideSubscriptionBadge(!newValue)
    } finally {
      setAppearanceSaving(false)
    }
  }

  const toggleDataUseSetting = async (field, currentValue, setter) => {
    const newValue = !currentValue
    setter(newValue)
    setDataPrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { [field]: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Data use setting error:', err)
      setter(currentValue) // revert on failure
    } finally {
      setDataPrivacySaving(false)
    }
  }

  const loadFriendsForPrivacyPicker = async () => {
    if (friendsLoaded) return
    try {
      const friendsA = await pb.collection('friends').getFullList({
        filter: `user_a="${user.id}"`,
        expand: 'user_b',
      })
      const friendsB = await pb.collection('friends').getFullList({
        filter: `user_b="${user.id}"`,
        expand: 'user_a',
      })
      const combined = [
        ...friendsA.map((f) => f.expand?.user_b).filter(Boolean),
        ...friendsB.map((f) => f.expand?.user_a).filter(Boolean),
      ]
      setFriendsList(combined)
      setFriendsLoaded(true)
    } catch (err) {
      console.error('Load friends for privacy picker error:', err)
    }
  }

  const saveProfilePrivacy = async (newTier) => {
    setProfilePrivacy(newTier)
    setProfilePrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { profile_privacy: newTier })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Profile privacy save error:', err)
    } finally {
      setProfilePrivacySaving(false)
    }
  }

  const toggleProfilePrivacyFriend = async (friendId) => {
    const newIds = profilePrivacyFriendIds.includes(friendId)
      ? profilePrivacyFriendIds.filter((id) => id !== friendId)
      : [...profilePrivacyFriendIds, friendId]
    setProfilePrivacyFriendIds(newIds) // instant feedback
    try {
      await pb.collection('users').update(user.id, { profile_privacy_friends: newIds })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Update specific-friends list error:', err)
      setProfilePrivacyFriendIds(profilePrivacyFriendIds) // revert on failure
    }
  }

  const toggleProfileShareUpdates = async () => {
    const newValue = !profileShareUpdates
    setProfileShareUpdates(newValue)
    setProfilePrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { profile_share_updates: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Share updates toggle error:', err)
      setProfileShareUpdates(!newValue)
    } finally {
      setProfilePrivacySaving(false)
    }
  }

  const toggleStatusBroadcast = async () => {
    const newValue = !statusBroadcast
    setStatusBroadcast(newValue)
    setProfilePrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { status_broadcast: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Status broadcast toggle error:', err)
      setStatusBroadcast(!newValue)
    } finally {
      setProfilePrivacySaving(false)
    }
  }

  const saveStatusAudience = async (newValue) => {
    const previous = statusAudience
    setStatusAudience(newValue)
    setProfilePrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { status_broadcast_audience: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Status audience save error:', err)
      setStatusAudience(previous)
    } finally {
      setProfilePrivacySaving(false)
    }
  }

  const saveMutualServersVisibility = async (newValue) => {
    const previous = mutualServersVisibility
    setMutualServersVisibility(newValue)
    setProfilePrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { mutual_servers_visibility: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Mutual server visibility save error:', err)
      setMutualServersVisibility(previous)
    } finally {
      setProfilePrivacySaving(false)
    }
  }

  // --- Language & Time ---------------------------------------------------
  const saveLanguagePref = async (field, value, setter, previous) => {
    setter(value)
    setLanguageSaving(true)
    try {
      await pb.collection('users').update(user.id, { [field]: value })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Language preference save error:', err)
      setter(previous)
    } finally {
      setLanguageSaving(false)
    }
  }

  // --- System ------------------------------------------------------------
  const saveSystemPref = async (field, value, setter, previous) => {
    setter(value)
    setSystemSaving(true)
    setSystemNotice('')
    try {
      await pb.collection('users').update(user.id, { [field]: value })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('System preference save error:', err)
      setter(previous)
    } finally {
      setSystemSaving(false)
    }
  }

  const handleToggleDesktopNotifications = async () => {
    if (desktopNotifications) {
      return saveSystemPref('desktop_notifications', false, setDesktopNotifications, true)
    }
    setSystemNotice('')
    if (typeof Notification === 'undefined') {
      setSystemNotice('This browser does not support desktop notifications.')
      return
    }
    let permission = Notification.permission
    if (permission === 'default') {
      try { permission = await Notification.requestPermission() } catch { permission = 'denied' }
    }
    if (permission !== 'granted') {
      setSystemNotice('Desktop notifications are blocked — allow them for this site in your browser settings, then try again.')
      return
    }
    saveSystemPref('desktop_notifications', true, setDesktopNotifications, false)
  }

  // --- Activity ----------------------------------------------------------
  const saveActivityVisibility = async (value) => {
    const previous = activityVisibility
    setActivityVisibility(value)
    setActivitySaving(true)
    try {
      await pb.collection('users').update(user.id, { activity_visibility: value })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Activity visibility save error:', err)
      setActivityVisibility(previous)
    } finally {
      setActivitySaving(false)
    }
  }

  const toggleShowActivity = async () => {
    const newValue = !showActivity
    setShowActivity(newValue)
    setActivitySaving(true)
    try {
      await pb.collection('users').update(user.id, { show_activity: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Show activity save error:', err)
      setShowActivity(!newValue)
    } finally {
      setActivitySaving(false)
    }
  }

  const saveCustomActivity = async () => {
    setActivitySaving(true)
    try {
      const value = customActivity.trim().slice(0, 128)
      await pb.collection('users').update(user.id, { custom_activity: value })
      await pb.collection('users').authRefresh()
      setCustomActivity(value)
      setCustomActivitySaved(value)
    } catch (err) {
      console.error('Custom activity save error:', err)
    } finally {
      setActivitySaving(false)
    }
  }

  const loadConnectedAccounts = async () => {
    if (connectedLoaded) return
    try {
      const rows = await pb.collection('connected_accounts').getFullList({
        filter: `user="${user.id}"`,
        requestKey: null,
      })
      setConnectedAccounts(rows)
    } catch (err) {
      console.error('Load connected accounts error:', err)
    } finally {
      setConnectedLoaded(true)
    }
  }

  const handleDisconnectAccount = async (record) => {
    setDisconnectingId(record.id)
    try {
      await pb.collection('connected_accounts').delete(record.id, { requestKey: null })
      setConnectedAccounts((prev) => prev.filter((a) => a.id !== record.id))
    } catch (err) {
      console.error('Disconnect account error:', err)
    } finally {
      setDisconnectingId(null)
    }
  }

  // Real export of everything scoped to the logged-in user, using the
  // SAME API rules as normal — this only ever returns what the account
  // could already fetch itself. Downloads as a single JSON file rather
  // than pretending to email a report, since there's no backing job
  // system to generate one asynchronously.
  const handleRequestData = async () => {
    setRequestDataError('')
    setRequestingData(true)
    try {
      const [dmMessages, dmThreadsA, dmThreadsB, memberships, ownedServers, friendsA, friendsB] = await Promise.all([
        pb.collection('dm_messages').getFullList({ filter: `sender="${user.id}"`, requestKey: null }),
        pb.collection('dm_threads').getFullList({ filter: `user_a="${user.id}"`, expand: 'user_b', requestKey: null }),
        pb.collection('dm_threads').getFullList({ filter: `user_b="${user.id}"`, expand: 'user_a', requestKey: null }),
        pb.collection('members').getFullList({ filter: `user="${user.id}"`, expand: 'server', requestKey: null }),
        pb.collection('servers').getFullList({ filter: `owner="${user.id}"`, requestKey: null }),
        pb.collection('friends').getFullList({ filter: `user_a="${user.id}"`, expand: 'user_b', requestKey: null }),
        pb.collection('friends').getFullList({ filter: `user_b="${user.id}"`, expand: 'user_a', requestKey: null }),
      ])

      const dmThreads = [
        ...dmThreadsA.map((t) => ({ id: t.id, with_user: t.expand?.user_b?.username || t.user_b, created: t.created })),
        ...dmThreadsB.map((t) => ({ id: t.id, with_user: t.expand?.user_a?.username || t.user_a, created: t.created })),
      ]

      // Usernames rather than raw ids/relation records — makes the file
      // actually re-importable (Import My Data looks users/servers up by
      // these), not just a read-only dump.
      const friendUsernames = [
        ...friendsA.map((f) => f.expand?.user_b?.username).filter(Boolean),
        ...friendsB.map((f) => f.expand?.user_a?.username).filter(Boolean),
      ]
      const serverIdsIn = memberships.map((m) => m.server).filter(Boolean)

      const exportData = {
        export_format: 'orbit-data-export-v1', // checked on import so a random/unrelated JSON file gets rejected with a clear error instead of silently doing nothing
        exported_at: new Date().toISOString(),
        _read_me: 'See "recoverable" vs "not_recoverable" below for what this export can and cannot include, and why. This file can be re-imported later via Data & Privacy > Import My Data (one-time use per account).',

        recoverable: {
          profile: {
            name: user.name,
            bio: user.bio,
            theme_colour: user.theme_colour,
            banner_colour: user.banner_colour,
          },
          dm_threads: {
            description: 'Which DM conversations you have and who they are with. This is recoverable even though the message CONTENT inside them is not (see not_recoverable below).',
            data: dmThreads,
          },
          server_ids_in: serverIdsIn,
          servers_owned: ownedServers,
          friend_usernames: friendUsernames,
        },

        not_recoverable: {
          dm_message_content: {
            description: 'The actual text of your direct messages cannot be included in this export. DMs are end-to-end encrypted — Orbit only ever stores the encrypted, unreadable version, so there is no plaintext copy anywhere to export, even for you.',
            message_count_for_reference_only: dmMessages.length,
          },
          server_message_content: {
            description: "Messages you sent in servers aren't included — on their own, without the surrounding conversation, they aren't useful to restore.",
          },
        },
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `orbit-data-export-${user.username}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Data export error:', err)
      setRequestDataError('Something went wrong preparing your data export')
    } finally {
      setRequestingData(false)
    }
  }


  useEffect(() => {
    if (section === 'voice') {
      loadDevices()
    }
  }, [section])

  useEffect(() => {
    if (section === 'data-privacy') {
      loadFriendsForPrivacyPicker()
    }
  }, [section])

  useEffect(() => {
    if (section === 'messaging-permissions') {
      loadBlockedUsers()
    }
  }, [section])

  useEffect(() => {
    if (section !== 'apps') return
    // Deferred so the load isn't a synchronous setState-in-effect call.
    const timer = setTimeout(() => loadConnectedAccounts(), 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const handleImportFileSelect = (e) => {
    setImportError('')
    setImportResult(null)
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result)
        if (parsed.export_format !== 'orbit-data-export-v1') {
          setImportError('This file doesn\'t look like an Orbit data export.')
          setImportFile(null)
          setImportPreview(null)
          return
        }
        setImportFile(file)
        setImportPreview(parsed)
      } catch (err) {
        setImportError('Could not read that file — make sure it\'s the .json file Orbit gave you.')
        setImportFile(null)
        setImportPreview(null)
      }
    }
    reader.readAsText(file)
  }

  // Applies whatever CAN be safely restored from an export: profile
  // fields, friend requests (never silently recreated friendships — the
  // other person still has to accept), and rejoining servers you were a
  // member of. Each item is attempted independently so one bad/missing
  // username or deleted server doesn't abort the whole import. Locked to
  // one use per account via data_import_used, checked here AND enforced
  // by intent (not a hard server-side block — see note below).
  const handleConfirmImport = async () => {
    if (!importPreview) return
    if (user.data_import_used) {
      setImportError('You\'ve already used your one-time data import for this account.')
      return
    }

    setImporting(true)
    setImportError('')

    const result = {
      profileUpdated: false,
      friendsRequested: [],
      friendsSkipped: [],
      serversRejoined: [],
      serversSkipped: [],
    }

    try {
      const profile = importPreview.recoverable?.profile
      if (profile) {
        try {
          await pb.collection('users').update(user.id, {
            name: profile.name ?? user.name,
            bio: profile.bio ?? user.bio,
            theme_colour: profile.theme_colour ?? user.theme_colour,
            banner_colour: profile.banner_colour ?? user.banner_colour,
          })
          result.profileUpdated = true
        } catch (err) {
          console.error('Import profile restore error:', err)
        }
      }

      const friendUsernames = importPreview.recoverable?.friend_usernames || []
      for (const username of friendUsernames) {
        try {
          if (username === user.username) continue

          const target = await pb.collection('users').getFirstListItem(`username="${username}"`).catch(() => null)
          if (!target) {
            result.friendsSkipped.push({ username, reason: 'Account no longer exists' })
            continue
          }

          const alreadyFriends = await pb.collection('friends').getFullList({
            filter: `(user_a="${user.id}" && user_b="${target.id}") || (user_a="${target.id}" && user_b="${user.id}")`,
            requestKey: null,
          })
          if (alreadyFriends.length > 0) {
            result.friendsSkipped.push({ username, reason: 'Already friends' })
            continue
          }

          const existingRequest = await pb.collection('friend_requests').getFullList({
            filter: `(from_user="${user.id}" && to_user="${target.id}") || (from_user="${target.id}" && to_user="${user.id}")`,
            requestKey: null,
          })
          if (existingRequest.some((r) => r.status === 'pending')) {
            result.friendsSkipped.push({ username, reason: 'Request already pending' })
            continue
          }

          await pb.collection('friend_requests').create({
            from_user: user.id,
            to_user: target.id,
            status: 'pending',
          })
          result.friendsRequested.push(username)
        } catch (err) {
          console.error('Import friend request error for', username, err)
          result.friendsSkipped.push({ username, reason: 'Something went wrong' })
        }
      }

      const serverIds = importPreview.recoverable?.server_ids_in || []
      for (const serverId of serverIds) {
        try {
          const server = await pb.collection('servers').getOne(serverId).catch(() => null)
          if (!server) {
            result.serversSkipped.push({ serverId, reason: 'Server no longer exists' })
            continue
          }

          const existingMembership = await pb.collection('members').getFullList({
            filter: `server="${serverId}" && user="${user.id}"`,
            requestKey: null,
          })
          if (existingMembership.length > 0) {
            result.serversSkipped.push({ serverId, name: server.name, reason: 'Already a member' })
            continue
          }

          await pb.collection('members').create({ server: serverId, user: user.id })
          result.serversRejoined.push(server.name)
        } catch (err) {
          console.error('Import server rejoin error for', serverId, err)
          result.serversSkipped.push({ serverId, reason: 'Something went wrong' })
        }
      }

      await pb.collection('users').update(user.id, { data_import_used: true })
      await pb.collection('users').authRefresh()

      setImportResult(result)
      setImportFile(null)
      setImportPreview(null)
    } catch (err) {
      console.error('Import error:', err)
      setImportError('Something went wrong during import.')
    } finally {
      setImporting(false)
    }
  }

  const navGroupHeaderStyle = { fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text)', margin: '18px 0 4px', padding: '0 8px' }

  const saveDmPrivacy = async (newValue) => {
    setDmPrivacy(newValue)
    setDmPrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { dm_privacy: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('DM privacy save error:', err)
    } finally {
      setDmPrivacySaving(false)
    }
  }

  const saveFriendRequestPrivacy = async (newValue) => {
    setFriendRequestPrivacy(newValue)
    setFriendRequestPrivacySaving(true)
    try {
      await pb.collection('users').update(user.id, { friend_request_privacy: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Friend request privacy save error:', err)
    } finally {
      setFriendRequestPrivacySaving(false)
    }
  }

  const loadBlockedUsers = async () => {
    if (blockedUsersLoaded) return
    try {
      const records = await pb.collection('blocked_users').getFullList({
        filter: `blocker="${user.id}"`,
        expand: 'blocked',
        requestKey: null,
      })
      setBlockedUsers(records)
      setBlockedUsersLoaded(true)
    } catch (err) {
      console.error('Load blocked users error:', err)
    }
  }

  const handleUnblock = async (recordId) => {
    setUnblockingId(recordId)
    try {
      await pb.collection('blocked_users').delete(recordId)
      setBlockedUsers((prev) => prev.filter((b) => b.id !== recordId))
    } catch (err) {
      console.error('Unblock error:', err)
    } finally {
      setUnblockingId(null)
    }
  }

  const saveContentFilterMedia = async (newValue) => {
    setContentFilterMedia(newValue)
    setContentFilterSaving(true)
    try {
      await pb.collection('users').update(user.id, { content_filter_media: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Content filter media save error:', err)
    } finally {
      setContentFilterSaving(false)
    }
  }

  const toggleContentFilterNsfwScan = async () => {
    const newValue = !contentFilterNsfwScan
    setContentFilterNsfwScan(newValue)
    setContentFilterSaving(true)
    try {
      await pb.collection('users').update(user.id, { content_filter_nsfw_scan: newValue })
      await pb.collection('users').authRefresh()
      if (newValue) preloadNsfwModel() // start loading the model right away rather than waiting for the first image
    } catch (err) {
      console.error('NSFW scan toggle error:', err)
      setContentFilterNsfwScan(!newValue)
    } finally {
      setContentFilterSaving(false)
    }
  }

  const toggleSpamFilterBlockLinks = async () => {
    const newValue = !spamFilterBlockLinks
    setSpamFilterBlockLinks(newValue)
    setSpamFilterSaving(true)
    try {
      await pb.collection('users').update(user.id, { spam_filter_block_links: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Spam filter save error:', err)
      setSpamFilterBlockLinks(!newValue)
    } finally {
      setSpamFilterSaving(false)
    }
  }

  const toggleSpamFilterRateLimit = async () => {
    const newValue = !spamFilterRateLimit
    setSpamFilterRateLimit(newValue)
    setSpamFilterSaving(true)
    try {
      await pb.collection('users').update(user.id, { spam_filter_rate_limit: newValue })
      await pb.collection('users').authRefresh()
    } catch (err) {
      console.error('Spam filter save error:', err)
      setSpamFilterRateLimit(!newValue)
    } finally {
      setSpamFilterSaving(false)
    }
  }

  const saveSpamFilterKeywords = async () => {
    setSpamFilterSaving(true)
    try {
      await pb.collection('users').update(user.id, { spam_filter_keywords: spamFilterKeywords })
      await pb.collection('users').authRefresh()
      setSpamFilterKeywordsSaved(spamFilterKeywords)
    } catch (err) {
      console.error('Spam keyword save error:', err)
    } finally {
      setSpamFilterSaving(false)
    }
  }

  return (
    <div className="settings-modal-overlay" onClick={onBack}>
      <div className="settings-modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="settings-modal-close" onClick={onBack}>✕</button>

        <div className="settings-modal-nav">
          <div className="server-settings-nav-title">{t('settings.title')}</div>

          <button
            className={`server-settings-nav-item${section === 'account' ? ' active' : ''}`}
            onClick={() => { setSection('account'); setAccountTab('info'); requestAnimationFrame(() => accountInfoRef.current?.scrollIntoView({ block: 'start' })) }}
          >
            {t('nav.account')}
          </button>
          {section === 'account' && (
            <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: '14px' }}>
              <button
                className={`server-settings-nav-item${accountTab === 'info' ? ' active' : ''}`}
                onClick={() => scrollToAccountSection('info')}
              >
                Account Info
              </button>
              <button
                className={`server-settings-nav-item${accountTab === 'security' ? ' active' : ''}`}
                onClick={() => scrollToAccountSection('security')}
              >
                Password & Security
              </button>
              <button
                className={`server-settings-nav-item${accountTab === 'standing' ? ' active' : ''}`}
                onClick={() => scrollToAccountSection('standing')}
              >
                Account Standing
              </button>
              <button
                className={`server-settings-nav-item${accountTab === 'danger' ? ' active' : ''}`}
                onClick={() => scrollToAccountSection('danger')}
              >
                Danger Zone
              </button>
            </div>
          )}
          <button
            className={`server-settings-nav-item${section === 'data-privacy' ? ' active' : ''}`}
            onClick={() => { setSection('data-privacy'); setDataPrivacyTab('usage'); requestAnimationFrame(() => dataPrivacyUsageRef.current?.scrollIntoView({ block: 'start' })) }}
          >
            {t('nav.dataPrivacy')}
          </button>
          {section === 'data-privacy' && (
            <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: '14px' }}>
              <button
                className={`server-settings-nav-item${dataPrivacyTab === 'usage' ? ' active' : ''}`}
                onClick={() => scrollToDataPrivacySection('usage')}
              >
                How Orbit Uses My Data
              </button>
              <button
                className={`server-settings-nav-item${dataPrivacyTab === 'profile' ? ' active' : ''}`}
                onClick={() => scrollToDataPrivacySection('profile')}
              >
                Profile Privacy
              </button>
              <button
                className={`server-settings-nav-item${dataPrivacyTab === 'encryption' ? ' active' : ''}`}
                onClick={() => scrollToDataPrivacySection('encryption')}
              >
                DM End-to-End Encryption
              </button>
            </div>
          )}
          <button
            className={`server-settings-nav-item${section === 'messaging-permissions' ? ' active' : ''}`}
            onClick={() => { setSection('messaging-permissions'); setMsgPermTab('content-filters'); requestAnimationFrame(() => msgPermContentFiltersRef.current?.scrollIntoView({ block: 'start' })) }}
          >
            {t('nav.messaging')}
          </button>
          {section === 'messaging-permissions' && (
            <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: '14px' }}>
              <button className={`server-settings-nav-item${msgPermTab === 'content-filters' ? ' active' : ''}`} onClick={() => scrollToMsgPermSection('content-filters')}>Content Filters</button>
              <button className={`server-settings-nav-item${msgPermTab === 'spam-filters' ? ' active' : ''}`} onClick={() => scrollToMsgPermSection('spam-filters')}>Spam Filters</button>
              <button className={`server-settings-nav-item${msgPermTab === 'direct-messages' ? ' active' : ''}`} onClick={() => scrollToMsgPermSection('direct-messages')}>Direct Messages</button>
              <button className={`server-settings-nav-item${msgPermTab === 'friend-requests' ? ' active' : ''}`} onClick={() => scrollToMsgPermSection('friend-requests')}>Friend Requests</button>
              <button className={`server-settings-nav-item${msgPermTab === 'ignore-block' ? ' active' : ''}`} onClick={() => scrollToMsgPermSection('ignore-block')}>Ignore & Block</button>
            </div>
          )}
          <button className={`server-settings-nav-item${section === 'notifications' ? ' active' : ''}`} onClick={() => setSection('notifications')}>{t('nav.notifications')}</button>

          <div style={navGroupHeaderStyle}>Experience</div>
          <button className={`server-settings-nav-item${section === 'voice' ? ' active' : ''}`} onClick={() => setSection('voice')}>{t('nav.voice')}</button>
          <button className={`server-settings-nav-item${section === 'appearance' ? ' active' : ''}`} onClick={() => setSection('appearance')}>{t('nav.appearance')}</button>
          <button className={`server-settings-nav-item${section === 'accessibility' ? ' active' : ''}`} onClick={() => setSection('accessibility')}>{t('nav.accessibility')}</button>
          <button className={`server-settings-nav-item${section === 'system' ? ' active' : ''}`} onClick={() => setSection('system')}>{t('nav.system')}</button>
          <button className={`server-settings-nav-item${section === 'language' ? ' active' : ''}`} onClick={() => setSection('language')}>{t('nav.language')}</button>

          <div style={navGroupHeaderStyle}>Games & Apps</div>
          <button className={`server-settings-nav-item${section === 'games' ? ' active' : ''}`} onClick={() => setSection('games')}>{t('nav.games')}</button>
          <button className={`server-settings-nav-item${section === 'activity-privacy' ? ' active' : ''}`} onClick={() => setSection('activity-privacy')}>{t('nav.activityPrivacy')}</button>
          <button className={`server-settings-nav-item${section === 'apps' ? ' active' : ''}`} onClick={() => setSection('apps')}>{t('nav.connectedApps')}</button>

          <div style={navGroupHeaderStyle}>Billing</div>
          <button className={`server-settings-nav-item${section === 'orbit-plus' ? ' active' : ''}`} onClick={() => setSection('orbit-plus')}>{t('nav.orbitPlus')}</button>
          <button className={`server-settings-nav-item${section === 'server-boosts' ? ' active' : ''}`} onClick={() => setSection('server-boosts')}>{t('nav.serverBoosts')}</button>
          <button className={`server-settings-nav-item${section === 'subscriptions' ? ' active' : ''}`} onClick={() => setSection('subscriptions')}>{t('nav.subscriptions')}</button>
          <button className={`server-settings-nav-item${section === 'gifts' ? ' active' : ''}`} onClick={() => setSection('gifts')}>{t('nav.gifts')}</button>
          <button className={`server-settings-nav-item${section === 'billing' ? ' active' : ''}`} onClick={() => setSection('billing')}>{t('nav.billing')}</button>

          {onLogout && (
            <button className="server-settings-nav-item server-settings-nav-logout" onClick={onLogout}>
              Log Out
            </button>
          )}
        </div>

        <div className="settings-modal-content">
          {section === 'account' && (
            <div
              ref={accountScrollRef}
              onScroll={handleAccountScroll}
              style={{ height: '100%', overflowY: 'auto' }}
            >
              <div id="account-section-info" ref={accountInfoRef}>
                <div>
                  <h2>Account Info</h2>

                  <div style={{ marginBottom: '20px' }}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Your avatar" style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', display: 'block', marginBottom: '10px' }} />
                    ) : (
                      <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px', color: '#888' }}>
                        No avatar
                      </div>
                    )}

                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      disabled={avatarUploading}
                    />
                    {avatarUrl && (
                      <button onClick={handleRemoveAvatar} disabled={avatarUploading} style={{ marginLeft: '10px' }}>
                        Remove
                      </button>
                    )}
                    {avatarUploading && <p>Uploading...</p>}
                    {avatarError && <p style={{ color: 'red' }}>{avatarError}</p>}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'gray', textTransform: 'uppercase' }}>Username</div>
                      {editingUsername ? (
                        <div style={{ marginTop: '6px' }}>
                          <input
                            type="text"
                            value={usernameInput}
                            onChange={(e) => setUsernameInput(e.target.value)}
                          />
                          <button onClick={saveUsername} disabled={usernameSaving} style={{ marginLeft: '6px' }}>
                            {usernameSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button onClick={() => setEditingUsername(false)} style={{ marginLeft: '6px' }}>Cancel</button>
                          {usernameError && <p style={{ color: 'red' }}>{usernameError}</p>}
                        </div>
                      ) : (
                        <div>
                          {user.username}
                          {!canChangeUsername && (
                            <span style={{ color: 'gray', fontSize: '0.85em' }}>
                              {' '}(available again in {daysRemainingForUsernameChange()} day(s))
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {!editingUsername && (
                      <button onClick={startEditUsername} disabled={!canChangeUsername}>Edit</button>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'gray', textTransform: 'uppercase' }}>Display Name</div>
                      {editingName ? (
                        <div style={{ marginTop: '6px' }}>
                          <input
                            type="text"
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                          />
                          <button onClick={saveName} disabled={nameSaving} style={{ marginLeft: '6px' }}>
                            {nameSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button onClick={() => setEditingName(false)} style={{ marginLeft: '6px' }}>Cancel</button>
                          {nameError && <p style={{ color: 'red' }}>{nameError}</p>}
                        </div>
                      ) : (
                        <div>{user.name}</div>
                      )}
                    </div>
                    {!editingName && <button onClick={startEditName}>Edit</button>}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', color: 'gray', textTransform: 'uppercase' }}>Email</div>
                      {editingEmail ? (
                        <div style={{ marginTop: '6px' }}>
                          <div>
                            <label>New email address</label>
                            <br />
                            <input
                              type="email"
                              placeholder="new@email.com"
                              value={emailInput}
                              onChange={(e) => setEmailInput(e.target.value)}
                            />
                          </div>
                          <div>
                            <label>Confirm your current password</label>
                            <br />
                            <input
                              type="password"
                              value={emailPasswordConfirm}
                              onChange={(e) => setEmailPasswordConfirm(e.target.value)}
                            />
                          </div>
                          <button onClick={saveEmail} disabled={emailSaving}>
                            {emailSaving ? 'Sending...' : 'Send Confirmation Link'}
                          </button>
                          <button onClick={() => setEditingEmail(false)} style={{ marginLeft: '6px' }}>Cancel</button>
                          {emailError && <p style={{ color: 'red' }}>{emailError}</p>}
                          {emailSuccess && <p style={{ color: 'lightgreen' }}>{emailSuccess}</p>}
                        </div>
                      ) : (
                        <div>
                          {emailRevealed ? user.email : '*'.repeat(Math.max(user.email.indexOf('@'), 4)) + user.email.slice(user.email.indexOf('@'))}
                          {' '}
                          <button onClick={() => setEmailRevealed((v) => !v)} style={{ background: 'none', border: 'none', color: 'var(--accent)', padding: 0, textDecoration: 'underline' }}>
                            {emailRevealed ? 'Hide' : 'Reveal'}
                          </button>
                        </div>
                      )}
                    </div>
                    {!editingEmail && <button onClick={startEditEmail}>Edit</button>}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'gray', textTransform: 'uppercase' }}>User ID</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>{user.id}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div id="account-section-security" ref={accountSecurityRef} style={{ marginTop: '32px' }}>
                <div>
                  <h2>Password & Security</h2>

                  <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '12px', color: 'gray', textTransform: 'uppercase' }}>Password</div>
                      {!editingPassword && <button onClick={startEditPassword}>Edit</button>}
                    </div>
                    {editingPassword && (
                      <div style={{ marginTop: '10px' }}>
                        <div>
                          <label>Current password</label>
                          <br />
                          <input
                            type="password"
                            value={currentPasswordInput}
                            onChange={(e) => setCurrentPasswordInput(e.target.value)}
                          />
                        </div>
                        <div>
                          <label>New password</label>
                          <br />
                          <input
                            type="password"
                            value={newPasswordInput}
                            onChange={(e) => setNewPasswordInput(e.target.value)}
                          />
                        </div>
                        <div>
                          <label>Confirm new password</label>
                          <br />
                          <input
                            type="password"
                            value={newPasswordConfirmInput}
                            onChange={(e) => setNewPasswordConfirmInput(e.target.value)}
                          />
                        </div>
                        <button onClick={savePassword} disabled={passwordSaving}>
                          {passwordSaving ? 'Saving...' : 'Update Password'}
                        </button>
                        <button onClick={() => setEditingPassword(false)} style={{ marginLeft: '6px' }}>Cancel</button>
                        {passwordError && <p style={{ color: 'red' }}>{passwordError}</p>}
                        {passwordSuccess && <p style={{ color: 'lightgreen' }}>{passwordSuccess}</p>}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '12px', color: 'gray', textTransform: 'uppercase' }}>Multi-Factor Authentication</div>
                        <div>{mfaEnabled ? '✅ Enabled' : 'Disabled'}</div>
                      </div>
                      <button onClick={() => setShowMfaConfirm(true)}>
                        {mfaEnabled ? 'Disable' : 'Set up ›'}
                      </button>
                    </div>
                    <p style={{ margin: '6px 0 0', color: 'gray', fontSize: '0.9em' }}>
                      Recommended for extra security. When enabled, you'll need to enter a one-time code sent to your email each time you log in, in addition to your password.
                    </p>

                    {showMfaConfirm && (
                      <div style={{ marginTop: '10px' }}>
                        <label>Confirm your current password</label>
                        <br />
                        <input
                          type="password"
                          value={mfaPasswordConfirm}
                          onChange={(e) => setMfaPasswordConfirm(e.target.value)}
                        />
                        <button onClick={handleToggleMfa} disabled={mfaSaving}>
                          {mfaSaving ? 'Saving...' : mfaEnabled ? 'Confirm Disable' : 'Confirm Enable'}
                        </button>
                        <button onClick={() => { setShowMfaConfirm(false); setMfaPasswordConfirm('') }} style={{ marginLeft: '6px' }}>
                          Cancel
                        </button>
                        {mfaError && <p style={{ color: 'red' }}>{mfaError}</p>}
                        {mfaSuccess && <p style={{ color: 'lightgreen' }}>{mfaSuccess}</p>}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: 'gray', textTransform: 'uppercase' }}>Logged-in Devices</div>
                      <div>This device</div>
                    </div>
                    <span style={{ color: 'gray', fontSize: '0.85em' }}>Multi-device session tracking isn't built yet</span>
                  </div>
                </div>
              </div>

              <div id="account-section-standing" ref={accountStandingRef} style={{ marginTop: '32px' }}>
                <div>
                  <h2>Account Standing</h2>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '14px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <span style={{ color: 'var(--teal)', fontSize: '1.3em' }}>✅</span>
                    <div>
                      <strong>Your account is all good</strong>
                      <p style={{ margin: '4px 0 0', color: 'gray' }}>
                        Thanks for following Orbit's community guidelines. If you break the rules, it will show up here.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div id="account-section-danger" ref={accountDangerRef} style={{ marginTop: '32px' }}>
                <div>
                  <h2>Danger Zone</h2>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <div>
                      <strong>Disable your account</strong>
                      <p style={{ margin: 0, color: 'gray' }}>Temporarily disable your account.</p>
                    </div>
                    <button onClick={() => setShowDisableConfirm(true)}>
                      Disable Account
                    </button>
                  </div>

                  {showDisableConfirm && (
                    <div>
                      <p>
                        Your account will be hidden and you'll be logged out. Log back in anytime to reactivate it.
                      </p>
                      <button onClick={handleDisableAccount} disabled={disabling}>
                        {disabling ? 'Disabling...' : 'Confirm Disable'}
                      </button>
                      <button onClick={() => setShowDisableConfirm(false)} style={{ marginLeft: '6px' }}>Cancel</button>
                      {disableError && <p style={{ color: 'red' }}>{disableError}</p>}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>Close your account</strong>
                      <p style={{ margin: 0, color: 'gray' }}>Permanently close your account.</p>
                    </div>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      style={{ backgroundColor: '#e53935', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '4px' }}
                    >
                      Delete Account
                    </button>
                  </div>

                  {showDeleteConfirm && (
                    <div>
                      <p style={{ color: 'red' }}>
                        This is permanent and cannot be undone — any servers you own will also be permanently deleted, along with their channels and messages. Type your username ({user.username}) to confirm.
                      </p>
                      <input
                        type="text"
                        value={deleteConfirmInput}
                        onChange={(e) => setDeleteConfirmInput(e.target.value)}
                        placeholder="Type your username"
                      />
                      <button onClick={handleDeleteAccount} disabled={deleteConfirmInput !== user.username || deleting}>
                        {deleting ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                      <button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmInput('') }} style={{ marginLeft: '6px' }}>
                        Cancel
                      </button>
                      {deleteError && <p style={{ color: 'red' }}>{deleteError}</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {section === 'data-privacy' && (
            <div
              ref={dataPrivacyScrollRef}
              onScroll={handleDataPrivacyScroll}
              style={{ height: '100%', overflowY: 'auto' }}
            >
              <h2>Data & Privacy</h2>
              <p style={{ color: 'gray' }}>
                Learn about how Orbit uses your data, control who can see your profile, and manage DM encryption.
              </p>

              <div id="data-privacy-usage" ref={dataPrivacyUsageRef} style={{ marginTop: '20px' }}>
                <h3>How Orbit Uses My Data</h3>
                <p style={{ color: 'gray' }}>
                  In order to provide the service, Orbit needs to store and process some data — such as your messages, what servers you're in, and your direct messages. You can stop this by <button onClick={() => setAccountTab('danger')} style={{ background: 'none', border: 'none', color: 'var(--accent)', padding: 0, textDecoration: 'underline' }}>disabling or deleting</button> your account.
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0' }}>
                  <div>
                    <strong>Use my activity to improve Orbit</strong>
                    <p style={{ margin: 0, color: 'gray' }}>Allow Orbit to use and process usage data to understand and improve the service.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={dataUseImprove}
                    disabled={dataPrivacySaving}
                    onChange={() => toggleDataUseSetting('data_use_improve', dataUseImprove, setDataUseImprove)}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0' }}>
                  <div>
                    <strong>Personalize my Orbit experience</strong>
                    <p style={{ margin: 0, color: 'gray' }}>Allow Orbit to use info like which servers you're in to personalize your experience.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={dataUsePersonalize}
                    disabled={dataPrivacySaving}
                    onChange={() => toggleDataUseSetting('data_use_personalize', dataUsePersonalize, setDataUsePersonalize)}
                  />
                </div>

                <div style={{ marginTop: '20px' }}>
                  <strong>Request my data</strong>
                  <p style={{ margin: '0 0 10px', color: 'gray' }}>
                    Download a copy of your Orbit data as a file.
                  </p>

                  <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 14px', marginBottom: '10px' }}>
                    <div style={{ color: 'var(--teal)', fontWeight: 600, marginBottom: '4px' }}>✓ Included</div>
                    <ul style={{ margin: 0, paddingLeft: '18px', color: 'gray' }}>
                      <li>Your profile info</li>
                      <li>Full text of messages you've sent in servers</li>
                      <li>Your DM conversations (who they're with — not the message content)</li>
                      <li>Server memberships and servers you own</li>
                      <li>Your friends list</li>
                    </ul>
                  </div>

                  <div style={{ border: '1px solid var(--danger-bg)', borderRadius: '6px', padding: '12px 14px', marginBottom: '10px' }}>
                    <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '4px' }}>✕ Not included</div>
                    <ul style={{ margin: 0, paddingLeft: '18px', color: 'gray' }}>
                      <li>
                        The actual text of your direct messages. DMs are end-to-end encrypted — Orbit only ever stores an encrypted, unreadable version, so there's no plaintext copy to include, even for you.
                      </li>
                    </ul>
                  </div>

                  <button onClick={handleRequestData} disabled={requestingData}>
                    {requestingData ? 'Preparing...' : 'Request Data'}
                  </button>
                  {requestDataError && <p style={{ color: 'red' }}>{requestDataError}</p>}
                </div>

                <div style={{ marginTop: '24px' }}>
                  <strong>Import my data</strong>
                  <p style={{ margin: '0 0 10px', color: 'gray' }}>
                    Restore your profile, friends, and server memberships from a previous Orbit data export.
                  </p>

                  {user.data_import_used ? (
                    <p style={{ color: 'gray' }}>
                      You've already used your one-time data import on this account.
                    </p>
                  ) : (
                    <>
                      <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 14px', marginBottom: '10px' }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>What gets restored</div>
                        <ul style={{ margin: 0, paddingLeft: '18px', color: 'gray' }}>
                          <li>Display name, bio, theme colour, banner colour</li>
                          <li>Friend requests sent to each friend on the export (they still have to accept — this never force-creates a friendship)</li>
                          <li>Rejoining servers you were previously a member of, if they still exist</li>
                        </ul>
                        <p style={{ margin: '8px 0 0', color: 'var(--warning)' }}>
                          This can only be done once per account.
                        </p>
                      </div>

                      <input
                        ref={importFileInputRef}
                        type="file"
                        accept="application/json"
                        onChange={handleImportFileSelect}
                        disabled={importing}
                      />

                      {importError && <p style={{ color: 'red' }}>{importError}</p>}

                      {importPreview && !importing && (
                        <div style={{ marginTop: '12px' }}>
                          <p>
                            This file has {importPreview.recoverable?.friend_usernames?.length || 0} friend(s) and {importPreview.recoverable?.server_ids_in?.length || 0} server(s) to restore, exported {importPreview.exported_at ? new Date(importPreview.exported_at).toLocaleDateString() : 'at an unknown date'}.
                          </p>
                          <button className="btn-primary" onClick={handleConfirmImport}>
                            Confirm Import
                          </button>
                          <button
                            onClick={() => { setImportFile(null); setImportPreview(null); if (importFileInputRef.current) importFileInputRef.current.value = '' }}
                            style={{ marginLeft: '6px' }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {importing && <p>Importing...</p>}

                      {importResult && (
                        <div style={{ marginTop: '12px', border: '1px solid var(--border)', borderRadius: '6px', padding: '12px 14px' }}>
                          <div style={{ color: 'var(--teal)', fontWeight: 600, marginBottom: '6px' }}>Import complete</div>
                          <p style={{ margin: '4px 0' }}>
                            Profile: {importResult.profileUpdated ? 'restored' : 'nothing to restore'}
                          </p>
                          <p style={{ margin: '4px 0' }}>
                            Friend requests sent: {importResult.friendsRequested.length}
                            {importResult.friendsSkipped.length > 0 && ` (${importResult.friendsSkipped.length} skipped)`}
                          </p>
                          <p style={{ margin: '4px 0' }}>
                            Servers rejoined: {importResult.serversRejoined.length}
                            {importResult.serversSkipped.length > 0 && ` (${importResult.serversSkipped.length} skipped)`}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <hr />

              <div id="data-privacy-profile" ref={dataPrivacyProfileRef} style={{ marginTop: '20px' }}>
                <h3>Profile Privacy</h3>
                <p style={{ color: 'gray' }}>Control who can see your full profile info — like your bio and connected accounts.</p>

                <div style={{ marginTop: '14px' }}>
                  <strong>Share my full profile with</strong>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="profile-privacy"
                      checked={profilePrivacy === 'all_servers'}
                      disabled={profilePrivacySaving}
                      onChange={() => saveProfilePrivacy('all_servers')}
                    />
                    {' '}<strong>All Servers</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Your full profile is visible to anyone in a server you're in.</p>
                  </label>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="profile-privacy"
                      checked={profilePrivacy === 'all_friends'}
                      disabled={profilePrivacySaving}
                      onChange={() => saveProfilePrivacy('all_friends')}
                    />
                    {' '}<strong>All Friends</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Your full profile is visible to any of your friends. Everyone else sees a limited version.</p>
                  </label>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="profile-privacy"
                      checked={profilePrivacy === 'specific_friends'}
                      disabled={profilePrivacySaving}
                      onChange={() => saveProfilePrivacy('specific_friends')}
                    />
                    {' '}<strong>Specific Friends</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Choose exactly which friends can see your full profile. Everyone else sees a limited version.</p>
                  </label>

                  {profilePrivacy === 'specific_friends' && (
                    <div style={{ marginLeft: '22px', marginTop: '10px', maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px' }}>
                      {friendsList.length === 0 && <p style={{ color: 'gray', margin: 0 }}>You don't have any friends yet.</p>}
                      {friendsList.map((friend) => (
                        <label key={friend.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                          <input
                            type="checkbox"
                            checked={profilePrivacyFriendIds.includes(friend.id)}
                            onChange={() => toggleProfilePrivacyFriend(friend.id)}
                          />
                          {friend.name} (@{friend.username})
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                  <div>
                    <strong>Share when I update my profile</strong>
                    <p style={{ margin: 0, color: 'gray' }}>Allow friends to receive a notification when you update your profile.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={profileShareUpdates}
                    disabled={profilePrivacySaving}
                    onChange={toggleProfileShareUpdates}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                  <div>
                    <strong>Notify friends when I change status</strong>
                    <p style={{ margin: 0, color: 'gray' }}>Off by default. When off, changing your status never notifies anyone — it just updates how you appear.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={statusBroadcast}
                    disabled={profilePrivacySaving}
                    onChange={toggleStatusBroadcast}
                  />
                </div>

                {statusBroadcast && (
                  <div style={{ marginTop: '16px', marginLeft: '0' }}>
                    <strong>Who can receive my status updates</strong>
                    <label style={{ display: 'block', marginTop: '8px' }}>
                      <input
                        type="radio"
                        name="status-audience"
                        checked={statusAudience === 'friends'}
                        disabled={profilePrivacySaving}
                        onChange={() => saveStatusAudience('friends')}
                      />
                      {' '}<strong>Friends</strong>
                    </label>
                    <label style={{ display: 'block', marginTop: '8px' }}>
                      <input
                        type="radio"
                        name="status-audience"
                        checked={statusAudience === 'server_members'}
                        disabled={profilePrivacySaving}
                        onChange={() => saveStatusAudience('server_members')}
                      />
                      {' '}<strong>Friends & Server Members</strong>
                      <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Friends, plus anyone who shares a server with you.</p>
                    </label>
                    <label style={{ display: 'block', marginTop: '8px' }}>
                      <input
                        type="radio"
                        name="status-audience"
                        checked={statusAudience === 'everyone'}
                        disabled={profilePrivacySaving}
                        onChange={() => saveStatusAudience('everyone')}
                      />
                      {' '}<strong>Everyone</strong>
                    </label>
                  </div>
                )}

                <div style={{ marginTop: '20px' }}>
                  <strong>Servers you have in common</strong>
                  <p style={{ margin: '2px 0 0', color: 'gray' }}>Choose who can see the servers you and they are both in, on your profile.</p>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="mutual-servers-visibility"
                      checked={mutualServersVisibility === 'everyone'}
                      disabled={profilePrivacySaving}
                      onChange={() => saveMutualServersVisibility('everyone')}
                    />
                    {' '}<strong>Everyone</strong>
                  </label>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="mutual-servers-visibility"
                      checked={mutualServersVisibility === 'server_members'}
                      disabled={profilePrivacySaving}
                      onChange={() => saveMutualServersVisibility('server_members')}
                    />
                    {' '}<strong>Server Members</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Only people who already share a server with you can see them.</p>
                  </label>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="mutual-servers-visibility"
                      checked={mutualServersVisibility === 'friends'}
                      disabled={profilePrivacySaving}
                      onChange={() => saveMutualServersVisibility('friends')}
                    />
                    {' '}<strong>Friends</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Only your friends can see them.</p>
                  </label>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="mutual-servers-visibility"
                      checked={mutualServersVisibility === 'nobody'}
                      disabled={profilePrivacySaving}
                      onChange={() => saveMutualServersVisibility('nobody')}
                    />
                    {' '}<strong>Nobody</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Hide the servers you have in common from everyone.</p>
                  </label>
                </div>
              </div>

              <hr />

              <div id="data-privacy-encryption" ref={dataPrivacyEncryptionRef} style={{ marginTop: '20px' }}>
                <h3>DM End-to-End Encryption</h3>
                <p style={{ color: 'gray' }}>
                  Your direct messages are end-to-end encrypted in transit and at rest — Orbit's servers never read your DMs during normal use. In rare cases, Orbit staff can decrypt a specific reported conversation ONLY if you've explicitly consented to that review request. If you decline, your messages stay private, with no other way to access them.
                </p>
                <p style={{ color: 'gray' }}>
                  Your direct messages are end-to-end encrypted — Orbit's servers never see the plaintext content, only the encrypted payload. Each account has one permanent encryption keypair used for all DMs.
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px' }}>
                  <div>
                    <strong>Reset your encryption key</strong>
                    <p style={{ margin: 0, color: 'gray' }}>Only use this if your DMs are stuck showing "[Unable to decrypt this message]" and support has told you your key is unrecoverable.</p>
                  </div>
                  <button
                    onClick={() => setShowResetKeyConfirm(true)}
                    style={{ backgroundColor: '#e53935', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '4px' }}
                  >
                    Reset Encryption Key
                  </button>
                </div>

                {showResetKeyConfirm && (
                  <div style={{ marginTop: '15px' }}>
                    <p style={{ color: 'red' }}>
                      This is permanent and cannot be undone — every DM you've ever sent or received will become permanently unreadable. Type your username ({user.username}) to confirm.
                    </p>
                    <input
                      type="text"
                      value={resetKeyConfirmInput}
                      onChange={(e) => setResetKeyConfirmInput(e.target.value)}
                      placeholder="Type your username"
                    />
                    <button onClick={handleResetKey} disabled={resetKeyConfirmInput !== user.username || resettingKey}>
                      {resettingKey ? 'Resetting...' : 'Confirm Reset'}
                    </button>
                    <button onClick={() => { setShowResetKeyConfirm(false); setResetKeyConfirmInput('') }} style={{ marginLeft: '6px' }}>
                      Cancel
                    </button>
                    {resetKeyError && <p style={{ color: 'red' }}>{resetKeyError}</p>}
                  </div>
                )}

                {resetKeySuccess && <p style={{ color: 'var(--teal)', marginTop: '15px' }}>{resetKeySuccess}</p>}
              </div>
            </div>
          )}

          {section === 'messaging-permissions' && (
            <div
              ref={msgPermScrollRef}
              onScroll={handleMsgPermScroll}
              style={{ height: '100%', overflowY: 'auto' }}
            >
              <h2>Messaging Permissions</h2>
              <p style={{ color: 'gray' }}>Control who can message you, add you, and what gets filtered.</p>

              <div id="msgperm-content-filters" ref={msgPermContentFiltersRef} style={{ marginTop: '20px' }}>
                <h3>Content Filters</h3>
                <p style={{ color: 'gray' }}>Control which images get blurred by default in servers and DMs.</p>

                <div style={{ marginTop: '14px' }}>
                  <strong>Blur images from</strong>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="content-filter-media"
                      checked={contentFilterMedia === 'show_all'}
                      disabled={contentFilterSaving}
                      onChange={() => saveContentFilterMedia('show_all')}
                    />
                    {' '}<strong>Nobody</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Show all images normally.</p>
                  </label>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="content-filter-media"
                      checked={contentFilterMedia === 'blur_non_friends'}
                      disabled={contentFilterSaving}
                      onChange={() => saveContentFilterMedia('blur_non_friends')}
                    />
                    {' '}<strong>Non-friends</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Blur images from anyone who isn't your friend, until you click to view.</p>
                  </label>

                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <input
                      type="radio"
                      name="content-filter-media"
                      checked={contentFilterMedia === 'blur_all'}
                      disabled={contentFilterSaving}
                      onChange={() => saveContentFilterMedia('blur_all')}
                    />
                    {' '}<strong>Everyone</strong>
                    <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Blur every image by default, friend or not, until you click to view.</p>
                  </label>
                </div>

                <p style={{ color: 'gray', marginTop: '20px' }}>
                  Explicit image scanning runs automatically for every account and can't be turned off right now — this will become an optional setting for age-verified accounts once that system exists.
                </p>
              </div>

              <hr />

              <div id="msgperm-spam-filters" ref={msgPermSpamFiltersRef} style={{ marginTop: '20px' }}>
                <h3>Spam Filters</h3>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>Block links from non-friends</strong>
                    <p style={{ margin: 0, color: 'gray' }}>Messages containing a link from someone who isn't your friend get hidden behind a warning until you choose to view them.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={spamFilterBlockLinks}
                    disabled={spamFilterSaving}
                    onChange={toggleSpamFilterBlockLinks}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                  <div>
                    <strong>Hide rapid-fire messages</strong>
                    <p style={{ margin: 0, color: 'gray' }}>When someone sends a burst of messages in a row, collapse the extras behind a "show" button.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={spamFilterRateLimit}
                    disabled={spamFilterSaving}
                    onChange={toggleSpamFilterRateLimit}
                  />
                </div>

                <div style={{ marginTop: '16px' }}>
                  <strong>Blocked keywords</strong>
                  <p style={{ margin: '2px 0 6px', color: 'gray' }}>Messages containing any of these words are hidden behind a warning. One per line or comma-separated. Matching is case-insensitive.</p>
                  <textarea
                    value={spamFilterKeywords}
                    disabled={spamFilterSaving}
                    onChange={(e) => setSpamFilterKeywords(e.target.value)}
                    rows={3}
                    style={{ width: '100%' }}
                    placeholder={'e.g.\nfree nitro\ncrypto giveaway'}
                  />
                  <button
                    className="btn-primary"
                    onClick={saveSpamFilterKeywords}
                    disabled={spamFilterSaving || spamFilterKeywords === spamFilterKeywordsSaved}
                    style={{ marginTop: '6px' }}
                  >
                    Save keywords
                  </button>
                </div>

                <p style={{ color: 'gray', marginTop: '16px', fontSize: '0.85em' }}>
                  These filters affect what you see. Messages that look abusive are also rate-limited on the server for everyone.
                </p>
              </div>

              <hr />

              <div id="msgperm-direct-messages" ref={msgPermDirectMessagesRef} style={{ marginTop: '20px' }}>
                <h3>Direct Messages</h3>
                <p style={{ color: 'gray' }}>Choose who can start a DM conversation with you.</p>

                <label style={{ display: 'block', marginTop: '10px' }}>
                  <input
                    type="radio"
                    name="dm-privacy"
                    checked={dmPrivacy === 'everyone'}
                    disabled={dmPrivacySaving}
                    onChange={() => saveDmPrivacy('everyone')}
                  />
                  {' '}<strong>Everyone</strong>
                  <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Anyone, friend or not, can message you directly.</p>
                </label>

                <label style={{ display: 'block', marginTop: '10px' }}>
                  <input
                    type="radio"
                    name="dm-privacy"
                    checked={dmPrivacy === 'friends_only'}
                    disabled={dmPrivacySaving}
                    onChange={() => saveDmPrivacy('friends_only')}
                  />
                  {' '}<strong>Friends Only</strong>
                  <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Only your friends can message you directly.</p>
                </label>

                <label style={{ display: 'block', marginTop: '10px' }}>
                  <input
                    type="radio"
                    name="dm-privacy"
                    checked={dmPrivacy === 'request_to_dm'}
                    disabled={dmPrivacySaving}
                    onChange={() => saveDmPrivacy('request_to_dm')}
                  />
                  {' '}<strong>Request to DM</strong>
                  <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>
                    Friends can message you directly. Anyone else has to send a request first, which you can accept, decline, or ignore.
                  </p>
                </label>

                <label style={{ display: 'block', marginTop: '10px' }}>
                  <input
                    type="radio"
                    name="dm-privacy"
                    checked={dmPrivacy === 'no_one'}
                    disabled={dmPrivacySaving}
                    onChange={() => saveDmPrivacy('no_one')}
                  />
                  {' '}<strong>No One</strong>
                  <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Nobody can start a new DM conversation with you.</p>
                </label>
              </div>

              <hr />

              <div id="msgperm-friend-requests" ref={msgPermFriendRequestsRef} style={{ marginTop: '20px' }}>
                <h3>Friend Requests</h3>
                <p style={{ color: 'gray' }}>Choose who can send you a friend request.</p>

                <label style={{ display: 'block', marginTop: '10px' }}>
                  <input
                    type="radio"
                    name="friend-request-privacy"
                    checked={friendRequestPrivacy === 'everyone'}
                    disabled={friendRequestPrivacySaving}
                    onChange={() => saveFriendRequestPrivacy('everyone')}
                  />
                  {' '}<strong>Everyone</strong>
                  <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Anyone can send you a friend request.</p>
                </label>

                <label style={{ display: 'block', marginTop: '10px' }}>
                  <input
                    type="radio"
                    name="friend-request-privacy"
                    checked={friendRequestPrivacy === 'friends_of_friends'}
                    disabled={friendRequestPrivacySaving}
                    onChange={() => saveFriendRequestPrivacy('friends_of_friends')}
                  />
                  {' '}<strong>Friends of Friends</strong>
                  <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Only people who share a mutual friend with you can send a request.</p>
                </label>

                <label style={{ display: 'block', marginTop: '10px' }}>
                  <input
                    type="radio"
                    name="friend-request-privacy"
                    checked={friendRequestPrivacy === 'no_one'}
                    disabled={friendRequestPrivacySaving}
                    onChange={() => saveFriendRequestPrivacy('no_one')}
                  />
                  {' '}<strong>No One</strong>
                  <p style={{ margin: '2px 0 0 22px', color: 'gray' }}>Nobody can send you a friend request.</p>
                </label>
              </div>

              <hr />

              <div id="msgperm-ignore-block" ref={msgPermIgnoreBlockRef} style={{ marginTop: '20px' }}>
                <h3>Ignore & Block</h3>
                <p style={{ color: 'gray' }}>People you've blocked can't message you, see your profile, or interact with you.</p>

                {blockedUsers.length === 0 ? (
                  <p style={{ color: 'gray', marginTop: '10px' }}>You haven't blocked anyone.</p>
                ) : (
                  <div style={{ marginTop: '10px' }}>
                    {blockedUsers.map((b) => (
                      <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {b.expand?.blocked?.avatar ? (
                            <img src={pb.files.getURL(b.expand.blocked, b.expand.blocked.avatar, { thumb: '32x32' })} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--surface-2)' }} />
                          )}
                          <div>
                            <div>{b.expand?.blocked?.name || 'Unknown'}</div>
                            <div style={{ color: 'gray', fontSize: '0.85em' }}>@{b.expand?.blocked?.username}</div>
                          </div>
                        </div>
                        <button onClick={() => handleUnblock(b.id)} disabled={unblockingId === b.id}>
                          {unblockingId === b.id ? 'Unblocking...' : 'Unblock'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {section === 'system' && (
            <div>
              <h2>System</h2>
              <p className="settings-intro">Control how Orbit behaves on your device.</p>

              <SettingsSection
                title="Notifications"
                description="Desktop notifications appear even when Orbit is in the background."
              >
                <SettingToggle
                  label="Desktop notifications"
                  description="Show a system notification for new DMs and mentions when Orbit isn't focused."
                  checked={desktopNotifications}
                  disabled={systemSaving}
                  onChange={handleToggleDesktopNotifications}
                />
                {systemNotice && <p className="settings-note settings-note-warn">{systemNotice}</p>}
              </SettingsSection>

              <SettingsSection
                title="Desktop app"
                description="These preferences are read by the Orbit desktop client."
              >
                <SettingToggle
                  label="Hardware acceleration"
                  description="Use your GPU for smoother rendering. Turn off if you see display glitches."
                  checked={hardwareAcceleration}
                  disabled={systemSaving}
                  onChange={() => saveSystemPref('hardware_acceleration', !hardwareAcceleration, setHardwareAcceleration, hardwareAcceleration)}
                />
                <SettingToggle
                  label="Start minimized"
                  description="Open Orbit minimized to the tray instead of showing the window."
                  checked={startMinimized}
                  disabled={systemSaving}
                  onChange={() => saveSystemPref('start_minimized', !startMinimized, setStartMinimized, startMinimized)}
                />
              </SettingsSection>
            </div>
          )}

          {section === 'language' && (
            <div>
              <h2>Language &amp; Time</h2>
              <p className="settings-intro">Choose how dates and times are displayed across Orbit.</p>

              <SettingsSection title="Language">
                <SettingField label="Display language" description="Used for dates, times, and numbers.">
                  <select
                    value={locale}
                    disabled={languageSaving}
                    onChange={(e) => saveLanguagePref('locale', e.target.value, setLocale, locale)}
                  >
                    <option value="system">System default</option>
                    {LOCALES.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </SettingField>
              </SettingsSection>

              <SettingsSection title="Time format">
                <SettingRadio name="time-format" value="auto" current={timeFormat} label="Auto" description="Match your device." disabled={languageSaving} onChange={(v) => saveLanguagePref('time_format', v, setTimeFormat, timeFormat)} />
                <SettingRadio name="time-format" value="12h" current={timeFormat} label="12-hour" description="e.g. 1:30 PM" disabled={languageSaving} onChange={(v) => saveLanguagePref('time_format', v, setTimeFormat, timeFormat)} />
                <SettingRadio name="time-format" value="24h" current={timeFormat} label="24-hour" description="e.g. 13:30" disabled={languageSaving} onChange={(v) => saveLanguagePref('time_format', v, setTimeFormat, timeFormat)} />
              </SettingsSection>

              <SettingsSection title="Date format">
                <SettingRadio name="date-format" value="auto" current={dateFormat} label="Auto" description="Match your device." disabled={languageSaving} onChange={(v) => saveLanguagePref('date_format', v, setDateFormat, dateFormat)} />
                <SettingRadio name="date-format" value="mdy" current={dateFormat} label="Month / Day / Year" disabled={languageSaving} onChange={(v) => saveLanguagePref('date_format', v, setDateFormat, dateFormat)} />
                <SettingRadio name="date-format" value="dmy" current={dateFormat} label="Day / Month / Year" disabled={languageSaving} onChange={(v) => saveLanguagePref('date_format', v, setDateFormat, dateFormat)} />
                <SettingRadio name="date-format" value="ymd" current={dateFormat} label="Year / Month / Day" disabled={languageSaving} onChange={(v) => saveLanguagePref('date_format', v, setDateFormat, dateFormat)} />
              </SettingsSection>

              <SettingsSection title="Preview">
                <p className="settings-preview">
                  {formatDateTime(new Date(), { locale, timeFormat, dateFormat })}
                </p>
              </SettingsSection>
            </div>
          )}

          {section === 'games' && (
            <div>
              <h2>Registered Games</h2>
              <p className="settings-intro">
                Orbit doesn't auto-detect apps yet. Set an activity to display on your profile.
              </p>

              <SettingsSection title="Current activity">
                <SettingField label="Activity" description="For example, “Playing Minecraft”. Up to 128 characters.">
                  <input
                    type="text"
                    value={customActivity}
                    maxLength={128}
                    placeholder="What are you up to?"
                    disabled={activitySaving}
                    onChange={(e) => setCustomActivity(e.target.value)}
                  />
                  <button
                    className="btn-primary"
                    disabled={activitySaving || customActivity.trim() === customActivitySaved}
                    onClick={saveCustomActivity}
                  >
                    Save
                  </button>
                </SettingField>
                <SettingToggle
                  label="Show my activity on my profile"
                  description="Display the activity above to the people allowed to see it."
                  checked={showActivity}
                  disabled={activitySaving}
                  onChange={toggleShowActivity}
                />
              </SettingsSection>
            </div>
          )}

          {section === 'activity-privacy' && (
            <div>
              <h2>Activity Privacy</h2>
              <p className="settings-intro">Control who can see the activity you set in Registered Games.</p>

              <SettingsSection title="Who can see my activity">
                <SettingRadio name="activity-visibility" value="everyone" current={activityVisibility} label="Everyone" description="Anyone who can view your profile." disabled={activitySaving} onChange={saveActivityVisibility} />
                <SettingRadio name="activity-visibility" value="friends" current={activityVisibility} label="Friends" description="Only people on your friends list." disabled={activitySaving} onChange={saveActivityVisibility} />
                <SettingRadio name="activity-visibility" value="nobody" current={activityVisibility} label="Nobody" description="Hide your activity from everyone." disabled={activitySaving} onChange={saveActivityVisibility} />
              </SettingsSection>

              <SettingsSection title="Status">
                <p className="settings-section-hint">
                  Your online status is separate — change it from the status picker on your avatar. Notification behaviour is controlled under Notifications.
                </p>
              </SettingsSection>
            </div>
          )}

          {section === 'apps' && (
            <div>
              <h2>Connected Apps</h2>
              <p className="settings-intro">Third-party accounts linked to your Orbit account.</p>

              <SettingsSection title="Linked accounts">
                {!connectedLoaded && <p className="settings-section-hint">Loading…</p>}
                {connectedLoaded && connectedAccounts.length === 0 && (
                  <p className="settings-section-hint">
                    No connected accounts. When account linking is available, linked apps will appear here.
                  </p>
                )}
                {connectedAccounts.map((account) => (
                  <div key={account.id} className="settings-row">
                    <span className="settings-row-text">
                      <span className="settings-row-label">
                        {account.display_name || account.username || account.provider}
                      </span>
                      <span className="settings-row-desc">
                        {account.provider}
                        {account.username ? ` · @${account.username}` : ''}
                        {account.verified ? ' · verified' : ''}
                      </span>
                    </span>
                    <span className="settings-row-control">
                      <button
                        className="settings-danger-btn"
                        disabled={disconnectingId === account.id}
                        onClick={() => handleDisconnectAccount(account)}
                      >
                        {disconnectingId === account.id ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </span>
                  </div>
                ))}
              </SettingsSection>
            </div>
          )}
          {section === 'orbit-plus' && <BadgeShowcase user={user} onGetPlan={onOpenBilling} />}
          {section === 'server-boosts' && (
            <ServerBoostsInfo user={user} onChoosePlan={onOpenBilling} onBoostServer={onBoostServer} />
          )}
          {section === 'subscriptions' && <SubscriptionsInfo user={user} onChoosePlan={onOpenBilling} />}
          {section === 'gifts' && <GiftInventoryInfo />}
          {section === 'billing' && <BillingInfo user={user} onChoosePlan={onOpenBilling} />}

          {section === 'notifications' && (
            <div>
              <h2>Notifications</h2>
              <p className="settings-intro">Choose what Orbit notifies you about and how loudly.</p>

              <SettingsSection title="Alerts">
                <SettingToggle
                  label="Message sound"
                  description="Play a sound when you receive a new message."
                  checked={notifMessageSound}
                  disabled={notifSaving}
                  onChange={() => toggleNotifSetting('notif_message_sound', notifMessageSound, setNotifMessageSound)}
                />
                <SettingToggle
                  label="Friends coming online"
                  description="Get notified when a friend comes online."
                  checked={notifFriendsOnline}
                  disabled={notifSaving}
                  onChange={() => toggleNotifSetting('notif_friends_online', notifFriendsOnline, setNotifFriendsOnline)}
                />
              </SettingsSection>

              <SettingsSection
                title="Notification mode"
                description="Separate from your status — you can appear online while keeping sounds off."
              >
                <SettingRadio name="notification-mode" value="normal" current={notificationMode} label="Normal" description="Sounds and unread badges work normally." disabled={notifSaving} onChange={saveNotificationMode} />
                <SettingRadio name="notification-mode" value="quiet" current={notificationMode} label="Quiet" description="No notification sounds, but unread badges still show." disabled={notifSaving} onChange={saveNotificationMode} />
                <SettingRadio name="notification-mode" value="mute_all" current={notificationMode} label="Mute all" description="No sounds and no unread badges. Use when you want zero notifications." disabled={notifSaving} onChange={saveNotificationMode} />
              </SettingsSection>

              <SettingsSection title="Custom notification sound">
                {hasPlan ? (
                  <>
                    <p className="settings-section-hint">Replaces the default sound for all your notifications.</p>
                    {user.notification_sound && <p className="settings-note" style={{ color: 'lightgreen' }}>Custom sound active</p>}
                    <input type="file" accept="audio/*" onChange={handleSoundUpload} disabled={soundUploading} />
                    {user.notification_sound && (
                      <button onClick={handleRemoveSound} disabled={soundUploading} style={{ marginLeft: '10px' }}>Remove</button>
                    )}
                    {soundUploading && <p className="settings-section-hint">Uploading…</p>}
                    {soundError && <p className="settings-note settings-note-warn">{soundError}</p>}
                  </>
                ) : (
                  <p className="settings-section-hint">Custom notification sounds are an Orbit+/Premium perk.</p>
                )}
              </SettingsSection>
            </div>
          )}

          {section === 'accessibility' && (
            <div>
              <h2>{t('a11y.title')}</h2>
              <p className="settings-intro">Tune Orbit's readability, density and contrast. The preview follows you as you scroll.</p>

              <div className="a11y-preview-sticky">
                <AccessibilityPreview
                  settings={{
                    textSize,
                    underlineLinks: alwaysUnderlineLinks,
                    displayNameStyles,
                    density: uiDensity,
                    messageDisplay,
                    messageGroupSpacing,
                    saturation,
                    highContrast,
                    roleColourDisplay,
                    officialMessagesStyle,
                    showOnOffIndicators,
                    reducedMotion,
                  }}
                />
              </div>

              <SettingsSection title="Text Readability">
                <SettingSlider
                  label="Text size in chat"
                  description="Adjust the size of the chat font."
                  value={textSize}
                  min={12}
                  max={24}
                  ticks={[12, 14, 16, 18, 20, 24]}
                  unit="px"
                  disabled={accessibilitySaving}
                  onChange={saveTextSize}
                />
                <SettingToggle
                  label="Always underline links"
                  description="Make links stand out more."
                  checked={alwaysUnderlineLinks}
                  disabled={accessibilitySaving}
                  onChange={() => saveA11yPref('always_underline_links', !alwaysUnderlineLinks, setAlwaysUnderlineLinks, alwaysUnderlineLinks)}
                />
                <SettingToggle
                  label="Display name styles"
                  description="Show display-name styles — including font, effect and colour."
                  checked={displayNameStyles}
                  disabled={accessibilitySaving}
                  onChange={() => saveA11yPref('display_name_styles', !displayNameStyles, setDisplayNameStyles, displayNameStyles)}
                />
              </SettingsSection>

              <SettingsSection title="Visual Density">
                <div className="settings-group-label">
                  <span className="settings-row-label">UI Density</span>
                  <span className="settings-row-desc">Adjust the space between server, channel and member lists.</span>
                </div>
                <SettingRadio name="ui-density" value="compact" current={uiDensity} label="Compact" disabled={accessibilitySaving} onChange={saveUiDensity} />
                <SettingRadio name="ui-density" value="comfortable" current={uiDensity} label="Default" disabled={accessibilitySaving} onChange={saveUiDensity} />
                <SettingRadio name="ui-density" value="spacious" current={uiDensity} label="Spacious" disabled={accessibilitySaving} onChange={saveUiDensity} />

                <div className="settings-group-label">
                  <span className="settings-row-label">Chat Message Display</span>
                  <span className="settings-row-desc">Change the appearance of chat messages.</span>
                </div>
                <SettingRadio name="message-display" value="default" current={messageDisplay} label="Default" disabled={accessibilitySaving} onChange={(v) => saveA11yPref('message_display', v, setMessageDisplay, messageDisplay)} />
                <SettingRadio name="message-display" value="compact" current={messageDisplay} label="Compact" disabled={accessibilitySaving} onChange={(v) => saveA11yPref('message_display', v, setMessageDisplay, messageDisplay)} />

                <SettingSlider
                  label="Space Between Message Groups"
                  description="Adjust the spacing between message groups."
                  value={messageGroupSpacing}
                  min={0}
                  max={24}
                  ticks={[0, 4, 8, 16, 24]}
                  unit="px"
                  disabled={accessibilitySaving}
                  onChange={(v) => saveA11yPref('message_group_spacing', v, setMessageGroupSpacing, messageGroupSpacing)}
                />
                <SettingSlider
                  label="Zoom level"
                  description="Adjust the size of the interface. You can also change this with Ctrl +/-."
                  value={zoomLevel}
                  min={50}
                  max={200}
                  step={5}
                  ticks={[50, 80, 100, 125, 150, 200]}
                  unit="%"
                  disabled={accessibilitySaving}
                  onChange={(v) => saveA11yPref('zoom_level', v, setZoomLevel, zoomLevel)}
                />
              </SettingsSection>

              <SettingsSection title="Colour & Contrast">
                <SettingSlider
                  label="Saturation"
                  description="Reduce the saturation of colours within the app, for those with colour sensitivities. This does not affect the saturation of images, videos, role colours or other user content."
                  value={saturation}
                  min={0}
                  max={100}
                  step={5}
                  ticks={[0, 20, 40, 60, 80, 100]}
                  unit="%"
                  disabled={accessibilitySaving}
                  onChange={(v) => saveA11yPref('saturation', v, setSaturation, saturation)}
                />
                <SettingToggle
                  label="Apply saturation setting to custom colours"
                  description="Apply the above setting to custom colour choices, like role colours."
                  checked={saturationCustomColours}
                  disabled={accessibilitySaving}
                  onChange={() => saveA11yPref('saturation_custom_colours', !saturationCustomColours, setSaturationCustomColours, saturationCustomColours)}
                />
                <SettingToggle
                  label="Enable High Contrast Mode"
                  description="Enhance visibility with bold colours and sharp contrast."
                  checked={highContrast}
                  disabled={accessibilitySaving}
                  onChange={() => saveA11yPref('high_contrast', !highContrast, setHighContrast, highContrast)}
                />
              </SettingsSection>

              <SettingsSection title="Display">
                <SettingField label="Role Colours" description="Choose how you would like role colours to be displayed.">
                  <select
                    value={roleColourDisplay}
                    disabled={accessibilitySaving}
                    onChange={(e) => saveA11yPref('role_colour_display', e.target.value, setRoleColourDisplay, roleColourDisplay)}
                  >
                    <option value="in_names">In names</option>
                    <option value="next_to_names">Next to names</option>
                    <option value="none">Don't show role colours</option>
                  </select>
                </SettingField>
                <SettingField label="Official Messages" description="Choose how official developer messages look on verified servers that support it.">
                  <select
                    value={officialMessagesStyle}
                    disabled={accessibilitySaving}
                    onChange={(e) => saveA11yPref('official_messages_style', e.target.value, setOfficialMessagesStyle, officialMessagesStyle)}
                  >
                    <option value="default">Default</option>
                    <option value="no_text_colour">No text colour</option>
                    <option value="no_background">No background colour</option>
                    <option value="none">No styling</option>
                  </select>
                </SettingField>
                <SettingToggle
                  label="Show on/off indicators"
                  description="On forms, menus and settings, on/off toggles will have icons."
                  checked={showOnOffIndicators}
                  disabled={accessibilitySaving}
                  onChange={() => saveA11yPref('show_on_off_indicators', !showOnOffIndicators, setShowOnOffIndicators, showOnOffIndicators)}
                />
              </SettingsSection>

              <SettingsSection title="Motion">
                <SettingToggle
                  label="Reduced motion"
                  description="Reduce animations and transitions across Orbit."
                  checked={reducedMotion}
                  disabled={accessibilitySaving}
                  onChange={toggleReducedMotion}
                />
              </SettingsSection>
            </div>
          )}

          {section === 'voice' && (
            <div>
              <h2>Voice &amp; Video</h2>
              <p className="settings-intro">Choose which microphone and camera Orbit uses when you join a voice channel.</p>

              <SettingsSection title="Devices">
                <SettingField label="Microphone" description="Used when you join a voice channel.">
                  <select value={selectedMicId} onChange={(e) => saveDevicePreference('mic', e.target.value)}>
                    {microphones.length === 0 && <option value="">No microphones found</option>}
                    {microphones.map((mic) => (
                      <option key={mic.deviceId} value={mic.deviceId}>{mic.label || 'Microphone'}</option>
                    ))}
                  </select>
                </SettingField>
                <SettingField label="Camera" description="Used when you turn on video.">
                  <select value={selectedCameraId} onChange={(e) => saveDevicePreference('camera', e.target.value)}>
                    {cameras.length === 0 && <option value="">No cameras found</option>}
                    {cameras.map((cam) => (
                      <option key={cam.deviceId} value={cam.deviceId}>{cam.label || 'Camera'}</option>
                    ))}
                  </select>
                </SettingField>
                {deviceError && <p className="settings-note settings-note-warn">{deviceError}</p>}
              </SettingsSection>

              <SettingsSection
                title="Voice Messages"
                description="Voice-message recording and playback is a mobile feature. These account preferences are read by the mobile client."
              >
                <SettingToggle
                  label="Allow sending voice messages"
                  description="Turn off to disable the record button on clients that support voice messages."
                  checked={voiceNotesSend}
                  disabled={voicePrefSaving}
                  onChange={() => toggleVoiceNotePref('voice_notes_send', voiceNotesSend, setVoiceNotesSend)}
                />
                <SettingToggle
                  label="Allow receiving voice messages"
                  description="Turn off to reject incoming voice messages."
                  checked={voiceNotesReceive}
                  disabled={voicePrefSaving}
                  onChange={() => toggleVoiceNotePref('voice_notes_receive', voiceNotesReceive, setVoiceNotesReceive)}
                />
              </SettingsSection>
            </div>
          )}

          {section === 'appearance' && (
            <div>
              <h2>Appearance</h2>
              <p className="settings-intro">Customise how Orbit looks.</p>

              <SettingsSection title="Theme">
                <div style={{ display: 'flex', gap: '10px', padding: '4px 0 8px' }}>
                  <button
                    onClick={() => handleThemeChange('dark')}
                    disabled={themeSaving}
                    style={{ fontWeight: currentTheme === 'dark' ? 'bold' : 'normal', border: currentTheme === 'dark' ? '2px solid var(--accent)' : '1px solid var(--border)' }}
                  >
                    🌙 Dark
                  </button>
                  <button
                    onClick={() => handleThemeChange('light')}
                    disabled={themeSaving}
                    style={{ fontWeight: currentTheme === 'light' ? 'bold' : 'normal', border: currentTheme === 'light' ? '2px solid var(--accent)' : '1px solid var(--border)' }}
                  >
                    ☀️ Light
                  </button>
                </div>
                <p className="settings-section-hint">More theme options are coming for Orbit+ and Premium subscribers.</p>
              </SettingsSection>

              <SettingsSection title="Density" description="Compact reduces padding and message spacing; Spacious adds more room.">
                <SettingRadio name="appearance-density" value="compact" current={uiDensity} label="Compact" disabled={appearanceSaving} onChange={saveUiDensity} />
                <SettingRadio name="appearance-density" value="comfortable" current={uiDensity} label="Default" disabled={appearanceSaving} onChange={saveUiDensity} />
                <SettingRadio name="appearance-density" value="spacious" current={uiDensity} label="Spacious" disabled={appearanceSaving} onChange={saveUiDensity} />
              </SettingsSection>

              <SettingsSection title="Messages">
                <SettingToggle
                  label="Convert ASCII emoticons"
                  description="Turn text like :) or <3 into emoji when you send a message."
                  checked={asciiEmoticons}
                  disabled={appearanceSaving}
                  onChange={toggleAsciiEmoticons}
                />
                {hasPlan ? (
                  <SettingToggle
                    label="Show my subscription badge"
                    description="Display your Orbit+/Premium badge on your profile and in member lists."
                    checked={!hideSubscriptionBadge}
                    disabled={appearanceSaving}
                    onChange={toggleSubscriptionBadge}
                  />
                ) : (
                  <p className="settings-note">
                    Badge visibility is an Orbit+/Premium perk, so free accounts always show
                    the standard badge.
                  </p>
                )}
              </SettingsSection>

              <SettingsSection title="Custom Background">
                {hasPlan ? (
                  <>
                    <p className="settings-section-hint">
                      Note: full visual styling is still being built app-wide — your uploaded background is saved now, and will start showing once that update rolls out.
                    </p>
                    {user.custom_background && (
                      <img
                        src={pb.files.getURL(user, user.custom_background, { thumb: '200x120' })}
                        alt="Your custom background"
                        style={{ width: '200px', height: '120px', objectFit: 'cover', display: 'block', marginBottom: '10px', borderRadius: '6px' }}
                      />
                    )}
                    <input type="file" accept="image/*" onChange={handleBackgroundUpload} disabled={backgroundUploading} />
                    {user.custom_background && (
                      <button onClick={handleRemoveBackground} disabled={backgroundUploading} style={{ marginLeft: '10px' }}>Remove</button>
                    )}
                    {backgroundUploading && <p className="settings-section-hint">Uploading…</p>}
                    {backgroundError && <p className="settings-note settings-note-warn">{backgroundError}</p>}
                  </>
                ) : (
                  <p className="settings-section-hint">Custom backgrounds are an Orbit+/Premium perk.</p>
                )}
              </SettingsSection>

              <SettingsSection title="Custom Theme">
                {isPremium ? (
                  <>
                    <p className="settings-section-hint">
                      Pick an accent color now — it's saved to your account, but won't visually apply anywhere yet until the app's full styling update ships.
                    </p>
                    <input
                      type="color"
                      value={(() => {
                        try {
                          return JSON.parse(user.custom_theme || '{}').accent || '#7c3aed'
                        } catch {
                          return '#7c3aed'
                        }
                      })()}
                      onChange={async (e) => {
                        try {
                          await pb.collection('users').update(user.id, {
                            custom_theme: JSON.stringify({ accent: e.target.value }),
                          })
                          await pb.collection('users').authRefresh()
                        } catch (err) {
                          console.error('Theme update error:', err)
                        }
                      }}
                    />
                  </>
                ) : (
                  <p className="settings-section-hint">Global custom theming is a Premium perk.</p>
                )}
              </SettingsSection>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings