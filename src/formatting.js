import pb from './pocketbase'

// Locale/time/date formatting driven by the signed-in user's Language & Time
// settings. Kept as plain functions (not a hook) so they can be used anywhere
// and in event handlers; they read the current auth model on each call, and
// always fall back to the browser default if a preference is invalid.

function prefsFrom(overrides) {
  const m = pb.authStore.model || {}
  const locale = overrides?.locale ?? m.locale
  const timeFormat = overrides?.timeFormat ?? m.time_format
  const dateFormat = overrides?.dateFormat ?? m.date_format
  return {
    locale: locale && locale !== 'system' ? locale : undefined,
    timeFormat: timeFormat && timeFormat !== 'auto' ? timeFormat : 'auto',
    dateFormat: dateFormat && dateFormat !== 'auto' ? dateFormat : 'auto',
  }
}

function toDate(input) {
  if (input === null || input === undefined || input === '') return null
  const d = input instanceof Date ? input : new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDate(input, overrides) {
  const d = toDate(input)
  if (!d) return ''
  const { locale, dateFormat } = prefsFrom(overrides)
  try {
    if (dateFormat === 'mdy') return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', year: 'numeric' }).format(d)
    if (dateFormat === 'dmy') return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
    if (dateFormat === 'ymd') return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    return d.toLocaleDateString(locale)
  } catch {
    return d.toLocaleDateString()
  }
}

export function formatTime(input, overrides) {
  const d = toDate(input)
  if (!d) return ''
  const { locale, timeFormat } = prefsFrom(overrides)
  try {
    const base = { hour: 'numeric', minute: '2-digit' }
    if (timeFormat === '12h') return new Intl.DateTimeFormat(locale, { ...base, hour12: true }).format(d)
    if (timeFormat === '24h') return new Intl.DateTimeFormat(locale, { ...base, hour12: false }).format(d)
    return new Intl.DateTimeFormat(locale, base).format(d)
  } catch {
    return d.toLocaleTimeString()
  }
}

export function formatDateTime(input, overrides) {
  const d = toDate(input)
  if (!d) return ''
  return `${formatDate(d, overrides)} ${formatTime(d, overrides)}`
}
