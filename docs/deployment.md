# Deploying EmpCore

EmpCore is three moving parts: a **database**, a **long-running API**, and a
**static client**. The only constraint that really shapes the choice of host is
the second one.

## Why the API cannot go on a serverless host

EmpCore holds open **Socket.IO** connections for live notifications and runs
**node-cron** jobs in process (auto-absent marking, monthly leave accrual,
approval reminders). Both need a process that survives between requests.

On a serverless platform — Vercel Functions, Netlify Functions, Lambda — the
Express routes would still work, but:

- WebSocket upgrades are not supported, so real-time notifications silently
  degrade to nothing.
- The process is torn down between invocations, so `node-cron` never fires.

So the client can happily go on Vercel; the API wants a host that runs a real
process. Render's free web service, Railway, Fly.io and any container host all
qualify.

---

## 1. Database — MongoDB Atlas

You need a hosted MongoDB. The free M0 tier is enough for this app.

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. **Database Access** → add a user with a strong password.
3. **Network Access** → allow the IP your API host uses. Render and most PaaS
   hosts do not publish a stable egress IP on free plans, so `0.0.0.0/0` is the
   practical setting there. Keep the database user credentials strong, since
   that becomes your only perimeter.
4. Copy the connection string — it looks like:

```
mongodb+srv://<user>:<password>@<cluster>.mongodb.net/empcore?retryWrites=true&w=majority
```

Make sure the database name (`empcore`) is present in the path.

---

## 2. API

### Option A — Render blueprint (least manual work)

The repo root has a [`render.yaml`](../render.yaml) that declares both services.

1. On [render.com](https://render.com): **New → Blueprint**, point it at this repo.
2. Render creates `empcore-api` and `empcore-client` and generates the two JWT
   secrets automatically.
3. Fill in the values marked `sync: false`:
   - `MONGO_URI` → your Atlas string
   - `CLIENT_ORIGIN` → the client URL (you'll have it after step 3 — set it then
     and redeploy)
   - `VITE_API_URL` on the client service → the API URL

> Render's free tier sleeps after 15 minutes idle. The first request afterwards
> takes ~30 seconds to wake. Fine for a portfolio demo; note it if you share the
> link with someone.

### Option B — any container host

[`server/Dockerfile`](../server/Dockerfile) builds a production image:

```bash
cd server
docker build -t empcore-api .
docker run -p 5000:5000 --env-file .env.production empcore-api
```

### Required environment variables

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | Atlas connection string |
| `JWT_ACCESS_SECRET` | Long random string — startup **refuses** a `dev-` value in production |
| `JWT_REFRESH_SECRET` | A different long random string |
| `CLIENT_ORIGIN` | Deployed client URL, e.g. `https://empcore.vercel.app` (comma-separated for several) |
| `COOKIE_SAMESITE` | `none` when client and API are on different domains |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

---

## 3. Client

### Vercel

[`client/vercel.json`](../client/vercel.json) sets the SPA rewrite — without it,
refreshing on `/employees/123` returns a 404 because no such file exists.

1. Import the repo on Vercel and set **Root Directory** to `client`.
2. Add an environment variable `VITE_API_URL` = your API URL (no trailing slash).
3. Deploy.

`VITE_API_URL` is read at **build** time, not runtime — changing it needs a
redeploy, not just a restart.

### Netlify / Cloudflare Pages

Build command `npm run build`, publish directory `dist`, and add the same
catch-all rewrite to `/index.html`.

---

## 4. Wire the two together

Two settings have to agree or authentication will fail in ways that look
mysterious:

- **`CLIENT_ORIGIN` on the API** must exactly match the client's origin, scheme
  included. A mismatch shows up as a CORS error in the browser console.
- **`COOKIE_SAMESITE=none`** on the API when the two are on different domains.
  The refresh cookie is `httpOnly`, so if this is wrong you see a working login
  that logs you out on every page refresh — the browser accepted the cookie but
  refuses to send it back.

`SameSite=None` also requires `Secure`, which the app sets automatically. Both
halves must therefore be on HTTPS — every host above provides that by default.

If you serve the client and API from **one** domain (a reverse proxy, or the API
serving the built client), set `COOKIE_SAMESITE=lax` instead to keep CSRF
protection.

---

## 5. Seed the deployed database (optional)

To load the demo organisation into the hosted database, run the seeder locally
against the remote connection string:

```bash
cd server
MONGO_URI="mongodb+srv://…/empcore" npm run seed
```

> `npm run seed` **wipes** the collections first. Never point it at a database
> holding real data. Pass `-- --keep` to append instead of replacing.

---

## Post-deploy checklist

- [ ] `GET https://<api>/api/health` returns `{"success":true}`
- [ ] `https://<api>/api/docs` renders the Swagger UI
- [ ] Signing in works, and **staying signed in after a page refresh** works
      (this is the `COOKIE_SAMESITE` check)
- [ ] A leave request submitted by an employee appears live in the manager's
      notification bell without a refresh (this is the Socket.IO check)
- [ ] Signing in as the manager and requesting an employee id outside their team
      returns 403
- [ ] Change the seeded demo passwords, or remove the demo accounts, before
      sharing the link anywhere public

---

## A note on the demo accounts

`npm run seed` creates twenty accounts that all share the password
`Password@123`, and the login page lists three of them. That is deliberate for a
portfolio demo, but it means **anyone with the URL has admin access**. If you
deploy this somewhere public and it ever holds data you care about, remove the
demo-account panel from `client/src/pages/Login.jsx` and seed with real
credentials.
