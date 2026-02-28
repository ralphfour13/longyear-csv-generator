# GitHub Secrets Setup for CI/CD

This document provides step-by-step instructions for configuring the GitHub secrets required for the CI/CD pipeline.

## Overview

The CI/CD pipeline requires several secrets to authenticate with CapRover and Shopify during automated deployments. These secrets are stored securely in GitHub and are never exposed in logs or code.

## Required Secrets

### 1. CAPROVER_API_TOKEN (Recommended)

**Purpose**: Authenticate CI/CD with CapRover for automated deployments

**How to generate**:

1. Open CapRover Dashboard: https://captain.server.four13.dev
2. Log in with your credentials
3. Click on your username in the top-right corner
4. Select "Account Settings" or "API Token"
5. Click "Generate New Token"
6. Copy the generated token (you won't see it again!)
7. Save it immediately to GitHub secrets

**Alternative**: `CAPROVER_PASSWORD`
- If you don't have an API token, you can use `CAPROVER_PASSWORD` instead
- Less secure than API token
- Use the same password you use to log in to CapRover Dashboard

**Security Note**: API tokens are preferred over passwords because:
- They can be revoked without changing your password
- They have limited scope
- They're designed for automation

---

### 2. SHOPIFY_CLI_TOKEN

**Purpose**: Authenticate Shopify CLI for automated app deployments

**How to generate**:

1. Open a terminal on your local machine
2. Run the following command:
   ```bash
   shopify auth login
   ```
3. Follow the prompts to authenticate with Shopify
4. After successful authentication, the CLI will display your token
5. Copy the token from the CLI output
6. Save it immediately to GitHub secrets

**Example output**:
```
✓ Logged in to Shopify
Your CLI token is: shp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Token Location**:
- The token is also stored locally at: `~/.config/shopify/cli.yml`
- You can retrieve it from there if you missed the CLI output

**Token Expiration**:
- Shopify CLI tokens may expire after some time
- If deployments start failing, regenerate the token using the same steps

---

### 3. SHOPIFY_API_SECRET

**Purpose**: Shopify app API secret for authentication during deployment

**How to get**:

1. Go to Shopify Partners Dashboard: https://partners.shopify.com
2. Navigate to: Apps → Your Apps
3. Click on "sage-50-sync-for-fly-shop" (or your app name)
4. In the app details page, find "Client credentials"
5. Copy the "Client secret" value
6. Save it to GitHub secrets

**Security Warning**:
- NEVER commit this secret to your repository
- NEVER share it publicly
- Rotate it if you suspect it's been compromised

---

## Optional Secrets

### 4. SLACK_WEBHOOK_URL (Optional)

**Purpose**: Send deployment notifications to Slack channel

**How to generate**:

1. Go to: https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name it "CI/CD Notifications" and select your workspace
4. In the app settings, click "Incoming Webhooks"
5. Toggle "Activate Incoming Webhooks" to ON
6. Click "Add New Webhook to Workspace"
7. Select the channel where you want notifications
8. Copy the webhook URL (looks like: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX`)
9. Save it to GitHub secrets

**What you'll receive**:
- Deployment success/failure notifications
- Commit information (SHA, author, message)
- Links to GitHub Actions logs
- Direct link to deployed app

**Fallback**:
- If this secret is not configured, the pipeline still works
- You just won't get Slack notifications
- GitHub commit status checks still work

---

## Adding Secrets to GitHub

**Step-by-step process**:

1. **Navigate to repository settings**:
   - Go to: https://github.com/four13co/sage50-journal-entry-sync
   - Click "Settings" tab
   - Click "Secrets and variables" in the left sidebar
   - Click "Actions"

2. **Add a new secret**:
   - Click "New repository secret" button
   - Enter the secret name (exact spelling matters!):
     - `CAPROVER_API_TOKEN`
     - `SHOPIFY_CLI_TOKEN`
     - `SHOPIFY_API_SECRET`
     - `SLACK_WEBHOOK_URL` (optional)
   - Paste the secret value
   - Click "Add secret"

