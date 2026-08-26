export function urlEncode(str: string): string {
  return encodeURIComponent(str);
}

export function urlDecode(str: string): string {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' '));
  } catch {
    return str;
  }
}

export function urlSafeBase64Encode(str: string): string {
  try {
    const b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

export function urlSafeBase64Decode(str: string): string {
  try {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    if (pad) s += '='.repeat(4 - pad);
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return '';
  }
}
