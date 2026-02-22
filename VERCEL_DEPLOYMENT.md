# Deploy to Vercel (Complete App)

Deploy the entire Sage 50 Journal Entry Sync app to Vercel using serverless functions.

## ⚠️ Important Considerations

### What Works on Vercel
- ✅ React Router v7 (fully supported)
- ✅ API routes as serverless functions
- ✅ Shopify authentication
- ✅ Manual CSV exports
- ✅ Database (with external PostgreSQL)

### What Needs Adjustment
- ⚠️ **File storage** - Use Vercel Blob Storage or S3
- ⚠️ **Scheduler** - Use Vercel Cron Jobs (not node-cron)
- ⚠️ **Database** - Use PostgreSQL (not SQLite)

---

## Quick Deploy (5 minutes)

### Step 1: Create vercel.json

```json
{
  "buildCommand": "npm run build",
  "framework": null,
  "installCommand": "npm install",
  "regions": ["iad1"],
  "env": {
    "NODE_ENV": "production",
    "SHOPIFY_API_KEY": "@shopify-api-key",
    "SHOPIFY_API_SECRET": "@shopify-api-secret",
    "DATABASE_URL": "@database-url"
  },
  "crons": [
    {
      "path": "/api/cron/nightly-export",
      "schedule": "0 2 * * *"
    }
  ]
}
```

### Step 2: Update Package.json Scripts

Add Vercel build script:

```json
{
  "scripts": {
    "build": "react-router build",
    "vercel-build": "prisma generate && react-router build"
  }
}
```

### Step 3: Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

---

## Configuration Changes Needed

### 1. Replace File Storage with Vercel Blob

Install Vercel Blob SDK:

```bash
npm install @vercel/blob
```

Update `app/services/storage.server.ts`:

```typescript
import { put, list, del } from '@vercel/blob';

export async function writeExport(
  shop: string,
  filename: string,
  content: string
): Promise<string> {
  const blob = await put(`${shop}/exports/${filename}`, content, {
    access: 'public',
  });

  return blob.url;
}

export async function listExports(shop: string): Promise<string[]> {
  const { blobs } = await list({ prefix: `${shop}/exports/` });
  return blobs.map(b => b.pathname.split('/').pop()!);
}
```

### 2. Replace Scheduler with Vercel Cron

Create `app/routes/api.cron.nightly-export.tsx`:

```typescript
import type { LoaderFunctionArgs } from 'react-router';
import { verifyVercelCronSignature } from '../utils/verify-cron';
import { processExport, calculateExportDates } from '../services/batch-processor.server';
import { getShopConfig } from '../services/storage.server';
import { prisma } from '../db.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Verify this is a legitimate Vercel cron request
  const isValid = await verifyVercelCronSignature(request);
  if (!isValid) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // Get all shops with enabled sync
    const shops = await getAllShopsWithSync();

    for (const shop of shops) {
      const config = await getShopConfig(shop.domain);

      if (config.syncEnabled && config.syncSchedule === 'nightly') {
        const { startDate, endDate } = calculateExportDates(config.autoExportDate);

        await processExport(shop.domain, shop.accessToken, startDate, endDate);
      }
    }

    return Response.json({ success: true, processed: shops.length });
  } catch (error) {
    console.error('Cron export failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
};
```

### 3. Use External PostgreSQL

Update `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Get a PostgreSQL database:
- **Vercel Postgres** (easiest)
- **Neon** (free tier)
- **Supabase** (free tier)

---

## Complete Vercel Deployment Steps

### Step 1: Install Dependencies

```bash
npm install @vercel/blob
```

### Step 2: Create Vercel Project

```bash
# Link to Vercel
vercel link

# Or create new project
vercel
```

### Step 3: Set Environment Variables

In Vercel dashboard or via CLI:

```bash
vercel env add SHOPIFY_API_KEY
vercel env add SHOPIFY_API_SECRET
vercel env add DATABASE_URL
vercel env add BLOB_READ_WRITE_TOKEN
```

### Step 4: Update Application URL

In `shopify.app.toml`:

```toml
application_url = "https://your-app.vercel.app"

[auth]
redirect_urls = [
  "https://your-app.vercel.app/auth/callback"
]
```

### Step 5: Deploy

```bash
vercel --prod
```

---

## Vercel Cron Jobs Setup

### Create Cron Route

File: `app/routes/api.cron.nightly-export.tsx`

```typescript
// Vercel Cron authentication
const CRON_SECRET = process.env.CRON_SECRET;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Run export logic
  // ... (same as scheduler logic)
};
```

### Configure in vercel.json

```json
{
  "crons": [
    {
      "path": "/api/cron/nightly-export",
      "schedule": "0 2 * * *"
    }
  ]
}
```

---

## File Storage Options for Vercel

### Option 1: Vercel Blob Storage (Recommended)

```bash
npm install @vercel/blob
```

Pros:
- ✅ Integrated with Vercel
- ✅ Simple API
- ✅ Free tier available

### Option 2: AWS S3

```bash
npm install @aws-sdk/client-s3
```

Pros:
- ✅ Cheaper at scale
- ✅ More control

### Option 3: Cloudflare R2

```bash
npm install @cloudflare/workers-types
```

Pros:
- ✅ No egress fees
- ✅ S3-compatible API

---

## Quick Start: Deploy to Vercel Now

I can create all the necessary configuration files for you. Would you like me to:

1. ✅ Create `vercel.json` configuration
2. ✅ Update storage service for Vercel Blob
3. ✅ Create Vercel Cron route
4. ✅ Update database config for PostgreSQL
5. ✅ Create deployment script

This will take about 5-10 minutes to set up, then you can deploy with one command!

---

## 🎯 Recommendation

**For your use case** (single store, scheduled exports):

**Deploy entirely to Vercel** because:
- ✅ Simpler than split deployment
- ✅ Vercel Cron handles scheduling
- ✅ Vercel Blob handles file storage
- ✅ One platform to manage
- ✅ Free tier sufficient
- ✅ Automatic SSL

**Avoid CapRover split** unless you specifically need:
- Self-hosted backend
- Custom server logic
- Existing CapRover infrastructure

---

**Should I configure everything for full Vercel deployment?** I can have it ready in 10 minutes!