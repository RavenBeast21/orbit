// Centralized runtime configuration.
//
// Historically every endpoint and the Stripe publishable key were hardcoded
// to localhost in each file, which made a production build impossible to
// point at a real deployment without editing source. These are now read from
// Vite env vars at build time with the ORIGINAL local-dev values as
// fallbacks, so nothing changes for the existing local workflow, but a
// deployment can set:
//
//   VITE_POCKETBASE_URL
//   VITE_TOKEN_SERVER_URL
//   VITE_STRIPE_PUBLISHABLE_KEY
//
// in a .env file (or the build environment). No secret keys belong here —
// the Stripe publishable key is public by design; everything else secret
// lives only in the token server's .env.

export const POCKETBASE_URL =
  import.meta.env.VITE_POCKETBASE_URL || 'http://127.0.0.1:8090'

export const TOKEN_SERVER_URL =
  import.meta.env.VITE_TOKEN_SERVER_URL || 'http://localhost:3001'

export const STRIPE_PUBLISHABLE_KEY =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  'pk_test_51TzZWVKFdvrZLKDR3jUpt8BuiP4cCT3cvl6naUQSsOIlGgbWpbY2KCk5B3ynmGruzlKJD6okzSXnskGj6DFoathQ00F7q7ni5c'
