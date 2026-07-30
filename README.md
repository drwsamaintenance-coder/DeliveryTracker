# DRWSA Maintenance Delivery Tracking System

A full working system built from the provided spec and wireframes: Login, Dashboard,
Report (data encoder), User Profile, Analytics, Catalog, FAQ, and About Us — backed by
Firebase/Firestore, with LAN sharing so multiple computers on the same Wi-Fi/network can
use the same data. **This version requires an internet connection at all times** — Firestore
is a cloud database, so if the host computer loses internet access, the app will stop
working until connectivity comes back.

## Starting it without the Command Prompt

Double-click **`Start DRWSA.vbs`** in this folder. The very first time, it checks that
Node.js is installed and runs `npm install` for you (shown in a visible window, since
that one-time step needs internet); after that it starts the server invisibly (no black
cmd window) and opens the app in your default browser. If something goes wrong (Node
missing, port already in use, a startup error) it shows a clear message box instead of
failing silently. To shut it down later, double-click **`Stop DRWSA.vbs`**.

(The traditional `npm start` in a terminal still works too, and is useful if something
goes wrong and you want to see the log output — see "Getting started" below.)

## What's included

- **Backend:** Node.js + Express, REST API
- **Database:** Firebase / Cloud Firestore — requires a Firebase project and a `serviceAccountKey.json` file (see "Getting started" below). Firestore doesn't support SQL-style joins or substring search, so the server fetches transactions once per request and does filtering/sorting/aggregation in JavaScript — this keeps the code simple and avoids ever needing to manually create a Firestore "composite index," which is the right tradeoff for an association's delivery records (hundreds to low thousands of transactions, not millions)
- **Frontend:** Plain HTML/CSS/JS, black background, `#a8a9ad` sidebar, Times New Roman throughout, summary cards colored per spec (`#a6a6a6` transactions, `#b7c5cf` delivery cost, `#92b3b4` suppliers)
- **Features implemented:**
  - Login/logout with session cookies
  - **Custom logo:** upload your own PNG/JPEG from the About Us page — it replaces the default icon on the login page and sidebar everywhere
  - **XLSX report logo:** a *separate* logo uploader, also on the About Us page, controls only the header logo embedded in every generated Excel file (Delivery Report, Catalog export, Suppliers list, Executive Analytics Report). Changing the system logo does not affect this, and vice versa — upload once and it applies to every future export immediately.
  - Dashboard: totals, calendar of deliveries by month/year, transaction breakdown pie chart, all three summary cards jump straight to Analytics pre-filtered to match (transaction count, total amount, or the full supplier list)
  - **Admin accounts:** the two seed accounts are both admins, and any admin can create further accounts (admin or staff) from the User page
  - **Notifications:** click any notification to jump straight to the transaction it refers to
  - Report page: multi-row data encoder with **autosuggest** (typing in supplier, CTRL/OR/Invoice number, item, remarks, or received-by pulls matching suggestions from history) and **autofill** (choosing a known CTRL number fills in its date/supplier/received-by/remarks; choosing a known item fills in its usual unit and last price), optional JPEG/PNG photo per item, Submit/Cancel
    - **Double-submit protection:** the Submit button disables itself the instant it's clicked, so a double-click or a tap that registers twice on a laggy connection can't send the report twice. The server also serializes report submissions and recognizes an exact repeat of the same submit attempt, as a second layer of protection.
    - **Grouping/merge logic:** items with the same CTRL number are combined into one transaction; a report with the same supplier but different CTRL numbers is also combined, keeping every CTRL number on record. This also runs when you **edit** a transaction — if the edited supplier + CTRL number + date now matches another transaction on file, the two are automatically merged into one. This merge check is serialized on the server so it stays correct even if two submissions land at nearly the same instant.
  - User profile: **editable** contact details and **changeable profile picture**, plus activity counts (submitted/edited/deleted) and a recent activity log
  - Analytics: filter by total amount or transaction count, custom date range, on-screen chart that actually switches with your choice (pie/column/bar/line), an always-visible **All Suppliers** list (all-time, independent of the date filter), and a **downloadable XLSX with a real embedded Excel chart** plus a full breakdown data sheet (supplier, transaction count, and amount)
  - **Scoped XLSX analytics:** every generated Excel file's "Analytics & Statistic Overview" and "Spend by Supplier (Top 5)" panels reflect only the transactions/suppliers actually included in that export — a filtered Catalog download, a single-supplier report, or a single-transaction export show totals for that scope only, not the association's all-time numbers
  - Catalog: 20 rows per page with pagination, a **live search box** (searches as you type — no need to click the search icon) that matches supplier, CTRL/OR/Invoice number, item, or transaction number all at once, date range filter, a **View** button that opens full transaction details with Edit / Delete / Back at the bottom, and a **downloadable XLSX where you choose which columns to include**
  - FAQ page with the 25 Q&As from the spec, as a scrollable accordion
  - About Us page, with the logo-upload control described above
  - Notifications panel (shows add/edit/merge/delete events) on every page
  - Multi-computer LAN sync: one computer runs the server, others connect via its local IP

