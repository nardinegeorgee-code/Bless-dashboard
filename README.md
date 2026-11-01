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
2. In the app's version settings, add these access scopes, then release the version: `read_orders`, `read_products`, `read_customers`, `read_reports`, `read_inventory` (the last two power the analysis tabs). `read_all_orders` is optional and needs a separate approval from Shopify; without it only the last 60 days of orders are returned. After adding scopes, release a new version and approve it on the store (Apps > your app > update).
3. Install the app on your store.
4. Under the app's **Settings**, copy the **Client ID** and **Client secret**.
5. In Vercel add: `SHOPIFY_STORE` (for example `my-shop.myshopify.com`), `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, and `CRON_SECRET` (any long random string; it protects the daily job). Optional: `DASHBOARD_TZ` (default `Africa/Cairo`), `SHOPIFY_MONTHS` (how many months to import first, default 13).
6. Redeploy, open the Shopify page and press **Sync now**. The first import can take several minutes; leave the page open.

If Areas and Customers stay empty, request **protected customer data** access for the app in the Dev Dashboard (customer and address fields are protected by Shopify) and sync again. If you already have an older custom app with an Admin API token (`shpat_...`), set `SHOPIFY_ADMIN_TOKEN` instead of the client ID and secret.


## Analysis tabs (Super Admin only)

Shopify > Sales, Funnel, Products, Customer experience, Retention. Each tab loads its own numbers from Shopify reports (cached 30 minutes; "Refresh numbers" re-fetches). Retention uses your synced orders, so press **Sync now** once after this update to re-import orders with product categories. Service scores (CSAT, NPS, response time and so on) are typed in under Customer experience and saved per month.

## Odoo (read-only)

Admin-only **Odoo** page with Inventory, Sales & invoices, Accounting and Employees tabs, read live through Odoo's JSON-RPC.
Set these in Vercel, then redeploy:

- `ODOO_URL` e.g. `https://yourcompany.odoo.com`
- `ODOO_DB` database name (on Odoo Online usually the subdomain)
- `ODOO_LOGIN` email of the Odoo user to read as (use a user with read-only rights)
- `ODOO_API_KEY` made in Odoo: avatar, My Profile, Account Security, New API Key

Apps that are not installed in Odoo show a message in that card instead of breaking the page.

## Meta Ads (Super Admin only)

Admin-only **Meta Ads** page with two tabs, read live from Meta's Marketing API (numbers are cached for 15 minutes; "Refresh numbers" re-fetches).

- **Overview**: amount spent, purchases, purchase value, return on ad spend, cost per purchase, reach, link clicks and rates, with a 12-month trend; a comparison of Meta spend against your real Shopify revenue (blended return and ad spend per order); and the top campaigns, top ads and platforms by spend.
- **Campaigns**: every campaign with its status, daily budget, spend and results. You can **pause or resume** a campaign and **change its daily budget**. Both ask you to click twice to confirm, only touch campaigns in the connected ad account, refuse a budget more than 10 times the current one, and are written to a "Changes made from this dashboard" log (table `meta_audit`).

### Connect your ad account
1. In Meta Business Settings, open Users, **System users**, and add a system user (Admin).
2. Add your ad account as an asset of that user. Choose "Manage campaigns" to allow pausing and budget changes, or "View performance" for reports only.
3. Generate a token for your Meta app with **ads_read** (add **ads_management** to allow changes) and copy it.
4. In Vercel add `META_ACCESS_TOKEN` (the token) and `META_AD_ACCOUNT_ID` (your ad account number from Ads Manager, with or without `act_`). Optional: `META_API_VERSION` (default `v23.0`). `DASHBOARD_TZ` is shared with the other pages.
5. Redeploy and open the Meta Ads page.

The token stays on the server and is sent to Meta in a request header. Pausing and budget changes need `ads_management`; without it the page still shows reports and Meta's error is shown if you try to change something. Campaigns with a lifetime budget, or with budgets set per ad set, can be paused but their budget is not editable here.

Note: Vercel's free (Hobby) plan allows 12 serverless functions per project, and `api/meta.js` is the 12th.