3. **Verify secrets are added**:
   - You should see all secrets listed (values are hidden)
   - Secret names must match exactly as shown above

**Important Notes**:
- Secret values are hidden after saving
- You cannot view secret values again (only update or delete)
- If you need to check a secret, you must regenerate it

---

## Security Best Practices

### Token Rotation

**Recommended schedule**:
- Rotate all tokens quarterly (every 3 months)
- Rotate immediately if you suspect compromise
- Keep a secure record of when tokens were last rotated

**How to rotate**:
1. Generate new token/secret using the same steps above
2. Update the GitHub secret with the new value
3. Test a deployment to verify the new token works
4. Revoke/delete the old token if possible

### Access Control

**Who should have access**:
- Only repository administrators should access GitHub secrets
- Limit the number of people with admin access
- Use principle of least privilege

**Audit trail**:
- GitHub logs all secret access and modifications
- Check: Settings → Secrets and variables → Actions → Audit log

### Monitoring

**Watch for**:
- Failed authentication in deployment logs
- Suspicious deployment activity
- Unexpected secret modifications

**Alert on**:
- Multiple failed deployments (could indicate token issues)
- Deployments from unexpected branches
- Secret modifications in audit log

---

## Troubleshooting

### "CAPROVER_API_TOKEN not configured" error

**Symptoms**:
- Deployment fails at "Authenticate with CapRover" step
- Error message: "Neither CAPROVER_API_TOKEN nor CAPROVER_PASSWORD secret is configured"

**Solutions**:
1. Verify secret name is exactly `CAPROVER_API_TOKEN` (case-sensitive)
2. Generate new token from CapRover Dashboard
3. Add/update the secret in GitHub
4. Retry the deployment

---

### "SHOPIFY_CLI_TOKEN invalid" error

**Symptoms**:
- Shopify deployment fails
- Error message about authentication failure

**Solutions**:
1. Regenerate token: `shopify auth login`
2. Update GitHub secret with new token
3. Retry the deployment

**Common causes**:
- Token expired (Shopify tokens expire after some time)
- Token was revoked in Shopify Partners
- Token was copied incorrectly (trailing spaces, etc.)

---

### "SHOPIFY_API_SECRET invalid" error

**Symptoms**:
- Shopify deployment fails during authentication

**Solutions**:
1. Verify secret value from Shopify Partners Dashboard
2. Ensure you copied the "Client secret", not "Client ID"
3. Check for no extra spaces or characters
4. Update GitHub secret if incorrect

---

### Testing Secrets Configuration

**After adding all secrets, test the CI/CD pipeline**:

1. Make a small, safe change to the repository
2. Commit and push to Production branch:
   ```bash
   git commit --allow-empty -m "Test CI/CD pipeline"
   git push origin Production
   ```
3. Watch the GitHub Actions workflow run
4. Verify all jobs complete successfully
5. Check that the app deployed correctly

**If any job fails**:
- Click on the failed job in GitHub Actions
- Review the error logs
- Check which secret is causing the issue
- Follow the troubleshooting steps above

---

## Quick Reference

### Secret Names (copy-paste ready)

```
CAPROVER_API_TOKEN
SHOPIFY_CLI_TOKEN
SHOPIFY_API_SECRET
SLACK_WEBHOOK_URL
```

### Commands for Token Generation

```bash
# Shopify CLI token
shopify auth login

# CapRover token
# (Generate via Dashboard: https://captain.server.four13.dev)

# Shopify API secret
# (Get from Partners Dashboard: https://partners.shopify.com)
```

### GitHub Secrets URL

```
https://github.com/four13co/sage50-journal-entry-sync/settings/secrets/actions
```

---

## Next Steps

After configuring all secrets:

1. ✓ Test the CI/CD pipeline with a test commit
2. ✓ Verify all jobs complete successfully
3. ✓ Monitor first few automated deployments
4. ✓ Set calendar reminder for quarterly token rotation
5. ✓ Document any custom secrets or configuration

---

**Security Reminder**: Never commit secrets to the repository. Always use GitHub Secrets for sensitive data.

---

Last updated: 2026-02-28
