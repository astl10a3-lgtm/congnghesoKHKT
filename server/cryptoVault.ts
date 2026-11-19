import crypto from 'node:crypto';

export interface AuthTokenPayload {
  uid: string;
  username: string;
  role: 'admin' | 'member';
  iat: number;
  exp: number;
}

const VAULT_SECRET =
  process.env.AUTH_VAULT_SECRET ||
  process.env.SESSION_SECRET ||
  'recycle-art-studio-admin-vault-key-2026';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getAesKey(): Buffer {
  return crypto.createHash('sha256').update(VAULT_SECRET).digest();
}

function getHmacKey(): Buffer {
  return crypto.createHash('sha256').update(`${VAULT_SECRET}:session-hmac`).digest();
}

export function encryptPassword(plainPassword: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainPassword, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPassword(storedCipher: string): string {
  if (!storedCipher || typeof storedCipher !== 'string') return '';
  if (!storedCipher.startsWith('v1:')) return '';
  const parts = storedCipher.split(':');
  if (parts.length !== 4) return '';

  try {
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getAesKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function verifyPassword(candidatePlain: string, storedCipher?: string): boolean {
  if (!candidatePlain || !storedCipher) return false;
  const actual = decryptPassword(storedCipher);
  if (!actual) return false;

  const a = Buffer.from(candidatePlain, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function signAuthToken(user: {
  uid: string;
  username: string;
  role: 'admin' | 'member';
}): string {
  const now = Date.now();
  const payload: AuthTokenPayload = {
    uid: user.uid,
    username: user.username,
    role: user.role,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getHmacKey())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;

  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getHmacKey())
    .update(encodedPayload)
    .digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as AuthTokenPayload;
    if (!decoded?.uid || !decoded?.username || !decoded?.exp) return null;
    if (Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}
