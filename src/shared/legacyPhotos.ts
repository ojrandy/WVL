// Photos stored in shipments.photos_json before captioned package images existed (update.md C.7).
// They are shown read-only, so only values that are safe as an <img src> are kept: http(s) URLs,
// site-relative paths ("/…", not protocol-relative "//…") and data:image/ URLs. Anything else
// (javascript:, data:text/html, bare words, non-strings) is dropped.
export function legacyPhotoUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const urls: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const url = value.trim();
    if (isSafePhotoUrl(url)) urls.push(url);
  }
  return urls;
}

export function isSafePhotoUrl(url: string): boolean {
  if (/^data:image\//i.test(url)) return true;
  if (url.startsWith('/')) return !url.startsWith('//') && !url.startsWith('/\\');
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
