# Deployment Workflow

Complete workflow for developing, committing, deploying, and testing the Sage 50 Journal Entry Sync app.

## 🔄 Standard Development & Deployment Flow

### 1. Make Code Changes

Edit files as needed:
```bash
# Example: Fix reconciliation logic
nano app/services/reconciler.server.ts

# Or use your preferred editor
code app/services/reconciler.server.ts
```

---

### 2. Commit and Push Changes

```bash
# Stage changes
git add <file-paths>

# Or stage all changes
git add -A

# Commit with descriptive message
git commit -m "Description of changes

Details about what was fixed or added

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"

# Push to Production branch (triggers CI/CD)
git push origin Production
```

**Commit Message Best Practices**:
- First line: Brief summary (50 chars or less)
- Blank line
- Detailed description of changes
- Reference issue numbers if applicable
- Co-authored-by tag at end

---

### 3. Automated CI/CD Pipeline (GitHub Actions)

**What happens automatically when you push to Production**:

1. **Pre-Deployment Checks** (~3 min)
   - Type checking (`npm run typecheck`)
   - Linting (`npm run lint`)
   - Build verification (`npm run build`)

2. **Change Detection**
   - Detects if `shopify.app.toml` changed
   - Determines whether Shopify deployment is needed

3. **CapRover Deployment** (~5 min)
   - Authenticates with CapRover
   - Creates deployment tarball
   - Deploys to production server
   - Uploads deployment logs

4. **Shopify Deployment** (~2 min, conditional)
   - Only runs if `shopify.app.toml` changed
   - Updates Shopify app configuration
   - Updates webhooks and scopes

5. **Post-Deployment Verification** (~2 min)
   - Health check with retry logic (12 attempts over 2 minutes)
   - Smoke tests (homepage, auth, health endpoint)
   - Verifies app is functional

6. **Notifications**
   - Updates GitHub commit status (✓ or ✗)
   - Sends Slack notification (if configured)

**Total Time**: ~10 minutes (with caching: ~5 minutes)

**Monitor Deployment**:
- Go to: https://github.com/four13co/sage50-journal-entry-sync/actions
- Click on the latest workflow run
- View real-time logs for each job

---

### 4. Manual Deployment (Fallback)

If CI/CD is down or you need to bypass it:

```bash
# Deploy with default settings (uses last deployment config)
caprover deploy --default
```

**What happens**:
1. CapRover tars the current directory
2. Uploads to CapRover server
3. Builds Docker image (uses `Dockerfile`)
4. Deploys new container
5. App restarts automatically

**Expected output**:
```
Preparing deployment to CapRover...
Deploying sage50-journal-entry-sync-prod to four13-cap...
Build has finished successfully!
Deployed successfully sage50-journal-entry-sync-prod
App is available at https://sage50-journal-entry-sync-prod.server.four13.dev
```

**Deployment time**: ~1-3 minutes

---

### 5. Verify Deployment

**Check CapRover logs** (via Dozzle or dashboard):
```
✅ Prisma Client generated
✅ Database synced
✅ Server started on port 80
✅ Scheduler initialized
```

**Look for errors**:
```
❌ Error: ...
❌ Uncaught exception: ...
```

---

### 5. Test in Shopify

1. **Refresh app** in Shopify Admin: `Cmd + Shift + R` (hard refresh)
2. **Test the feature** you just deployed
3. **Check functionality** works as expected

---

### 6. Monitor Logs

**Via CapRover Dashboard**:
- Apps → sage50-journal-entry-sync-prod → Logs

**Via Dozzle** (if available):
- Select container
- Watch real-time logs
- Download log files if needed

---

## 🤖 CI/CD Pipeline Details

### Overview

The GitHub Actions CI/CD pipeline automates the entire deployment process:
- **Triggers**: Every push to `Production` branch
- **Duration**: ~10 minutes (first run), ~5 minutes (cached)
- **Status**: Check commit status on GitHub or Actions tab
- **Logs**: Full deployment logs available in GitHub Actions

