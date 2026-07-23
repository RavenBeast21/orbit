import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'
import pb from './pocketbase'

// Same server that issues LiveKit tokens now also handles key storage/unlock.
const KEY_SERVER_URL = 'http://localhost:3001'

// Storage keys are scoped per user ID — localStorage is shared by the
// whole browser, so without this, switching between two Orbit accounts
// in the same browser would make them share (and silently overwrite)
// each other's keypair. This is now just a FAST-PATH CACHE for this
// device — the real source of truth is the server (encrypted_private_key
// in PocketBase, unlocked via /keys/unlock).
function storageKeys(uid) {
  return {
    priv: `orbit_privkey_${uid}`,
    pub: `orbit_pubkey_${uid}`,
  }
}

// Call this once per session (e.g. when DMs loads) to make sure the
// current user has a keypair available on THIS device.
//
// Order of operations:
// 1. Check localStorage first (fast path — no network round trip needed
//    if we already fetched/generated it earlier on this device).
// 2. If missing, ask the key server to unlock the account's real,
//    permanent private key (works on ANY device — that's the whole
//    point of this system). Cache it locally after, so next time is fast.
// 3. If the server says this account has no key at all yet (brand new
//    account), generate one now, save the public key to PocketBase
//    (as before, so others can encrypt to us) AND send the private key
//    to the key server to be encrypted+stored permanently.
export async function ensureKeypair() {
  const uid = pb.authStore.model?.id
  if (!uid) return null

  const { priv, pub } = storageKeys(uid)
  const existingPriv = localStorage.getItem(priv)
  const existingPub = localStorage.getItem(pub)

  if (existingPriv && existingPub) {
    console.log('[Orbit E2EE] Existing keypair found on this device for user', uid, '— public key:', existingPub)
    return { publicKey: existingPub, secretKey: existingPriv }
  }

  // Not on this device yet — ask the key server to unlock the real one.
  try {
    const response = await fetch(`${KEY_SERVER_URL}/keys/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pb.authStore.token }),
    })

    if (response.ok) {
      const data = await response.json()
      const secretKeyB64 = data.privateKey
      const secretKeyUint8 = naclUtil.decodeBase64(secretKeyB64)
      const publicKeyUint8 = nacl.box.keyPair.fromSecretKey(secretKeyUint8).publicKey
      const publicKeyB64 = naclUtil.encodeBase64(publicKeyUint8)

      localStorage.setItem(priv, secretKeyB64)
      localStorage.setItem(pub, publicKeyB64)

      console.log('[Orbit E2EE] Unlocked this account\'s real key from the server onto this device. Public key:', publicKeyB64)
      return { publicKey: publicKeyB64, secretKey: secretKeyB64 }
    }

    if (response.status !== 404) {
      // Some other real error (network issue, server down, invalid session, etc.)
      const errData = await response.json().catch(() => ({}))
      console.error('[Orbit E2EE] Failed to unlock key from server:', errData.error || response.status)
      return null
    }
    // 404 falls through — means "no key stored server-side for this account."
    // That does NOT necessarily mean this account is brand new — it could be
    // a pre-existing account whose public_key was set before the key server
    // existed. Check that before ever generating a replacement keypair.
  } catch (err) {
    console.error('[Orbit E2EE] Network error contacting key server:', err)
    return null
  }

  let remotePublicKey = null
  try {
    const freshUser = await pb.collection('users').getOne(uid)
    remotePublicKey = freshUser.public_key || null
  } catch (err) {
    console.error('[Orbit E2EE] Failed to check existing public key:', err)
    return null
  }

  if (remotePublicKey) {
    // This account's identity (public_key) already exists, but the key
    // server has no matching encrypted copy — meaning the real private
    // key only ever lived on some other device's localStorage and was
    // never migrated. It cannot be recovered from here. Do NOT generate
    // a replacement — that would silently change this account's identity
    // and break every message ever sent to/from it.
    console.error('[Orbit E2EE] This account already has a permanent public key, but no server-side backup exists for its private key. This device cannot recover it — the original key is unavailable. NOT generating a replacement.')
    return null
  }

  // Truly brand new account — nobody, anywhere, has a key for this user yet.
  const keyPair = nacl.box.keyPair()
  const publicKeyB64 = naclUtil.encodeBase64(keyPair.publicKey)
  const secretKeyB64 = naclUtil.encodeBase64(keyPair.secretKey)

  localStorage.setItem(priv, secretKeyB64)
  localStorage.setItem(pub, publicKeyB64)

  console.log('[Orbit E2EE] No existing key anywhere for this account — generating a brand-new permanent keypair. Public key:', publicKeyB64)

  try {
    await pb.collection('users').update(uid, {
      public_key: publicKeyB64,
    })
  } catch (err) {
    console.error('Failed to save public key to PocketBase:', err)
  }

  try {
    const storeResponse = await fetch(`${KEY_SERVER_URL}/keys/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pb.authStore.token, privateKey: secretKeyB64 }),
    })
    if (!storeResponse.ok) {
      const errData = await storeResponse.json().catch(() => ({}))
      console.error('[Orbit E2EE] Failed to store encrypted key on server:', errData.error || storeResponse.status)
    }
  } catch (err) {
    console.error('[Orbit E2EE] Network error storing key on server:', err)
  }

  return { publicKey: publicKeyB64, secretKey: secretKeyB64 }
}

export function getMyPrivateKey() {
  const uid = pb.authStore.model?.id
  if (!uid) return null

  const { priv } = storageKeys(uid)
  return localStorage.getItem(priv)
}

// Encrypts plaintext for a specific recipient. Returns a JSON string
// (nonce + ciphertext, both base64) suitable for storing directly in
// the existing `content` field.
export function encryptMessage(plaintext, theirPublicKeyB64, mySecretKeyB64) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const messageUint8 = naclUtil.decodeUTF8(plaintext)
  const theirPublicKey = naclUtil.decodeBase64(theirPublicKeyB64)
  const mySecretKey = naclUtil.decodeBase64(mySecretKeyB64)

  const encrypted = nacl.box(messageUint8, nonce, theirPublicKey, mySecretKey)

  return JSON.stringify({
    n: naclUtil.encodeBase64(nonce),
    c: naclUtil.encodeBase64(encrypted),
  })
}

// Returns { text, isEncrypted } — never throws.
// If the payload isn't our encrypted JSON shape, it's treated as
// legacy/plain content and returned as-is (isEncrypted: false).
// If it IS our shape but fails to decrypt, text is an error placeholder.
export function decryptMessage(payload, theirPublicKeyB64, mySecretKeyB64) {
  let parsed
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { text: payload, isEncrypted: false }
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.n || !parsed.c) {
    return { text: payload, isEncrypted: false }
  }

  try {
    const nonce = naclUtil.decodeBase64(parsed.n)
    const cipher = naclUtil.decodeBase64(parsed.c)
    const theirPublicKey = naclUtil.decodeBase64(theirPublicKeyB64)
    const mySecretKey = naclUtil.decodeBase64(mySecretKeyB64)

    const decrypted = nacl.box.open(cipher, nonce, theirPublicKey, mySecretKey)

    if (!decrypted) {
      return { text: '[Unable to decrypt this message]', isEncrypted: true }
    }

    return { text: naclUtil.encodeUTF8(decrypted), isEncrypted: true }
  } catch {
    return { text: '[Unable to decrypt this message]', isEncrypted: true }
  }
}