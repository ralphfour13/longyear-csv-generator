# 1Password Secrets Setup for CI/CD

This document provides step-by-step instructions for configuring 1Password to securely manage secrets for the CI/CD pipeline.

## Overview

The CI/CD pipeline uses **1Password** as the single source of truth for all secrets. This provides:

✅ **Centralized secret management** - One place to manage all credentials
✅ **Easy rotation** - Update secrets in 1Password, no GitHub changes needed
✅ **Better security** - Secrets never stored directly in GitHub
✅ **Audit trail** - 1Password tracks all secret access
✅ **Team access** - Easy to share with team members securely

**Only one GitHub secret is required**: `OP_SERVICE_ACCOUNT_TOKEN`

All other secrets (CapRover, Shopify, Slack) are pulled from 1Password at runtime.

---

## Architecture

```
GitHub Actions Workflow
    ↓
Uses OP_SERVICE_ACCOUNT_TOKEN
    ↓
1Password Load Secrets Action
    ↓
Fetches secrets from 1Password vault
    ↓
Exports as environment variables
    ↓
Used by deployment steps
```

---

## Step 1: Organize Secrets in 1Password

### Create or Use Existing Vault

1. Open 1Password
2. Create a new vault named **"sage50-sync"** (or use an existing vault)
3. This vault will store all CI/CD secrets

### Create Secret Items

Create the following items in the **sage50-sync** vault:

#### 1. CapRover Credentials

**Item name**: `caprover`
**Item type**: Password or Login

**Fields**:
- **api-token**: Your CapRover API token
  - Get from: https://captain.server.four13.dev → Account → API Token
  - Click "Generate New Token"
  - Copy and paste into this field

**1Password reference**: `op://sage50-sync/caprover/api-token`

---

#### 2. Shopify Credentials

**Item name**: `shopify`
**Item type**: Password or Login

**Fields**:
- **cli-token**: Shopify CLI authentication token
  - Generate with: `shopify auth login`
  - Or get from: `~/.config/shopify/cli.yml`

- **api-secret**: Shopify App API secret
  - Get from: https://partners.shopify.com → Your App → Client credentials → Client secret

**1Password references**:
- CLI Token: `op://sage50-sync/shopify/cli-token`
- API Secret: `op://sage50-sync/shopify/api-secret`

---

#### 3. Slack Webhook (Optional)

**Item name**: `slack`
**Item type**: Password or Login

**Fields**:
- **webhook-url**: Slack incoming webhook URL
  - Get from: https://api.slack.com/apps → Create App → Incoming Webhooks
  - Add to workspace and copy webhook URL

**1Password reference**: `op://sage50-sync/slack/webhook-url`

---

## Step 2: Create 1Password Service Account

A **service account** is a special type of 1Password account designed for automation (like CI/CD).

### Create Service Account

1. **Sign in to 1Password** as an admin: https://start.1password.com
2. Navigate to **Settings** → **Integrations** → **Service Accounts**
3. Click **"Create Service Account"**
4. Name it: `GitHub Actions - sage50-sync`
5. Set description: `CI/CD pipeline for Sage 50 Journal Entry Sync`

### Grant Vault Access

1. In the service account settings, click **"Grant Access to Vaults"**
2. Select the **sage50-sync** vault
3. Set permission to **Read Only** (service accounts should never write)
4. Save changes

### Get Service Account Token

1. After creating the service account, 1Password will display the token **once**
2. **Copy the token immediately** - it looks like: `ops_xxxxxxxxxxxxxxxxxxxxx`
3. **Save it securely** - you'll need it for the next step
4. If you lose it, you must create a new service account

**⚠️ Warning**: This token provides access to all secrets in the vault. Treat it like a master password.

---

## Step 3: Add Service Account Token to GitHub

Now add the **only GitHub secret** you need:

1. Go to your repository: https://github.com/four13co/sage50-journal-entry-sync
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Enter details:
   - **Name**: `OP_SERVICE_ACCOUNT_TOKEN`
   - **Value**: Paste the service account token from Step 2
5. Click **"Add secret"**

**That's it!** No other GitHub secrets needed.

---

## Step 4: Verify 1Password References

The workflow uses these 1Password references:

```yaml
# CapRover deployment
CAPROVER_API_TOKEN: op://sage50-sync/caprover/api-token

# Shopify deployment
SHOPIFY_CLI_TOKEN: op://sage50-sync/shopify/cli-token
SHOPIFY_API_SECRET: op://sage50-sync/shopify/api-secret

# Slack notifications (optional)
SLACK_WEBHOOK_URL: op://sage50-sync/slack/webhook-url
```

**Reference format**: `op://[vault-name]/[item-name]/[field-name]`

### Verify Your Setup

Use the 1Password CLI to test references locally:

```bash
# Install 1Password CLI (if not already installed)
brew install 1password-cli

# Authenticate with service account
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxxxxxxxxxxxxxxxxxxxx"

# Test fetching secrets
op read "op://sage50-sync/caprover/api-token"
op read "op://sage50-sync/shopify/cli-token"
op read "op://sage50-sync/shopify/api-secret"
```

If these commands return the correct values, your 1Password setup is correct!

---

## Step 5: Test the Pipeline

After completing the setup, test the CI/CD pipeline:

1. **Make a test commit**:
   ```bash
   git commit --allow-empty -m "Test CI/CD with 1Password"
   git push origin Production
   ```

2. **Monitor the workflow**:
   - Go to: https://github.com/four13co/sage50-journal-entry-sync/actions
   - Watch the workflow run
   - Check that secrets load successfully

3. **Verify deployment**:
   ```bash
   curl https://sage50-sync.four13.dev/api/healthz | jq '.'
   ```

---

## Troubleshooting

