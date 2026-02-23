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

### 2. Commit Changes

```bash
# Stage changes
git add <file-paths>

# Or stage all changes
git add -A

# Commit with descriptive message
git commit -m "Description of changes

Details about what was fixed or added

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>"

# Push to Production branch
git push origin Production
```

**Commit Message Best Practices**:
- First line: Brief summary (50 chars or less)
- Blank line
- Detailed description of changes
- Reference issue numbers if applicable
- Co-authored-by tag at end

---

### 3. Deploy to CapRover

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

### 4. Verify Deployment

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