### Pipeline Architecture

```
Push to Production
    ↓
Pre-Deployment Checks (parallel: typecheck, lint, build)
    ↓
Change Detection (detect if shopify.app.toml changed)
    ↓
    ├─→ CapRover Deployment (always)
    └─→ Shopify Deployment (conditional)
    ↓
Post-Deployment Verification (health check, smoke tests)
    ↓
Notifications (success/failure alerts)
```

### Required GitHub Secrets

The following secrets must be configured in GitHub repository settings:

**Required**:
- `CAPROVER_API_TOKEN` - CapRover authentication token
- `SHOPIFY_CLI_TOKEN` - Shopify CLI authentication token
- `SHOPIFY_API_SECRET` - Shopify app API secret

**Optional**:
- `SLACK_WEBHOOK_URL` - Slack notifications

**To configure secrets**:
1. Go to: https://github.com/four13co/sage50-journal-entry-sync/settings/secrets/actions
2. Click "New repository secret"
3. Add each secret with its value

For detailed setup instructions, see: `GITHUB_SECRETS_SETUP.md`

### Monitoring Deployments

**View all deployments**:
- GitHub Actions: https://github.com/four13co/sage50-journal-entry-sync/actions
- Each workflow run shows:
  - Overall status (✓ success or ✗ failed)
  - Individual job statuses
  - Detailed logs for each step
  - Deployment artifacts (logs, health check results)

**Check deployment status**:
```bash
# View latest workflow runs
gh run list --limit 5

# View specific run details
gh run view <run-id>

# View run logs
gh run view <run-id> --log
```

**Health endpoint**:
```bash
# Check app health manually
curl https://sage50-sync.four13.dev/api/healthz | jq '.'

# Expected response:
# {
#   "status": "ok",
#   "timestamp": "2026-02-28T...",
#   "version": "1.0.0",
#   "checks": {
#     "database": "connected",
#     "filesystem": "accessible",
#     "prisma": "ready"
#   }
# }
```

### Conditional Deployments

**CapRover deployment**: Always runs on every push to Production

**Shopify deployment**: Only runs when `shopify.app.toml` is modified

This happens when you change:
- API scopes (read_orders, read_products, etc.)
- Webhook subscriptions
- App URL or domain
- App metadata

**Example scenarios**:

| Change Type | CapRover | Shopify | Reason |
|-------------|----------|---------|--------|
| Fix reconciliation bug | ✓ | ✗ | Code only |
| Update UI component | ✓ | ✗ | Frontend only |
| Add new API scope | ✓ | ✓ | Config changed |
| Change webhook topics | ✓ | ✓ | Config changed |
| Update dependencies | ✓ | ✗ | Code only |

### Troubleshooting Failed Deployments

**If pre-checks fail**:
1. Check the error in GitHub Actions logs
2. Run the same check locally:
   ```bash
   npm run typecheck  # or lint, or build
   ```
3. Fix the errors
4. Commit and push again

**If CapRover deployment fails**:
1. Check CapRover authentication secrets
2. Verify CapRover server is accessible
3. Review deployment logs artifact
4. Check CapRover dashboard for errors
5. Manual fallback: `caprover deploy --default`

**If health check fails**:
1. Check CapRover logs for startup errors
2. Test health endpoint manually:
   ```bash
   curl https://sage50-sync.four13.dev/api/healthz
   ```
3. Verify database connection (DATABASE_URL)
4. Check environment variables in CapRover
5. Review recent code changes for breaking issues

**If Shopify deployment fails**:
1. Verify SHOPIFY_CLI_TOKEN is valid
2. Check Shopify Partners dashboard
3. Ensure shopify.app.toml is valid
4. Manual fallback: `npm run deploy`

### Rollback Procedures

