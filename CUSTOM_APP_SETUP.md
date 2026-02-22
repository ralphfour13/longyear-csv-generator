# Custom App Setup Guide

## Method 1: Shopify Admin Custom App (Recommended for Private Use)

This method creates a private app that only works on YOUR store. No app review needed!

### Step 1: Create Custom App in Shopify Admin

1. Go to your Shopify Admin
2. **Settings** → **Apps and sales channels**
3. Click **Develop apps**
4. Click **Allow custom app development** (if prompted)
5. Click **Create an app**
6. Name: **Sage 50 Journal Entry Sync**
7. Click **Create app**

### Step 2: Configure API Scopes

1. Click **Configure Admin API scopes**
2. Select these scopes:
   - ✅ **read_shopify_payments_payouts** - Access payout data
   - ✅ **read_shopify_payments_accounts** - Access balance transactions
   - ✅ **read_orders** - Access order details
3. Click **Save**

### Step 3: Install the App

1. Click **Install app**
2. Review permissions
3. Click **Install**

### Step 4: Get API Credentials

After installation:

1. Click **API credentials** tab
2. Copy these values:
   - **Admin API access token** (starts with `shpat_`)
   - **API key**
   - **API secret key**

### Step 5: Configure Your App

Create `.env` file:

```bash
# In your project directory
cat > .env << 'EOF'
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here
SHOPIFY_ACCESS_TOKEN=shpat_your_access_token_here
SHOP_DOMAIN=your-store.myshopify.com
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
EOF
```

### Step 6: Update App for Custom App Mode

Since this is a custom app, we need to simplify the authentication:

**Option A: Keep it simple for single store**

```bash
# Start the server
npm run build
npm start
```

The app will use the access token from `.env` directly.

**Option B: Still use embedded app (with custom app credentials)**

Update `shopify.app.toml`:

```toml
client_id = "YOUR_API_KEY_FROM_STEP_4"
```

Then run:
```bash
npm run dev
```

---

## Method 2: Standalone Server (No Shopify CLI)

For completely private deployment without Shopify CLI:

### Step 1: Same as Method 1 (Create custom app, get credentials)

### Step 2: Create Simplified Auth

Create `app/custom-auth.server.ts`:

```typescript
// Simple authentication for custom app
const SHOP = process.env.SHOP_DOMAIN!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

export async function getShopifyClient() {
  return {
    shop: SHOP,
    accessToken: ACCESS_TOKEN,
  };
}
```

### Step 3: Update Routes to Use Simple Auth

In your route loaders:

```typescript
import { getShopifyClient } from '../custom-auth.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, accessToken } = await getShopifyClient();

  // Your existing code...
};
```

### Step 4: Run Directly

```bash
# Build
npm run build

# Start server
PORT=3000 npm start
```

Access at: `http://localhost:3000`

---

## Quick Setup Script

I'll create a script to automate custom app setup:

```bash
./scripts/setup-custom-app.sh
```

This will:
1. Prompt for API credentials
2. Create .env file
3. Configure authentication
4. Start the server

---

## Which Method Should You Use?

**Method 1 (Custom App via Admin)**:
- ✅ Best for single store
- ✅ No app review needed
- ✅ 5 minute setup
- ✅ Use existing app code
- ⚠️ Need to handle auth differently

**Method 2 (Standalone Server)**:
- ✅ Complete control
- ✅ No Shopify CLI needed
- ✅ Simplest deployment
- ⚠️ Not embedded in Shopify admin

**Recommendation**: Start with **Method 1** for quick testing!
