# Bless Team Hub: Android and iPhone app

The app is a native shell (Capacitor) that opens the live hub at the address in `capacitor.config.json`
(`server.url`). Logins, quotations, invoices, stock and Odoo all keep working exactly as on the website,
and every website update shows up in the app without a new store release.

## One-time setup (on your computer)
1. Install Node.js 18+ and run `npm install` in this folder.
2. Android: install Android Studio, then run
   `npx cap add android`, `npm run build`, `npx cap sync`, `npm run cap:android`.
3. iPhone (needs a Mac with Xcode): `npx cap add ios`, `npx cap sync`, `npm run cap:ios`.
   No Mac? Use a cloud build service (for example Ionic Appflow or Codemagic).

## Before the stores will accept it
- **Icon**: a 1024x1024 PNG (the current logos in `public/` are too small). Generate all sizes with
  `npx @capacitor/assets generate` after placing `assets/icon-only.png` and `assets/splash.png`.
- **Accounts**: Apple Developer Program (about $99/year) and Google Play Console (about $25 once).
- **Privacy policy page**: a public web address, required by both stores.
- **Apple rule 4.2**: a plain website in an app can be rejected. Add native features before submitting
  (barcode scanner for stock counts, camera, share PDF). Planned next.
- **Test accounts**: give Apple and Google a demo login for the reviewers.

## Notes
- Sessions use the cookie `hub_session` (SameSite=Lax). Because the app loads the site from its own
  address, the cookie behaves like a normal browser visit.
- To bundle the site inside the app instead (works offline), the API address and cookie settings must
  change first. Talk to me before doing that.
