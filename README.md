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
