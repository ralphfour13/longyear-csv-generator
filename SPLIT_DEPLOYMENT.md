# Split Deployment Guide: Vercel + CapRover

Deploy frontend to Vercel and backend to CapRover for optimal performance and scaling.

## Architecture Overview

```
┌─────────────────┐
│  Vercel         │  Frontend
│  - React UI     │  - Static hosting
│  - Polaris      │  - Edge network
│  - Client code  │  - Fast delivery
└────────┬────────┘
         │ API calls
         ▼
┌─────────────────┐
│  CapRover       │  Backend
│  - API routes   │  - Node.js server
│  - Shopify API  │  - Database
│  - Scheduler    │  - File storage
│  - CSV export   │  - Cron jobs
└─────────────────┘
```

## Prerequisites

- ✅ Vercel account (free tier works)
- ✅ CapRover instance running
- ✅ Domain for backend (e.g., api.yourdomain.com)
- ✅ SSL certificate for backend

## Part 1: Backend Deployment (CapRover)

### Step 1: Prepare Backend Configuration

Create `captain-definition` file:

```json
{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile.backend"
}
```

### Step 2: Create Backend Dockerfile

```dockerfile
# Dockerfile.backend
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci --only=production

# Generate Prisma client
RUN npx prisma generate

# Copy app files (backend only)
COPY app/services ./app/services
COPY app/types ./app/types
COPY app/utils ./app/utils
COPY app/routes/api.* ./app/routes/
COPY app/routes/webhooks.* ./app/routes/
COPY app/db.server.ts ./app/
COPY app/shopify.server.ts ./app/
COPY app/server-init.ts ./app/

# Copy build output
COPY build/server ./build/server

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
```

### Step 3: Deploy to CapRover

```bash
# Build backend
npm run build

# Deploy to CapRover
# Replace with your CapRover details
caprover deploy \
  --appName sage50-backend \
  --imageName sage50-backend:latest

# Or use captain-cli
captain deploy
```

### Step 4: Configure Environment Variables in CapRover

In CapRover dashboard, set these environment variables:

```bash
NODE_ENV=production
SHOPIFY_API_KEY=your_key
SHOPIFY_API_SECRET=your_secret
DATABASE_URL=postgresql://...
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
```

### Step 5: Enable Persistent Storage

In CapRover, add persistent directory:
```
/app/data → /var/lib/caprover/data/sage50-backend/data
```

This ensures CSV exports and logs persist across deployments.

---

## Part 2: Frontend Deployment (Vercel)

### Step 1: Create Vercel Configuration

Create `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "build/client",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": null,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend.yourdomain.com/api/:path*"
    },
    {
      "source": "/:path*",
      "destination": "/index.html"
    }
  ],
  "env": {
    "VITE_BACKEND_URL": "https://your-backend.yourdomain.com"
  }
}
```

### Step 2: Configure Build for Split Deployment

Update `vite.config.ts`:

```typescript
export default defineConfig({
  // ... existing config
  build: {
    outDir: 'build/client',
    // Client-only build
  },
  define: {
    'process.env.BACKEND_URL': JSON.stringify(
      process.env.VITE_BACKEND_URL || 'http://localhost:3000'
    ),
  },
});
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

Or connect via Vercel dashboard:
1. Import GitHub repo
2. Configure build settings
3. Add environment variables
4. Deploy

---

## Part 3: Update Shopify App Configuration

### Update shopify.app.toml

```toml
application_url = "https://your-backend.yourdomain.com"
embedded = true

[auth]
redirect_urls = [
  "https://your-backend.yourdomain.com/auth/callback",
  "https://your-backend.yourdomain.com/auth/shopify/callback"
]
```

### Update Application URLs in Partner Dashboard

1. Go to Shopify Partners
2. Your app → Configuration
3. Update:
   - **App URL**: `https://your-backend.yourdomain.com`
   - **Allowed redirection URLs**: `https://your-backend.yourdomain.com/auth/callback`

---

## Alternative: Simpler Approach (All on CapRover)

Since you already have CapRover, you could deploy **everything** there:

### Single CapRover Deployment

```bash
# Deploy entire app to CapRover
captain deploy

# Set environment variables
# Add persistent storage for /app/data
# Done!
```

**Benefits**:
- ✅ Simpler configuration
- ✅ Everything in one place
- ✅ No CORS issues
- ✅ Easier to manage

**Vercel + CapRover only makes sense if**:
- You need global CDN for frontend
- You expect high traffic
- You want edge deployment

---

## 🎯 My Recommendation

**For Sage 50 Journal Entry Sync**:

Deploy **everything to CapRover**:
1. Simpler setup
2. No split architecture complexity
3. Scheduler works out of the box
4. File storage easier to manage

**Would you like me to**:
1. ✅ Create CapRover deployment config (recommended)
2. Create Vercel + CapRover split setup
3. Something else?

Let me know and I'll create the configuration files!