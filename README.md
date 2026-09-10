# CL Protection USA — Portal (Next.js + Neon Postgres, Vercel-ready)

Next.js 14 (App Router, TypeScript) · Neon Postgres via postgres.js (pure JS — no build engines) · Tailwind · secure JWT-cookie auth (bcrypt). Verified with `next build`.

Included: secure login (admin-created users only), protected app area with your logo, live Dashboard, Customers (list + create). Other nav items are placeholders that get wired to Neon next.

## 1) Free database
Neon (neon.tech) or Vercel → Storage → Postgres (Neon). Copy the connection string.

## 2) Environment variables (Vercel → Settings → Environment Variables, and local .env)
```
DATABASE_URL=<pooled Neon URL>?sslmode=require&pgbouncer=true
DIRECT_URL=<unpooled Neon URL>?sslmode=require
AUTH_SECRET=<long random string>
SUPERADMIN_NAME=System Owner
SUPERADMIN_EMAIL=owner@clprotectionusa.com
SUPERADMIN_PASSWORD=<your password>
```

## 3) Deploy on Vercel
Push this repo to GitHub → Vercel → Import → add the env vars → Deploy.

## 4) Create tables + first admin (one time, from your computer)
```
npm install
cp .env.example .env     # paste the same values
npm run db:setup         # creates all tables + your Super Admin in Neon
```

## 5) Log in
Open your Vercel URL → sign in with SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD → change password.

## Local dev
```
npm install
cp .env.example .env
npm run db:setup
npm run dev
```

## Security
bcrypt password hashing · no public sign-up · signed httpOnly/Secure/SameSite cookie session · middleware protects all app routes · disabled users can't log in.

## Custom domain
Vercel → Settings → Domains → add portal.clprotectionusa.com → set the CNAME Vercel shows.