**Option 1: CapRover Dashboard (Fastest)**
1. Go to https://captain.server.four13.dev
2. Navigate to Apps → sage50-journal-entry-sync-prod
3. Click "Deploy Previous Image"
4. App reverts to last working version

**Option 2: CapRover CLI**
```bash
caprover rollback --app sage50-journal-entry-sync-prod
```

**Option 3: Git Revert + Redeploy**
```bash
# Revert the bad commit
git revert HEAD

# Push to trigger CI/CD
git push origin Production

# CI/CD automatically deploys reverted version
```

**Recommended**: Option 1 (fastest, no git noise)

### Helper Scripts

The following CI helper scripts are available:

**Health Check Script**:
```bash
# Check health with retry logic
./scripts/ci-health-check.sh https://sage50-sync.four13.dev/api/healthz
```

**Smoke Tests**:
```bash
# Run comprehensive smoke tests
./scripts/ci-smoke-tests.sh https://sage50-sync.four13.dev
```

**CapRover Deployment**:
```bash
# Deploy manually using the CI script
CAPROVER_API_TOKEN=xxx ./scripts/ci-deploy-caprover.sh
```

### Performance Optimization

**First deployment** (no cache):
- Pre-checks: 5 minutes
- CapRover deploy: 5 minutes
- Health checks: 2 minutes
- **Total**: ~12 minutes

**Subsequent deployments** (with cache):
- Pre-checks: 2 minutes (cached node_modules)
- CapRover deploy: 3 minutes
- Health checks: 2 minutes
- **Total**: ~7 minutes

**Shopify deployment** (when triggered):
- Additional 2 minutes

### CI/CD Best Practices

1. **Always check GitHub Actions status** after pushing
2. **Don't force push to Production** - breaks CI/CD tracking
3. **Use descriptive commit messages** - shows in deployment notifications
4. **Test locally first** with `npm run build` before pushing
5. **Monitor first deployment** after pushing new code
6. **Keep secrets up to date** - rotate tokens quarterly
7. **Review failed deployment logs** before retrying

---

## 🚀 Complete Deployment Sequence

**Full workflow in one command block**:

```bash
# 1. Check what changed
git status

# 2. Review changes
git diff

# 3. Stage changes
git add -A

# 4. Commit
git commit -m "Your commit message

Detailed description

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"

# 5. Push to GitHub
git push origin Production

# 6. Deploy to CapRover
caprover deploy --default

# 7. Monitor logs (in CapRover dashboard)
```

---

## 📋 Common Workflows

### Hot Fix Workflow

```bash
# Make quick fix
nano app/services/reconciler.server.ts

# Quick commit and deploy
git add -A && \
git commit -m "Fix: Brief description" && \
git push origin Production && \
caprover deploy --default
```

---

### Test Before Deploying

```bash
# Build locally first
npm run build

# Type check
npm run typecheck

# If builds successfully, then deploy
git add -A && git commit -m "Message" && \
git push origin Production && \
caprover deploy --default
```

---

### Rollback to Previous Version

```bash
# See recent commits
git log --oneline -10

# Rollback to specific commit
git reset --hard <commit-hash>

# Force push
git push origin Production --force

# Redeploy
caprover deploy --default
```

---

## 🔧 CapRover Configuration

### Environment Variables

**Location**: CapRover Dashboard → sage50-journal-entry-sync-prod → App Configs

**Required variables**:
```
NODE_ENV=production
SHOPIFY_APP_URL=https://sage50-sync.four13.dev
SHOPIFY_API_KEY=ec004ce28be778f86415a4b18a7ab9a2
SHOPIFY_API_SECRET=your_secret
DATABASE_URL=postgresql://...neon.tech/sage50-journal-entry-sync?sslmode=require
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
```

**To update environment variables**:
1. CapRover Dashboard → App Configs
2. Edit variables
3. Click **Save & Update**
4. App restarts automatically

---

### Persistent Storage