### "Failed to load secrets from 1Password"

**Symptoms**: Workflow fails at "Load secrets from 1Password" step

**Possible causes**:
1. OP_SERVICE_ACCOUNT_TOKEN not set in GitHub
2. Service account token is invalid or expired
3. Service account doesn't have access to vault
4. Secret reference format is incorrect

**Solutions**:
1. Verify OP_SERVICE_ACCOUNT_TOKEN exists in GitHub secrets
2. Test token locally: `op read "op://sage50-sync/caprover/api-token"`
3. Check service account has Read access to sage50-sync vault
4. Verify reference format: `op://vault/item/field`

---

### "Secret reference not found"

**Symptoms**: Error message like "item 'shopify' not found in vault 'sage50-sync'"

**Solutions**:
1. Verify item name in 1Password matches reference exactly (case-sensitive)
2. Ensure item is in the correct vault (sage50-sync)
3. Check field name matches exactly
4. Refresh 1Password to sync changes

---

### "Service account token invalid"

**Symptoms**: Authentication fails immediately

**Solutions**:
1. Check token was copied correctly (no extra spaces/newlines)
2. Verify token starts with `ops_`
3. Create a new service account if token is lost
4. Update GitHub secret with new token

---

### Testing Individual Secrets Locally

Use 1Password CLI to debug:

```bash
# Set service account token
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxxxxxxxxxxxxxxxxxxxx"

# List all items in vault
op item list --vault sage50-sync

# Get details of specific item
op item get caprover --vault sage50-sync

# Read specific field
op read "op://sage50-sync/caprover/api-token"
```

---

## Security Best Practices

### Service Account Management

1. **Rotate service accounts quarterly**
   - Create new service account
   - Update GitHub secret
   - Delete old service account

2. **Use Read-Only access**
   - Service accounts should never write to vaults
   - Prevents accidental or malicious modifications

3. **One service account per environment**
   - Production: GitHub Actions (sage50-sync)
   - Development: Separate service account if needed

### Secret Rotation

**To rotate a secret** (e.g., CapRover API token):

1. Generate new token in CapRover Dashboard
2. Update the field in 1Password item
3. **No GitHub changes needed!** Next deployment uses new token
4. Revoke old token in CapRover

**Benefits**:
- No downtime
- No GitHub secret updates
- Centralized management

### Audit Trail

**Monitor secret access**:

1. In 1Password, go to **Activity** log
2. Filter by service account name
3. Review all secret accesses
4. Alert on unusual activity

---

## Migration from GitHub Secrets

If you previously had secrets in GitHub, you can remove them:

1. Go to: https://github.com/four13co/sage50-journal-entry-sync/settings/secrets/actions
2. Delete these secrets (no longer needed):
   - `CAPROVER_API_TOKEN` ✗
   - `CAPROVER_PASSWORD` ✗
   - `SHOPIFY_CLI_TOKEN` ✗
   - `SHOPIFY_API_SECRET` ✗
   - `SLACK_WEBHOOK_URL` ✗

3. Keep only:
   - `OP_SERVICE_ACCOUNT_TOKEN` ✓

---

## 1Password CLI Reference

### Installation

```bash
# macOS
brew install 1password-cli

# Linux
wget https://downloads.1password.com/linux/debian/amd64/stable/1password-cli-latest-amd64.deb
sudo dpkg -i 1password-cli-latest-amd64.deb

# Verify installation
op --version
```

### Common Commands

```bash
# Authenticate with service account
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxxxxxxxxxxxxxxxxxxxx"

# List vaults
op vault list

# List items in vault
op item list --vault sage50-sync

# Get item details
op item get caprover --vault sage50-sync --format json

# Read specific field
op read "op://sage50-sync/caprover/api-token"

# Read multiple secrets
op read "op://sage50-sync/caprover/api-token" "op://sage50-sync/shopify/cli-token"
```

---

## Reference: 1Password Item Structure

### Expected Vault Structure

```
sage50-sync (Vault)
├── caprover (Item)
│   └── api-token (Field)
├── shopify (Item)
│   ├── cli-token (Field)
│   └── api-secret (Field)
└── slack (Item)
    └── webhook-url (Field)
```

### Creating Items via CLI (Optional)

```bash
# Create CapRover item
op item create \
  --category=password \
  --title="caprover" \
  --vault="sage50-sync" \
  api-token="your-token-here"

# Create Shopify item with multiple fields
op item create \
  --category=password \
  --title="shopify" \
  --vault="sage50-sync" \
  cli-token="your-cli-token" \
  api-secret="your-api-secret"
```

---

## Quick Reference

### Required Setup
- ✅ 1Password account with admin access
- ✅ Service account created with vault access
- ✅ OP_SERVICE_ACCOUNT_TOKEN added to GitHub
- ✅ All secrets organized in sage50-sync vault

### Secret References
```
op://sage50-sync/caprover/api-token
op://sage50-sync/shopify/cli-token
op://sage50-sync/shopify/api-secret
op://sage50-sync/slack/webhook-url
```

### Testing Commands
```bash
export OP_SERVICE_ACCOUNT_TOKEN="ops_xxxxx"
op read "op://sage50-sync/caprover/api-token"
```

---

## Next Steps

After completing this setup:

1. ✅ Test CI/CD pipeline with empty commit
2. ✅ Verify all secrets load successfully
3. ✅ Monitor first automated deployment
4. ✅ Set calendar reminder for quarterly token rotation
5. ✅ Document any custom secrets or configuration
6. ✅ Remove old GitHub secrets (except OP_SERVICE_ACCOUNT_TOKEN)

---

**Security Reminder**: The service account token is the only secret stored in GitHub. All other secrets are securely managed in 1Password with proper audit logging and access controls.

---

Last updated: 2026-02-28
