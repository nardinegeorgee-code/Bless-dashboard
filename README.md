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

## Shopify dashboard (Super Admin only)
A **Shopify** page shows monthly revenue, orders and units sold, best sellers, countries and cities, new vs returning customers, and carts left behind (how long, how much, which products). Data is copied from Shopify into your own database: once a day automatically (Vercel cron, 03:00 UTC) and whenever you press **Sync now**.

### Connect your store
1. Open the Shopify **Dev Dashboard** (dev.shopify.com/dashboard) with the account that owns the store and create an app.
2. In the app's version settings, add these access scopes, then release the version: `read_orders`, `read_all_orders`, `read_products`, `read_customers`. (Without `read_all_orders` Shopify only returns the last 60 days.)
3. Install the app on your store.
4. Under the app's **Settings**, copy the **Client ID** and **Client secret**.
5. In Vercel add: `SHOPIFY_STORE` (for example `my-shop.myshopify.com`), `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `CRON_SECRET` (any long random string; it protects the daily job). Optional: `DASHBOARD_TZ` (default `Africa/Cairo`), `SHOPIFY_MONTHS` (how many months to import first, default 13).
6. Redeploy, open the Shopify page and press **Sync now**. The first import can take several minutes; leave the page open.

If Areas and Customers stay empty, request **protected customer data** access for the app in the Dev Dashboard (customer and address fields are protected by Shopify) and sync again. If you already have an older custom app with an Admin API token (`shpat_...`), set `SHOPIFY_ADMIN_TOKEN` instead of the client ID and secret.
