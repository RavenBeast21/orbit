import { useState, useEffect, useRef } from 'react'
import pb from '../pocketbase'
import { scanImage, loadImageFromUrl, loadImageFromDataUrl } from '../nsfwScan'
import { shouldBlurByRelationship, isFlaggedByNsfwScan } from '../contentFilters'

// One component covers both use cases:
//   - server messages: pass `src` (a normal PocketBase file URL)
//   - DM images: pass `dataUrl` (base64 data: URL, only available AFTER
//     the viewer has clicked to decrypt — see DMs.jsx's click-to-reveal,
//     which stays a separate outer gate; THIS component's own blur is a
//     second, independent layer that applies once an image is visible)
//
// Props:
//   src        - http(s) image URL (server messages)
//   dataUrl    - data: URL (DM images, already decrypted)
//   senderId   - who sent it, for relationship-based blur
//   alt
function FilteredImage({ src, dataUrl, senderId, alt }) {
  const me = pb.authStore.model
  const myUserId = me?.id

  const [relationshipBlur, setRelationshipBlur] = useState(false)
  const [nsfwFlagged, setNsfwFlagged] = useState(false)
  const [scanDone, setScanDone] = useState(false)
  const [scanFailed, setScanFailed] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const scannedRef = useRef(false)
  // Tracks real mount state, decoupled from any single effect's own
  // cleanup. React Strict Mode's dev-only mount->cleanup->remount cycle
  // was setting the scan effect's local `cancelled` flag to true during
  // the synthetic cleanup, so a scan that (correctly, thanks to
  // scannedRef) kept running across that fake remount would finish and
  // then have its result silently discarded by a stale cancelled check.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const imageUrl = dataUrl || src

  useEffect(() => {
    let cancelled = false

    const checkRelationship = async () => {
      if (!senderId || !myUserId) return
      const blur = await shouldBlurByRelationship(senderId, myUserId)
      if (!cancelled) setRelationshipBlur(blur)
    }
    checkRelationship()

    return () => { cancelled = true }
  }, [senderId, myUserId])

  useEffect(() => {
    // Scanning is mandatory for every account right now — there's no age
    // verification system yet to safely gate an opt-out behind, so
    // content_filter_nsfw_scan is ignored here on purpose (it stays on
    // the user record for when that system exists later).
    if (!imageUrl || scannedRef.current) return
    scannedRef.current = true

    const runScan = async () => {
      try {
        const img = dataUrl ? await loadImageFromDataUrl(imageUrl) : await loadImageFromUrl(imageUrl)
        const probs = await scanImage(img)
        if (!isMountedRef.current) return
        setNsfwFlagged(isFlaggedByNsfwScan(probs))
        setScanDone(true)
      } catch (err) {
        console.error('[Orbit content filter] NSFW scan failed:', err)
        if (isMountedRef.current) {
          setScanFailed(true)
          setScanDone(true)
        }
      }
    }
    runScan()
  }, [imageUrl, dataUrl])

  // While a scan is running or has failed, the image stays blurred —
  // including the failure case. The alternative (show unfiltered if the
  // model fails to load) means a broken model silently disables the
  // whole feature with no visual sign — the wrong default for a mandatory
  // safety scan.
  const scanGate = !scanDone || nsfwFlagged || scanFailed
  const shouldBlur = !revealed && (relationshipBlur || scanGate)

  if (!imageUrl) return null

  // Confirmed-flagged content is a hard block, no bypass. There's no age
  // verification system, so every account is treated as under 18 for
  // safety by default — a flagged image simply never gets shown, full
  // stop, not even via an explicit "view anyway" click. This is
  // deliberately different from the "still scanning" and "scan failed"
  // states below, which are transient/inconclusive rather than a
  // confirmed determination, and keep their existing click-through-able
  // behavior.
  const hardBlocked = scanDone && nsfwFlagged
  const clickThroughAllowed = scanDone && !scanFailed && !nsfwFlagged

  return (
    <div className="filtered-image-wrap">
      <img
        src={imageUrl}
        alt={alt || 'attachment'}
        className={`message-attachment-image${shouldBlur ? ' filtered-image-blurred' : ''}`}
        onClick={() => {
          if (hardBlocked) return // never revealable, no matter what
          if (!shouldBlur) return setRevealed(false) // click a revealed image to re-hide it
          if (clickThroughAllowed) setRevealed(true)
          // while scanGate is active (still scanning / failed), clicking
          // the image itself does nothing — only the overlay's own
          // explicit "view anyway" affordance can reveal it
        }}
      />
      {shouldBlur && (
        <div
          className="filtered-image-overlay"
          onClick={() => { if (!hardBlocked) setRevealed(true) }}
        >
          <span>
            {hardBlocked
              ? '🚫 Content blocked — flagged as inappropriate'
              : scanFailed
              ? '⚠️ Scan unavailable — click to view anyway'
              : !scanDone
              ? '🔍 Scanning...'
              : '🔒 Click to view'}
          </span>
        </div>
      )}
    </div>
  )
}

export default FilteredImage