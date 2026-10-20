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
      await q`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
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
  email: r.email || '',
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
export function cleanEmail(v) {
  const e = String(v ?? '').trim().toLowerCase();
  if (!e) return '';
  if (e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'That email address does not look right.');
  return e;
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

/* ---------- email (Resend) ---------- */
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Emails one copy of an instruction to each recipient (each person only sees their own address).
 *  Never throws: the instruction is already saved, so a mail problem must not undo it. */
export async function emailInstruction(recipients, { title, body, senderName, link }) {
  const key = (process.env.RESEND_API_KEY || '').trim();
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const useGmail = !!(gmailUser && gmailPass);
  if (!recipients.length) return { status: 'none', sent: 0, failed: 0 };
  if (!key && !useGmail) return { status: 'not_configured', sent: 0, failed: recipients.length };
  const from = process.env.MAIL_FROM || 'Bless Team Hub <onboarding@resend.dev>';
  const subject = `New instruction: ${title}`;
  const text = `${title}\n\n${body}\n\nFrom ${senderName}\nOpen the hub to respond: ${link}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#18201C">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5A665F;margin:0 0 6px">New instruction from ${escHtml(senderName)}</p>
    <h2 style="margin:0 0 14px;font-size:20px">${escHtml(title)}</h2>
    <div style="white-space:pre-wrap;line-height:1.55;margin:0 0 22px">${escHtml(body)}</div>
    <a href="${escHtml(link)}" style="display:inline-block;background:#0E6A55;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open the hub and respond</a>
    <p style="font-size:12px;color:#5A665F;margin:22px 0 0">Sign in with your username and password to send back your files.</p></div>`;
  let sent = 0, failed = 0, error = '';
  const failedUsers = [];

  // Free option that needs no domain: send through a Gmail account using an app password.
  if (useGmail) {
    let transporter;
    try {
      const nodemailer = (await import('nodemailer')).default;
      transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
    } catch (e) {
      return { status: 'failed', sent: 0, failed: recipients.length, error: 'Gmail sending is not available: ' + e.message, failedUsers: recipients.map((u) => u.username) };
    }
    for (let i = 0; i < recipients.length; i += 5) {
      const group = recipients.slice(i, i + 5);
      const results = await Promise.allSettled(group.map((u) => transporter.sendMail({
        from: `"Bless Team Hub" <${gmailUser}>`, to: u.email, subject, text, html,
      })));
      results.forEach((r, k) => {
        if (r.status === 'fulfilled') sent++;
        else { failed++; failedUsers.push(group[k].username); if (!error) error = String(r.reason?.message || r.reason).slice(0, 200); }
      });
    }
    return { status: failed ? (sent ? 'partial' : 'failed') : 'sent', sent, failed, error, failedUsers };
  }

  const mk = (u) => ({ from, to: [u.email], subject, html, text });
  const post = (url, payload) => fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const msg = async (r) => { try { return (await r.json()).message || ('HTTP ' + r.status); } catch (e) { return 'HTTP ' + r.status; } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    try {
      const r = await post('https://api.resend.com/emails/batch', chunk.map(mk));
      if (r.ok) { sent += chunk.length; continue; }
      const why = await msg(r);
      // A single bad address makes Resend reject the whole batch. Retry one by one (about
      // 2 requests a second is Resend's limit) so everyone else still gets theirs.
      if (r.status === 422 || r.status === 400) {
        for (const u of chunk) {
          try {
            const one = await post('https://api.resend.com/emails', mk(u));
            if (one.ok) sent++;
            else { failed++; failedUsers.push(u.username); if (!error) error = await msg(one); }
          } catch (e) { failed++; failedUsers.push(u.username); if (!error) error = e.message; }
          await wait(600);
        }
      } else {
        failed += chunk.length; chunk.forEach((u) => failedUsers.push(u.username)); if (!error) error = why;
      }
    } catch (e) { failed += chunk.length; chunk.forEach((u) => failedUsers.push(u.username)); if (!error) error = e.message; }
  }
  return { status: failed ? (sent ? 'partial' : 'failed') : 'sent', sent, failed, error, failedUsers };
}
