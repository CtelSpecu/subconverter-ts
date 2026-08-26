export function base64Encode(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    try {
      return btoa(str);
    } catch {
      return '';
    }
  }
}

export function base64Decode(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    try {
      return atob(str);
    } catch {
      return '';
    }
  }
}

export function urlSafeBase64Encode(str: string): string {
  const b64 = base64Encode(str);
  if (!b64) return '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function urlSafeBase64Decode(str: string): string {
  try {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);
    return base64Decode(s);
  } catch {
    return '';
  }
}
