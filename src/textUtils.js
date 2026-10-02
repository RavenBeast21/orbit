// Small text transforms used by the composer.
//
// ASCII emoticon conversion is opt-in (users.ascii_emoticons). Conversion is
// done token-by-token with strict boundaries so it never corrupts URLs
// (e.g. the ":/" in "https://") and only rewrites standalone emoticons.

const ASCII_EMOTICONS = {
  ':)': '🙂',
  ':-)': '🙂',
  ':d': '😄',
  ':-d': '😄',
  ';)': '😉',
  ';-)': '😉',
  ':(': '🙁',
  ':-(': '🙁',
  ":'(": '😢',
  ":'-(": '😢',
  ':p': '😛',
  ':-p': '😛',
  ';p': '😜',
  ';-p': '😜',
  ':o': '😮',
  ':-o': '😮',
  ':/': '😕',
  ':-/': '😕',
  ':|': '😐',
  ':-|': '😐',
  '<3': '❤️',
  'xd': '😆',
  'd:': '😧',
  '\\o/': '🙌',
}

// Preceded by start/whitespace/opening punctuation, followed by
// end/whitespace/closing punctuation.
const EMOTICON_PATTERN = /(^|[\s([{"'])(:-?\)|:-?d|;-?\)|:-?\(|:'-?\(|:-?p|;-?p|:-?o|:-?\/|:-?\||<3|xd|d:|\\o\/)(?=$|[\s)\]}"',.!?;:])/gi

export function convertAsciiToEmoji(text) {
  if (!text) return text
  return text.replace(EMOTICON_PATTERN, (match, prefix, emoticon) => {
    const replacement = ASCII_EMOTICONS[emoticon.toLowerCase()]
    return replacement ? prefix + replacement : match
  })
}

// Applies the current user's preference. Safe to call with a null/blank text.
export function maybeConvertEmoticons(text, enabled) {
  if (!enabled) return text
  return convertAsciiToEmoji(text)
}
