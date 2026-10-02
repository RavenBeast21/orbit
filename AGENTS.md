# AGENTS.md

## What this is
- Frontend-only React 19 + Vite SPA (a Discord-like chat app called Orbit). All app code is under `src/`; one file per screen/panel in `src/components/`. Plain `.jsx`, no TypeScript in use (despite `@types/react` devDeps).
- The backend is NOT in this repo and is expected to already be running:
  - PocketBase at `http://127.0.0.1:8090` — hardcoded in `src/pocketbase.js`; all data access and realtime subscriptions use `pb`.
  - Auxiliary server at `http://localhost:3001` — hardcoded in `src/crypto.js`, `src/components/Billing.jsx`, `OrbitsBoost.jsx`, `ReportsQueue.jsx`, `VoiceChannel.jsx`, `DMCall.jsx`. It serves LiveKit `/token`, E2EE key `/keys/*`, Stripe, and reports. Do not look for it here.
- No `.env` / `import.meta.env` usage anywhere: endpoints and the Stripe publishable key are hardcoded in source.

## Commands
- `npm run dev` — Vite dev server
- `npm run build` — production build to `dist/` (gitignored; never edit)
- `npm run lint` — ESLint flat config (`eslint.config.js`, ignores `dist/`)
- `npm run preview` — serve built output
- There is no test runner and no typecheck script. Do not invent one.

## Non-obvious constraints
- onnxruntime-web is deliberately NOT imported as ESM. It is loaded via `<script src="/ort/ort.min.js">` in `index.html` before the module script and read as `window.ort` in `src/nsfwScan.js`; converting it to an `import` reproduces a hard Vite dev-server failure. After any onnxruntime-web upgrade, re-copy `node_modules/onnxruntime-web/dist/ort.min.js` and `*.wasm` into `public/ort/`. `public/ort/` and `public/models/image-safety-classifier-xs.onnx` are required runtime assets but are untracked.
- E2EE (tweetnacl) lives in `src/crypto.js`. A user's identity is the server-side `users.public_key`; the private key is escrowed at the key server. Never generate a replacement keypair when `public_key` already exists without escrow — it permanently breaks every past DM. `resetKeypair()` is destructive and only for explicit user confirmation.
- Permissions are async, multi-collection checks in `src/permissions.js`. Owner always bypasses. Overwrite resolution is: channel deny > channel allow > category deny > category allow > role default; `view_channel` defaults to `true`. Pass exact role Bool field names (`manage_roles`, `kick_members`, ...).
- PocketBase collection schema is not in the repo; the collection names called in code *are* the schema. Realtime `pb.collection(...).subscribe(...)` drives notifications. Pass `{ requestKey: null }` to requests that run alongside others so PocketBase does not auto-cancel them.
- Stripe publishable key is hardcoded and duplicated in `Billing.jsx` and `OrbitsBoost.jsx`; real activation is done by the external webhook and polled in the UI. Billing price IDs are still `TODO`.
- Theme is applied via `data-theme` on `<html>`; `App.jsx` also sets `document.body.style.fontSize` from `accessibility_text_size`. Global stylesheets are `src/App.css`, `src/index.css`, and `src/profile-features.css`.

## Conventions
- Code favors long explanatory comments documenting why a non-obvious approach was chosen (e.g. the onnxruntime workaround). Match that style when touching these files.

## Working rules
- Before editing, inspect the relevant existing implementation and understand how it connects to related components.
- Make targeted changes. Do not rewrite or refactor unrelated working code unless required to complete the task.
- After frontend code changes, run `npm run lint` and `npm run build`. There is no test runner or typecheck command in this repo, so do not invent either.
- If lint or build fails because of your changes, investigate the root cause, fix it, and rerun the checks until they pass.
- Do not claim a task is complete solely because code was written. Verify the relevant implementation and inspect the final diff.
- Before finishing a task, review your own changes for incorrect assumptions, regressions, unfinished stubs, accidental edits, and obvious edge cases.
- If the same approach fails twice, stop repeating it. Reassess the cause and try a different approach.
- Keep terminal output focused. Use targeted commands, grep, tail, or specific file reads instead of dumping huge logs or rereading the entire repository unnecessarily.
- Preserve existing working behavior unless the task explicitly requires changing it.
- Ask the user before actions involving payments, purchases, external account configuration, secrets, credentials, destructive data operations, or irreversible changes.
- Never expose, print, commit, or hardcode new secrets or private API keys.
- For long tasks, work through items sequentially and maintain a short internal checklist of completed, blocked, and remaining work.

## Orbit workspace layout

The Orbit project is split across several related folders.

Main application:
- /home/ahmed/Desktop/orbit
  Main Orbit React/Vite application.

Backend:
- /home/ahmed/Desktop/orbit-backend
  PocketBase backend and backend-related files.

Token / auxiliary server:
- /home/ahmed/Desktop/orbit-token-server
  Orbit token and auxiliary Node.js server.

Orbit Dev:
- /home/ahmed/Desktop/orbit-dev-ui
  Custom web interface for OpenCode, DeepSeek and Claude.
  This is the developer AI workspace, not the main Orbit user application.

Desktop application:
- /home/ahmed/Desktop/Orbit-Desktop-App
  Orbit desktop application related files.

Downloads:
- /home/ahmed/Desktop/Orbit-Downloads
  Orbit-related downloaded assets and files.

Documentation:
- /home/ahmed/Desktop/Orbit Documents
  Orbit documentation and project material.

Web design references:
- /home/ahmed/Desktop/Orbit Web looks
  Visual references and design material for Orbit's web interface.

Additional project files:
- /home/ahmed/Desktop/Commands.txt
- /home/ahmed/Desktop/start-orbit.sh

When a task relates to one of these systems, inspect the relevant folder before making assumptions.

Never access or request unrelated credential files such as Master Key.txt or steamguard.txt.