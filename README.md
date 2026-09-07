# BFAR IEC Inventory

A separate BFAR Region 4A IEC inventory web app prepared for Supabase + Vercel.

## Important separation

This project is **not connected to VCCFSM**. Do not use the VCCF Supabase project or VCCFSM Vercel project when following these steps.

## Included

- Supabase Auth email/password login
- Roles: `admin`, `inventory_staff`, `viewer`
- IEC material records and image uploads
- Supabase Storage bucket for IEC photos
- Stock In / Stock Out audit trail
- Database-enforced prevention of negative stock
- Responsive dashboard
- Search and stock filters
- Monthly Excel `.xlsx` report
  - Monthly Movement sheet with one horizontal column per transaction
  - Transaction Details sheet
  - Inventory Summary sheet
- RLS policies for database and storage

## 1. Create a NEW Supabase account/project

Sign into the BFAR Supabase account and create a project named, for example:

`BFAR IEC Inventory`

Recommended region for the Philippines: Singapore / `ap-southeast-1` if offered.

Do not reuse the VCCF Santa Maria Supabase project.

## 2. Run the database migration

In the NEW BFAR Supabase project, open SQL Editor and run:

`supabase/migrations/001_initial.sql`

This creates:

- `profiles`
- `iec_materials`
- `iec_transactions`
- `iec-images` Storage bucket
- Auth profile trigger
- stock synchronization trigger
- RLS policies

## 3. Create the first user

In Supabase Dashboard > Authentication > Users, create the first staff account.

The migration automatically creates a `viewer` profile. Promote the first user to admin in SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = 'PASTE_AUTH_USER_UUID_HERE';
```

Additional users may be assigned:

- `admin`
- `inventory_staff`
- `viewer`

Example:

```sql
update public.profiles
set role = 'inventory_staff'
where id = 'PASTE_AUTH_USER_UUID_HERE';
```

## 4. Get Supabase frontend credentials

From the NEW BFAR Supabase project, copy:

- Project URL
- Publishable key (`sb_publishable_...`)

Never place a service-role or secret key in this frontend project.

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Then fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

## 5. Run locally

Node.js 22+ is recommended.

```bash
npm install
# npm install creates package-lock.json; commit that lockfile to Git.
npm run dev
```

Open `http://localhost:3000`.

## 6. Put it in a separate GitHub repository

Create a new repository in the BFAR GitHub account, for example:

`bfar-iec-inventory`

Then from this folder:

```bash
git init
git add .
git commit -m "Initial BFAR IEC Inventory app"
git branch -M main
git remote add origin YOUR_BFAR_GITHUB_REPOSITORY_URL
git push -u origin main
```

## 7. Deploy using the separate BFAR Vercel account

In the BFAR Vercel account:

1. Add New > Project.
2. Import the new `bfar-iec-inventory` GitHub repository.
3. Framework should be detected as Next.js.
4. Add these environment variables for Production and Preview:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. Deploy.

Vercel will provide a temporary `*.vercel.app` URL. A BFAR custom domain can be added later.

## Security notes

- All public-schema tables have Row Level Security enabled.
- Viewer accounts are read-only.
- Inventory Staff can add/edit materials and record stock movements.
- Admins additionally receive the archive control.
- Transactions are immutable in the client and database API policies; corrections should be represented by a new compensating stock transaction rather than deleting history.
- IEC photos are in a public-read Storage bucket so thumbnails work directly from Vercel. Upload/update/delete access is still restricted to authenticated staff/admin users. If the IEC images must be private, change the bucket to private and use signed URLs instead.

## After initial Supabase setup

Run Supabase Security and Performance Advisors and fix any notices before production use.
