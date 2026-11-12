import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // بلا أحرف ملتبسة مثل O/0 و I/1/L
export const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
export const token = () => crypto.randomBytes(32).toString('base64url');
export const shortId = () => crypto.randomBytes(6).toString('base64url');
export const nowIso = () => new Date().toISOString();

export function newCode() {
  let s = '';
  for (const b of crypto.randomBytes(10)) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export const normalizeCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashCode = c => sha('code:' + normalizeCode(c));

export function safeEqual(a, b) {
  const x = Buffer.from(sha(a)), y = Buffer.from(sha(b));
  return crypto.timingSafeEqual(x, y);
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, secure, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// سبب عدم صلاحية الكود، أو null إن كان صالحاً
export function codeProblem(code, now = Date.now()) {
  if (!code) return 'unknown';
  if (code.locked) return 'locked';
  if (code.expires_at && Date.parse(code.expires_at) <= now) return 'expired';
  return null;
}

export const PROBLEM_AR = {
  unknown: 'الكود غير صحيح. تأكد من كتابته كما وصلك.',
  locked: 'هذا الكود مُقفل. تواصل مع مدير المنصة.',
  expired: 'انتهت مدة هذا الكود. تواصل مع مدير المنصة لتجديده.',
  devices: 'هذا الكود مستخدم على الحد الأقصى من الأجهزة. تواصل مع مدير المنصة.',
  throttled: 'محاولات كثيرة. انتظر ربع ساعة ثم حاول مرة أخرى.',
};

// حد لمحاولات الدخول الفاشلة لكل عنوان
export function makeThrottle({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h) return false;
      if (Date.now() - h.t > windowMs) { hits.delete(key); return false; }
      return h.n >= max;
    },
    fail(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.t > windowMs) hits.set(key, { n: 1, t: Date.now() });
      else h.n++;
    },
    clear(key) { hits.delete(key); },
  };
}