**Configuration**: `/app/data` directory is persistent

**Location**: CapRover Dashboard → App Configs → Persistent Directories

**Path in App**: `/app/data`
**Label**: `sage50-data`

**What's stored**:
```
/app/data/
  adersg-7z.myshopify.com/
    config.json
    mappings.json
    error.log
    scheduled-exports.log
    exports/
      journal-entries-*.csv
      daily-sales-report_*.csv
```

---

## 🐛 Debugging Workflow

### When Something Breaks

1. **Check CapRover logs immediately**
   - Look for error messages
   - Check if app started successfully

2. **Common errors and fixes**:

   **Error**: `Detected an empty appUrl configuration`
   **Fix**: Check `SHOPIFY_APP_URL` environment variable is set

   **Error**: `Database connection failed`
   **Fix**: Check `DATABASE_URL` is correct Neon connection string

   **Error**: `listen EADDRNOTAVAIL`
   **Fix**: Ensure start command has `HOST=0.0.0.0`

   **Error**: `Prisma migration failed`
   **Fix**: Use `prisma db push` instead of `migrate deploy`

3. **Add debug logging**:
   ```typescript
   console.log('Debug:', someVariable);
   await logInfo(shop, 'Context', 'Message', data);
   ```

4. **Redeploy with logging**:
   ```bash
   git add -A && git commit -m "Add debug logging" && \
   git push origin Production && \
   caprover deploy --default
   ```

---

## 📊 Testing Workflow

### After Each Deployment

1. **Refresh Shopify app** (hard refresh)
2. **Test the specific feature** you changed
3. **Generate test export** (e.g., Feb 21, 2026)
4. **Download and validate CSV**:
   ```bash
   ./scripts/validate-csv.sh ~/Downloads/journal-entries-*.csv
   ```
5. **Check CapRover logs** for errors

---

### Validate CSV Files

```bash
# Validate balance
./scripts/validate-csv.sh ~/Downloads/journal-entries-2026-02-21.csv

# Expected output:
# ✓ Header is correct
# ✓ Entries are balanced!
# ✓ All dates in correct format
# Status: ✅ Ready for import
```

---

### Check Application Logs

```bash
# View recent logs for a shop
./scripts/view-logs.sh adersg-7z.myshopify.com

# You'll see:
# - Error log entries
# - Scheduled export history
# - Recent exports
```

---

## 🎯 Common Tasks

### Update Shopify App Configuration

```bash
# 1. Edit config
nano shopify.app.sage-50-sync-for-fly-shop.toml

# 2. Commit
git add shopify.app.sage-50-sync-for-fly-shop.toml && \
git commit -m "Update Shopify app config" && \
git push origin Production

# 3. Redeploy to Shopify
shopify app deploy --force
```

---

### Update Database Schema

```bash
# 1. Edit Prisma schema
nano prisma/schema.prisma

# 2. Generate client locally
npx prisma generate

# 3. Commit and deploy
git add prisma/schema.prisma && \
git commit -m "Update database schema" && \
git push origin Production && \
caprover deploy --default

# 4. Database updates automatically via prisma db push in docker-start script
```

---

### Add New Dependencies

```bash
# 1. Install locally
npm install <package-name>

# 2. Commit package.json and package-lock.json
git add package.json package-lock.json && \
git commit -m "Add <package-name> dependency" && \
git push origin Production

# 3. Deploy (npm install runs automatically in Docker build)
caprover deploy --default
```

---

## 📝 Branch Structure

**Main branches**:
- `Production` - Production-ready code (default branch)
- `Development` - Integration branch for testing
- `main` - Initial branch (not used)

**Workflow**:
1. Work directly on `Production` for hot fixes
2. Or create feature branches and merge to `Production`

**Current branch**:
```bash
# Check current branch
git branch --show-current

# Switch to Production
git checkout Production

# Pull latest
git pull origin Production
```

---

