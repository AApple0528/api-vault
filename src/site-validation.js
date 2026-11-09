const GROUP_NAME_MAX_WIDTH = 16;

function getCharacters(value) {
  const text = String(value);
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), part => part.segment);
  }
  return Array.from(text);
}

function getCharacterWidth(character) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Presentation}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u.test(character) ? 2 : 1;
}

export function getGroupNameWidth(value) {
  return getCharacters(value).reduce((width, character) => width + getCharacterWidth(character), 0);
}

export function validateGroupName(value) {
  const name = String(value).trim();
  const width = getGroupNameWidth(name);
  return { valid: Boolean(name) && width <= GROUP_NAME_MAX_WIDTH, name, width, maxWidth: GROUP_NAME_MAX_WIDTH };
}

export function isSafeHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return Boolean(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

export function normalizeHttpUrl(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return null;
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return null;

  if (candidate.includes('://') && !/^https?:\/\//i.test(candidate)) return null;
  const isHostPort = /^[^:/?#\s]+:\d+(?:[/?#]|$)/.test(candidate);
  const hasExplicitProtocol = !isHostPort && /^[a-z][a-z\d+.-]*:/i.test(candidate);
  if (hasExplicitProtocol && !/^https?:\/\//i.test(candidate)) return null;

  const normalized = hasExplicitProtocol ? candidate : `https://${candidate}`;
  return isSafeHttpUrl(normalized) ? normalized : null;
}

export function validateManualSiteUrl(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return { valid: false, reason: 'required', url: null };
  const url = normalizeHttpUrl(candidate);
  return url
    ? { valid: true, reason: null, url }
    : { valid: false, reason: 'invalid', url: null };
}
