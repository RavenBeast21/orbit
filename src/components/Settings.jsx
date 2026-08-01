// Settings.jsx
import { useState, useEffect } from 'react'
import pb from '../pocketbase'

function Settings({ onBack }) {
  const user = pb.authStore.model
  const avatarUrl = user.avatar
    ? pb.files.getURL(user, user.avatar, { thumb: '100x100' })
    : null

  const [section, setSection] = useState('account')

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

  const [microphones, setMicrophones] = useState([])
  const [cameras, setCameras] = useState([])
  const [selectedMicId, setSelectedMicId] = useState(localStorage.getItem('orbit_mic_id') || '')
  const [selectedCameraId, setSelectedCameraId] = useState(localStorage.getItem('orbit_camera_id') || '')
  const [deviceError, setDeviceError] = useState('')

  const [disabling, setDisabling] = useState(false)
  const [disableError, setDisableError] = useState('')

  const [notifMessageSound, setNotifMessageSound] = useState(user.notif_message_sound ?? true)
  const [notifFriendsOnline, setNotifFriendsOnline] = useState(user.notif_friends_online ?? true)
  const [notifSaving, setNotifSaving] = useState(false)

  const [textSize, setTextSize] = useState(user.accessibility_text_size || 16)
  const [reducedMotion, setReducedMotion] = useState(user.accessibility_reduced_motion ?? false)
  const [accessibilitySaving, setAccessibilitySaving] = useState(false)

  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')

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

  useEffect(() => {
    if (section === 'voice') {
      loadDevices()
    }
  }, [section])

  return (
    <div>
      <button onClick={onBack}>✕ Close</button>
      <h1>Settings</h1>

      <div style={{ display: 'flex' }}>
        <div style={{ minWidth: '150px' }}>
          <p><button onClick={() => setSection('account')}>Account</button></p>
          <p><button onClick={() => setSection('voice')}>Voice & Video</button></p>
          <p><button onClick={() => setSection('appearance')}>Appearance</button></p>
          <p><button onClick={() => setSection('notifications')}>Notifications</button></p>
          <p><button onClick={() => setSection('accessibility')}>Accessibility</button></p>
          <hr />
          <p><button onClick={() => setSection('billing')}>Billing</button></p>
        </div>

        <div style={{ flex: 1, paddingLeft: '20px' }}>
          {section === 'account' && (
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

              <div>
                <strong>Username:</strong>{' '}
                {editingUsername ? (
                  <>
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                    />
                    <button onClick={saveUsername} disabled={usernameSaving}>
                      {usernameSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setEditingUsername(false)}>Cancel</button>
                    {usernameError && <p style={{ color: 'red' }}>{usernameError}</p>}
                  </>
                ) : (
                  <>
                    {user.username}{' '}
                    <button onClick={startEditUsername} disabled={!canChangeUsername}>
                      Edit
                    </button>
                    {!canChangeUsername && (
                      <span style={{ color: 'gray' }}>
                        {' '}(available again in {daysRemainingForUsernameChange()} day(s))
                      </span>
                    )}
                  </>
                )}
              </div>

              <br />

              <div>
                <strong>Display Name:</strong>{' '}
                {editingName ? (
                  <>
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                    />
                    <button onClick={saveName} disabled={nameSaving}>
                      {nameSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setEditingName(false)}>Cancel</button>
                    {nameError && <p style={{ color: 'red' }}>{nameError}</p>}
                  </>
                ) : (
                  <>
                    {user.name}{' '}
                    <button onClick={startEditName}>Edit</button>
                  </>
                )}
              </div>

              <br />

              <div>
                <strong>Email:</strong>{' '}
                {editingEmail ? (
                  <div>
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
                    <button onClick={() => setEditingEmail(false)}>Cancel</button>
                    {emailError && <p style={{ color: 'red' }}>{emailError}</p>}
                    {emailSuccess && <p style={{ color: 'lightgreen' }}>{emailSuccess}</p>}
                  </div>
                ) : (
                  <>
                    {user.email}{' '}
                    <button onClick={startEditEmail}>Edit</button>
                  </>
                )}
              </div>

              <br />
              <p><strong>User ID:</strong> {user.id}</p>

              <br />
              <hr />

              <h2>Password & Security</h2>
              <div>
                {editingPassword ? (
                  <div>
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
                    <button onClick={() => setEditingPassword(false)}>Cancel</button>
                    {passwordError && <p style={{ color: 'red' }}>{passwordError}</p>}
                    {passwordSuccess && <p style={{ color: 'lightgreen' }}>{passwordSuccess}</p>}
                  </div>
                ) : (
                  <button onClick={startEditPassword}>Edit Password</button>
                )}
              </div>

              <br />
              <hr />

              <h2>Two-Factor Authentication</h2>
              <p style={{ color: 'gray' }}>
                Recommended for extra security. When enabled, you'll need to enter a one-time code sent to your email each time you log in, in addition to your password.
              </p>

              <div>
                <strong>Status:</strong> {mfaEnabled ? '✅ Enabled' : 'Disabled'}
                {' '}
                <button onClick={() => setShowMfaConfirm(true)}>
                  {mfaEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>

              {showMfaConfirm && (
                <div>
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
                  <button onClick={() => { setShowMfaConfirm(false); setMfaPasswordConfirm('') }}>
                    Cancel
                  </button>
                  {mfaError && <p style={{ color: 'red' }}>{mfaError}</p>}
                  {mfaSuccess && <p style={{ color: 'lightgreen' }}>{mfaSuccess}</p>}
                </div>
              )}
              
              <br />
              <hr />

              <h2>Account Standing</h2>

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
                  <button onClick={() => setShowDisableConfirm(false)}>Cancel</button>
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
                  <button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmInput('') }}>
                    Cancel
                  </button>
                  {deleteError && <p style={{ color: 'red' }}>{deleteError}</p>}
                </div>
              )}
            </div>
          )}

          {section === 'notifications' && (
            <div>
              <h2>Notifications</h2>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <div>
                  <strong>Message sound</strong>
                  <p style={{ margin: 0, color: 'gray' }}>Play a sound when you receive a new message.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifMessageSound}
                  disabled={notifSaving}
                  onChange={() => toggleNotifSetting('notif_message_sound', notifMessageSound, setNotifMessageSound)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Friends coming online</strong>
                  <p style={{ margin: 0, color: 'gray' }}>Get notified when a friend comes online.</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifFriendsOnline}
                  disabled={notifSaving}
                  onChange={() => toggleNotifSetting('notif_friends_online', notifFriendsOnline, setNotifFriendsOnline)}
                />
              </div>
            </div>
          )}

          {section === 'accessibility' && (
            <div>
              <h2>Accessibility</h2>

              <div>
                <strong>Text size in chat</strong>
                <p style={{ margin: 0, color: 'gray' }}>Currently: {textSize}px</p>
                <input
                  type="range"
                  min="12"
                  max="24"
                  value={textSize}
                  onChange={(e) => saveTextSize(Number(e.target.value))}
                />
              </div>

              <br />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Reduced motion</strong>
                  <p style={{ margin: 0, color: 'gray' }}>Reduce animations and transitions across Orbit.</p>
                </div>
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  disabled={accessibilitySaving}
                  onChange={toggleReducedMotion}
                />
              </div>
            </div>
          )}

          {section === 'voice' && (
            <div>
              <h2>Voice & Video</h2>
              <p>Choose which microphone and camera Orbit uses when you join a voice channel.</p>

              <div>
                <label>Microphone</label>
                <br />
                <select
                  value={selectedMicId}
                  onChange={(e) => saveDevicePreference('mic', e.target.value)}
                >
                  {microphones.length === 0 && <option value="">No microphones found</option>}
                  {microphones.map((mic) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || 'Microphone'}
                    </option>
                  ))}
                </select>
              </div>

              <br />

              <div>
                <label>Camera</label>
                <br />
                <select
                  value={selectedCameraId}
                  onChange={(e) => saveDevicePreference('camera', e.target.value)}
                >
                  {cameras.length === 0 && <option value="">No cameras found</option>}
                  {cameras.map((cam) => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label || 'Camera'}
                    </option>
                  ))}
                </select>
              </div>

              {deviceError && <p style={{ color: 'red' }}>{deviceError}</p>}
            </div>
          )}

          {section === 'appearance' && <p>Appearance — coming soon</p>}
          {section === 'billing' && (
            <div>
              <p>Billing</p>
              <button disabled>Not yet a feature, come back soon</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings