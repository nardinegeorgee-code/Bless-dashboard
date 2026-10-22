import { neon } from '@neondatabase/serverless';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

export const ROLES = ['super_admin', 'graphic_designer', 'media_buyer', 'content_creator', 'moderator', 'pr', 'ecommerce'];
export const COOKIE = 'hub_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* ---------- database ---------- */
let sql;
let ready;

export function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new HttpError(500, 'No database connected. In Vercel, open Storage and connect a Postgres (Neon) database to this project, then redeploy.');
    sql = neon(url);
  }
  return sql;
}

export function ensureSchema() {
  if (!ready) {
    const q = db();
    ready = (async () => {
      await q`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        sv INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
      )`;
      await q`CREATE TABLE IF NOT EXISTS instructions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        roles JSONB NOT NULL DEFAULT '[]',
        user_ids JSONB NOT NULL DEFAULT '[]',
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )`;
      await q`CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        instruction_id TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        files JSONB NOT NULL DEFAULT '[]',
        created_at BIGINT NOT NULL
      )`;
      await q`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS rating INTEGER`;
      await q`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS rated_at BIGINT`;
      await q`CREATE TABLE IF NOT EXISTS eval_behaviour (
        month TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER, note TEXT NOT NULL DEFAULT '', updated_at BIGINT NOT NULL,
        PRIMARY KEY (month, user_id)
      )`;
      await q`CREATE TABLE IF NOT EXISTS eval_speed (
        instruction_id TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER, updated_at BIGINT NOT NULL,
        PRIMARY KEY (instruction_id, user_id)
      )`;
      await q`CREATE TABLE IF NOT EXISTS eval_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL)`;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- row mappers ---------- */
export const mapUser = (r) => ({
  id: r.id,
  username: r.username,
  usernameLower: r.username_lower,
  role: r.role,
  createdAt: Number(r.created_at),
});
export const mapInstruction = (r) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  roles: r.roles || [],
  userIds: r.user_ids || [],
  createdBy: r.created_by,
  createdAt: Number(r.created_at),
});
export const mapSubmission = (r) => ({
  id: r.id,
  userId: r.user_id,
  username: r.username,
  role: r.role,
  instructionId: r.instruction_id,
  note: r.note,
  files: r.files || [],
  createdAt: Number(r.created_at),
  rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
});

/* ---------- auth ---------- */
function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'JWT_SECRET is missing. Add an environment variable named JWT_SECRET (a long random string) in Vercel, then redeploy.');
  return new TextEncoder().encode(s);
}

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

export async function setSession(res, user) {
  const token = await new SignJWT({ sv: user.sv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`);
}

export function clearSession(res) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** Returns the signed-in user row, or null. Re-checks the database on every request so
 *  role changes, removals and password changes take effect immediately. */
export async function getUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  let payload;
  try { ({ payload } = await jwtVerify(token, secret())); } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
  const q = db();
  const rows = await q`SELECT * FROM users WHERE id = ${payload.sub}`;
  const u = rows[0];
  if (!u || u.sv !== payload.sv) return null;
  return u;
}

export async function requireUser(req) {
  const u = await getUser(req);
  if (!u) throw new HttpError(401, 'Please sign in again.');
  return u;
}

export async function requireAdmin(req) {
  const u = await requireUser(req);
  if (u.role !== 'super_admin') throw new HttpError(403, 'Only the Super Admin can do that.');
  return u;
}

/* ---------- validation ---------- */
export function cleanName(v) {
  const u = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (u.length < 2 || u.length > 40) throw new HttpError(400, 'Use 2 to 40 characters for the username.');
  return u;
}
export function cleanPassword(v) {
  const p = String(v ?? '');
  if (p.length < 4) throw new HttpError(400, 'Use at least 4 characters for the password.');
  if (p.length > 200) throw new HttpError(400, 'That password is too long.');
  return p;
}
export function cleanRole(v) {
  if (!ROLES.includes(v)) throw new HttpError(400, 'Unknown role.');
  return v;
}

/* ---------- handler wrapper ---------- */
export function route(handler) {
  return async (req, res) => {
    try {
      await ensureSchema();
      await handler(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: e.status ? e.message : 'Server error: ' + (e.message || 'unknown') });
    }
  };
}

export function allow(req, methods) {
  if (!methods.includes(req.method)) throw new HttpError(405, 'Method not allowed.');
}