## 🔐 Important Files

### Configuration Files

| File | Purpose |
|------|---------|
| `shopify.app.sage-50-sync-for-fly-shop.toml` | Shopify app config (CRITICAL) |
| `captain-definition` | CapRover deployment config |
| `Dockerfile` | Docker container definition |
| `.dockerignore` | Files to exclude from Docker |
| `package.json` | Dependencies and scripts |
| `prisma/schema.prisma` | Database schema |

### Never Commit

`.gitignore` already excludes:
- `.env*` files (contains secrets)
- `node_modules/`
- `build/`
- `data/` (local data directory)

---

## 🚨 Emergency Procedures

### App Won't Start

```bash
# 1. Check environment variables in CapRover
# 2. Check logs for specific error
# 3. Verify DATABASE_URL is correct
# 4. Try restarting app in CapRover dashboard
```

### Deploy Failed

```bash
# 1. Check Docker build logs in CapRover
# 2. Verify Dockerfile is valid
# 3. Check for TypeScript errors:
npm run typecheck

# 4. Try deploying again
caprover deploy --default
```

### Export Not Working

```bash
# 1. Check Shopify API credentials
# 2. Verify DATABASE_URL has valid session
# 3. Check CapRover logs during export
# 4. Test with a known good date (e.g., yesterday)
```

---

## 📚 Quick Reference

### Essential Commands

```bash
# Deploy
caprover deploy --default

# Deploy to Shopify
shopify app deploy --force

# Commit everything
git add -A && git commit -m "Message" && git push origin Production

# Check logs
# (Use CapRover Dashboard → Logs tab)

# Validate CSV
./scripts/validate-csv.sh <file>

# View shop logs
./scripts/view-logs.sh <shop-domain>
```

---

### Environment URLs

- **App URL**: https://sage50-sync.four13.dev
- **CapRover**: https://captain.server.four13.dev
- **GitHub**: https://github.com/four13co/sage50-journal-entry-sync
- **Shopify Partners**: https://partners.shopify.com/129641350/apps/326053265409
- **Neon Database**: https://console.neon.tech

---

## 🎉 Complete Deployment Example

**Scenario**: Fix a reconciliation bug

```bash
# 1. Edit the file
nano app/services/reconciler.server.ts

# 2. Test locally (optional)
npm run build

# 3. Commit with descriptive message
git add app/services/reconciler.server.ts
git commit -m "Fix edited orders bug - use current_* fields

Uses current_subtotal_price instead of subtotal_price
Excludes removed items from sales calculation
Fixes orders #80915, #80916

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"

# 4. Push to GitHub
git push origin Production

# 5. Deploy to CapRover
caprover deploy --default

# 6. Wait for deployment (~2 min)
# Watch CapRover logs for "Deployed successfully"

# 7. Test in Shopify
# - Refresh app (Cmd+Shift+R)
# - Generate export
# - Validate CSV
# - Verify fix works

# 8. If working, celebrate! 🎉
# If not, check logs and repeat
```

---

## 💡 Pro Tips

1. **Always hard refresh** Shopify app after deployment (`Cmd+Shift+R`)
2. **Check CapRover logs** immediately after deployment
3. **Test with recent data** (last few days)
4. **Validate CSVs** before importing to Sage 50
5. **Commit often** with descriptive messages
6. **Use `--default` flag** on caprover deploy to avoid prompts

---

## 📞 Getting Help

**If stuck**:
1. Check CapRover logs first
2. Review this document
3. Check main README.md
4. Review DEPLOYMENT.md for detailed troubleshooting

**Common issues**:
- App not loading → Check SHOPIFY_APP_URL env var
- Export failing → Check DATABASE_URL and session
- Download not working → Use JavaScript window.open()
- Imbalanced entries → Check reconciler logic and Shopify data

---

**This workflow has been tested and proven through multiple iterations!** ✅

Use this as your reference for all future deployments.
