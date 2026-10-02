// PocketBase's JS SDK throws a ClientResponseError with `isAbort: true` when a
// request is auto-cancelled — either because an identical request (same request
// key) was started again, or because a component's effect ran twice under
// React StrictMode in dev. Nothing is actually broken; logging these as errors
// is pure noise that makes real failures harder to spot.
//
// Use logPbError() in request catch blocks instead of console.error(). Real
// failures (validation, permission, network) are still logged normally.
export function isAbortError(err) {
  if (!err) return false
  if (err.isAbort === true) return true
  // Older/serialized errors may not carry isAbort — fall back to the shape the
  // SDK uses for an aborted request (status 0 + "aborted" in the message).
  return err.status === 0 && typeof err.message === 'string' && /abort/i.test(err.message)
}

export function logPbError(label, err) {
  if (isAbortError(err)) return
  if (err === undefined) console.error(label)
  else console.error(label, err)
}