## Getting started

1. Install [Node.js](https://nodejs.org) **v22.5 or newer** (v22 LTS or v24 both work) on the computer that will act as the server.
2. Set up a Firebase project (free tier is plenty for this):
   - Go to **https://console.firebase.google.com** → **Add project** → give it a name → Analytics is optional.
   - In the sidebar: **Build → Firestore Database → Create database** → pick a region close to you → **Production mode**.
   - **Project settings** (gear icon) → **Service accounts** tab → **Generate new private key**. This downloads a `.json` file.
   - Rename that file to `serviceAccountKey.json` and place it in this project's root folder (next to `package.json` and `server.js`).
3. Unzip this project somewhere normal, like your Desktop — **not** inside `C:\Program Files`, which Windows locks down.
4. Open a terminal, `cd` into the unzipped `drwsa` folder (the one with `package.json` in it), and run:
   ```
   npm install
   npm start
   ```
   The first run automatically creates the default settings and the two demo admin accounts in your Firestore project.
5. Open **http://localhost:3000/login.html** in a browser.
6. Demo accounts:
   - `juan` / `password123`
   - `jess` / `password123`

After that first `npm install`, day-to-day you can just double-click `Start DRWSA.vbs`
instead of using the terminal (see above).

All data (transactions, users, activity, notifications, settings) lives in your Firestore
project — viewable and editable anytime at console.firebase.google.com under **Firestore
Database**. Delivery photos, the logo, and avatar images still live locally in the
`public/uploads` folder on the host computer (only structured data goes to Firestore).

## Adding / editing users

Any admin account can create new accounts (admin or staff) right from the User page —
no database editing needed. Both demo accounts (`juan` and `jess`) are admins by default.
If you ever need to edit account data directly, it's in the `users` collection in the
Firebase Console under Firestore Database.

## Using it on multiple computers (LAN / Wi-Fi)

This matches the "Computer A hosts, Computer B connects" requirement from the spec:

1. On the **host computer**, start the app (via `Start DRWSA.vbs` or `npm start`), then find its local IP address:
   - Windows: `ipconfig` (look for "IPv4 Address", e.g. `192.168.1.15`)
   - Mac/Linux: `ifconfig` or `ip addr`
2. Make sure both computers are on the **same Wi-Fi/network**.
3. On the host computer's firewall, allow inbound connections on port `3000`.
4. On the other computer(s) — which do **not** need any of these files — open a browser to `http://<host-ip>:3000/login.html` (e.g. `http://192.168.1.15:3000/login.html`).
5. Changes made from any connected computer are saved to the host's database and show
   up for everyone (refresh or re-open the page to see the latest data).

If another computer can't connect, check (this is also in the in-app FAQ):
the host is on and running, both machines are on the same network, the IP address is
correct, and no firewall is blocking port 3000.

## Making it accessible from anywhere (not just one Wi-Fi network)

The LAN setup above only works while everyone's on the same network as the host
computer. To reach it from anywhere — home, the office, mobile data — the server
itself needs to run on a cloud host with a public address instead of a machine under
someone's desk. Firestore is already cloud-based; this just moves the other half
(the Node/Express server) off-site too.

**The recommended path: GitHub + Render.**

1. **Push this project to GitHub.** `serviceAccountKey.json` is already in `.gitignore`
   so it's never committed — this is important, since that file gives full access to
   your database. Create a repo (public or private, either is fine) and push this
   folder to it.
2. **Create a free account at https://render.com** and sign in with GitHub.
3. **New → Blueprint**, then pick this repo. Render reads the included `render.yaml`
   and sets almost everything up automatically — the only two things it'll ask you to
   fill in are:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — open your `serviceAccountKey.json` file and
     paste its **entire contents** as the value.
   - `SESSION_SECRET` — any long random string. You can generate one with:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
4. Click **Apply** / **Deploy**. After a couple of minutes you'll get a public URL like
   `https://drwsa-maintenance.onrender.com` — that's it, reachable from anywhere,
   no port forwarding or firewall rules needed.
5. Every time you `git push` after this, Render automatically redeploys the latest
   version — that's the main benefit of connecting it to GitHub instead of uploading
   files by hand.

**Worth knowing about Render's free tier:** the free web service goes to sleep after
15 minutes of no traffic (the first request after that takes ~30-60 seconds to wake
it back up), and its disk is **not persistent** — anything saved to `public/uploads`
(delivery photos, the logo, avatars) can be wiped on redeploy or restart. For a small
association just trying this out, that's usually fine. If uploaded photos start
disappearing and that becomes a problem, the fix is either:
- upgrading to a paid Render plan with a persistent disk ($7/mo class), or
- moving file uploads to Firebase Storage instead of local disk (a further code change —
  ask if you'd like this done).

## The verification password

Editing or deleting a transaction requires a verification password. The default is:

```
drwsa2026
```

It's stored in the `settings` collection in Firestore, as the `verification_password`
document's `value` field. To change it: go to Firebase Console → Firestore Database →
`settings` collection → `verification_password` document → edit the `value` field.

## Switching away from Firebase

`routes/dataAccess.js` and `db/init.js` are the only places that talk to the database —
`getAllTransactions()` and `filterTransactions()` in `dataAccess.js` are what every other
route calls to read transactions. If you ever want to move to a different database, those
two files (plus the `db.collection(...)` calls in `routes/auth.js`, `routes/users.js`,
`routes/settings.js`, and `routes/notifications.js`) are the full list of what would need
to change — every other route only calls the shared helpers and never talks to the
database directly.

## Project structure

```
drwsa/
  Start DRWSA.vbs         Double-click to launch the server hidden + open the browser
  Stop DRWSA.vbs           Double-click to shut the server down
  server.js                Express app entry point
  db/init.js                Database schema + seed data
  routes/                   API endpoints (auth, transactions, dashboard, analytics, users, notifications, settings)
  public/                   Frontend pages, CSS, JS
    login.html, dashboard.html, report.html, user.html,
    analytics.html, catalog.html, faq.html, about.html
    css/style.css
    js/app.js
    uploads/                 delivery photos, logo, and avatars uploaded through the app
```

## Notes / things worth deciding with the DRWSA team before go-live

- Passwords are stored as plain text for this prototype; before real deployment these should be hashed.
- "Deleted transactions can be recovered" — the FAQ mentions this is an admin decision; currently deletes are permanent. Let us know if you'd like a recycle-bin/undo feature instead.
- The merge-on-edit rule combines transactions when supplier + CTRL number + date all match another record — if your team wants looser or stricter matching (e.g. ignoring date), let us know.
