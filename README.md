# Bless Team Hub

Role-based team hub: the Super Admin sends instructions to roles or specific people, team members respond with files (or upload without an instruction), and the Super Admin sees everything and manages users, roles and passwords.

Roles: Super Admin, Graphic Designer, Media Buyer, Content Creator, Moderator, PR, E-Commerce.

## Stack
- Vite frontend (`index.html`, `src/`)
- Vercel serverless functions (`api/`)
- Postgres (Neon) for users, instructions and submissions. Tables are created automatically on first request.
- Vercel Blob for uploaded files (browser uploads straight to Blob, up to 20 MB each)
- Passwords hashed with bcrypt; sessions are signed, HTTP-only cookies

## Deploy on Vercel
1. Push this folder to a GitHub repo and import it at vercel.com/new.
2. In the project, open **Storage** and connect a **Postgres (Neon)** database. This adds `DATABASE_URL`.
3. Still in **Storage**, create a **Blob** store and connect it. This adds `BLOB_READ_WRITE_TOKEN`.
4. Open **Settings > Environment Variables** and add `JWT_SECRET` with a long random string (for example the output of `openssl rand -hex 32`).
5. Redeploy. Open the site: the first screen creates the Super Admin account.

## Local development
```
npm install
npm i -g vercel
vercel link && vercel env pull .env.local
vercel dev
```

## Email notifications (optional)
When the Super Admin sends an instruction, everyone it reaches who has an email address on file is emailed. Add or edit addresses on the Users page. Emails are sent through Resend (resend.com):
1. Create a free Resend account and an API key.
2. Add `RESEND_API_KEY` in Vercel's environment variables.
3. To email anyone (not just yourself), verify a sending domain in Resend and set `MAIL_FROM`, for example `Bless Team Hub <hub@yourdomain.com>`. Without it, Resend only delivers to the account owner's own address.
4. Optional: set `SITE_URL` (for example `https://your-site.vercel.app`) so the email button links to the right address.
5. Redeploy.

