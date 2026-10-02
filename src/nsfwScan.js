// IMPORTANT: onnxruntime-web is NOT imported as an ES module here.
// Every ESM import path (default bundle, /wasm subpath, resolve
// conditions, optimizeDeps tuning) hit the same wall: onnxruntime-web's
// own loader code contains a dynamic import() for its threaded/jsep
// helper file, and Vite's dev-server-side import-analysis intercepts
// and rejects that at TRANSFORM time (not in the browser) because the
// target file lives in /public. No bundler config fixes this — it's a
// fundamental mismatch between how this library loads itself and how
// Vite's dev pipeline processes ES modules.
//
// Fix: load onnxruntime-web via a plain <script> tag instead (see
// index.html — must be a non-module script placed BEFORE the app's own
// module script, so window.ort exists before this file ever runs).
// That keeps the whole library outside Vite's transform pipeline
// entirely, sidestepping the issue rather than fighting it.
//
// Setup (one-time, repeat after any onnxruntime-web version upgrade):
//   cp node_modules/onnxruntime-web/dist/ort.min.js public/ort/
//   cp node_modules/onnxruntime-web/dist/*.wasm public/ort/
// index.html, in <head>, BEFORE the module script tag:
//   <script src="/ort/ort.min.js"></script>
const ort = window.ort
if (!ort) {
  throw new Error(
    '[Orbit content filter] window.ort is not defined — check that ' +
    '<script src="/ort/ort.min.js"></script> is in index.html <head>, ' +
    'BEFORE the module script tag, and that public/ort/ort.min.js exists.'
  )
}

// Runs OwenElliott/image-safety-classifier-xs entirely in the browser —
// the whole point is that neither the server nor Orbit ever needs to see
// a decrypted/unencrypted image to classify it, which matters especially
// for DM images (E2EE) but applies to server images too, for consistency.
//
// Model spec (verified against the model card's own example code, not
// guessed): 224x224 RGB input, NCHW float32 tensor, RAW 0-255 pixel
// values (normalization is baked into the ONNX graph itself, so nothing
// else needs to happen before inference). Output is a single array of 3
// already-softmaxed probabilities, in this exact order: [NSFL, NSFW, SFW].
//
// Honest limitation, not oversold anywhere in the UI that uses this:
// this is a lightweight classifier, not a guarantee. It's a real first
// line of defense against obvious cases, not a promise nothing harmful
// can ever get through.
//
// Point the global ort at the wasm files we serve ourselves from
// public/ort/ (see setup instructions above), and keep it single-
// threaded — small model, doesn't need multi-threading, and it avoids
// a separate unrelated onnxruntime-web hang bug some browsers hit with
// multi-threaded WASM session creation.
ort.env.wasm.wasmPaths = '/ort/'
// Multi-threaded WASM has a separate documented onnxruntime-web hang
// bug with some model/browser combos (session creation never resolves,
// no error). Single-threaded is slightly slower but reliable, and this
// model is small enough that it doesn't matter in practice.
ort.env.wasm.numThreads = 1

const MODEL_URL = '/models/image-safety-classifier-xs.onnx'
const INPUT_SIZE = 224
const CLASS_NAMES = ['NSFL', 'NSFW', 'SFW']

let sessionPromise = null

const SESSION_LOAD_TIMEOUT_MS = 15000

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

function getSession() {
  if (!sessionPromise) {
    sessionPromise = withTimeout(
      ort.InferenceSession.create(MODEL_URL),
      SESSION_LOAD_TIMEOUT_MS,
      `NSFW model failed to load within ${SESSION_LOAD_TIMEOUT_MS}ms — check that ${MODEL_URL} exists and onnxruntime-web is installed`
    ).then((session) => {
      return session
    }).catch((err) => {
      console.error('[Orbit content filter] session creation failed:', err)
      sessionPromise = null // allow retrying on a later call rather than staying permanently broken
      throw err
    })
  }
  return sessionPromise
}

// Loads the model ahead of time (e.g. when a thread/channel with images
// opens) so the first actual scan doesn't have to wait on the ~model
// download + init. Safe to call repeatedly — subsequent calls just reuse
// the same in-flight/completed promise.
export function preloadNsfwModel() {
  getSession().catch((err) => {
    console.error('[Orbit content filter] Failed to preload NSFW model:', err)
  })
}

const INFERENCE_TIMEOUT_MS = 15000

// imageSource can be an HTMLImageElement, HTMLCanvasElement, or
// ImageBitmap — anything drawable to a canvas. Returns
// { NSFL, NSFW, SFW } probabilities (0-1 each, summing to ~1), or throws
// if the model can't be loaded/run (caller decides how to handle that —
// see contentFilters.js for the "fail open vs fail closed" decision).
export async function scanImage(imageSource) {
  const session = await getSession()

  const canvas = document.createElement('canvas')
  canvas.width = INPUT_SIZE
  canvas.height = INPUT_SIZE
  const ctx = canvas.getContext('2d')
  ctx.drawImage(imageSource, 0, 0, INPUT_SIZE, INPUT_SIZE)

  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE) // RGBA, 0-255
  const pixelCount = INPUT_SIZE * INPUT_SIZE

  // RGBA -> NCHW (channels-first), dropping alpha, RAW 0-255 values kept
  // as-is per the model's baked-in normalization.
  const chwData = new Float32Array(3 * pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    chwData[i] = data[i * 4]                     // R plane
    chwData[pixelCount + i] = data[i * 4 + 1]     // G plane
    chwData[2 * pixelCount + i] = data[i * 4 + 2] // B plane
  }

  const inputTensor = new ort.Tensor('float32', chwData, [1, 3, INPUT_SIZE, INPUT_SIZE])

  // Read the real input name straight off the loaded model instead of
  // trusting the name from the model card's example code — a mismatch
  // here (session.run(wrongKey)) can silently hang rather than throw,
  // which matches a real "scan gets stuck on Scanning... forever, zero
  // console errors" bug hit in this project.
  const inputName = session.inputNames?.[0] || 'image'
  const feeds = { [inputName]: inputTensor }

  const results = await withTimeout(
    session.run(feeds),
    INFERENCE_TIMEOUT_MS,
    `NSFW model inference timed out after ${INFERENCE_TIMEOUT_MS}ms (fed input name "${inputName}" — session reports available inputs: ${JSON.stringify(session.inputNames)})`
  )

  const outputKey = Object.keys(results)[0]
  const probs = results[outputKey].data // Float32Array of length 3, order [NSFL, NSFW, SFW]

  return {
    NSFL: probs[0],
    NSFW: probs[1],
    SFW: probs[2],
  }
}

// Loads a data: URL (used for DM images, which arrive as base64 after
// decryption) into an HTMLImageElement ready for scanImage().
export function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

// Same, but for a normal http(s) URL (used for server message
// attachments, served from PocketBase's file storage).
export function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export { CLASS_NAMES }