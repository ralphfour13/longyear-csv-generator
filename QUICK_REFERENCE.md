# Quick Reference - Deployment Cheat Sheet

## 🚀 One-Command Deploy

```bash
git add -A && git commit -m "Your message" && git push origin Production && caprover deploy --default
```

---

## 📋 Essential Commands

| Task | Command |
|------|---------|
| **Deploy to CapRover** | `caprover deploy --default` |
| **Deploy to Shopify** | `shopify app deploy --force` |
| **Check git status** | `git status` |
| **Commit all changes** | `git add -A && git commit -m "Message"` |
| **Push to GitHub** | `git push origin Production` |
| **View logs** | CapRover Dashboard → Logs |
| **Validate CSV** | `./scripts/validate-csv.sh <file>` |
| **Build locally** | `npm run build` |
| **Type check** | `npm run typecheck` |

---

## 🔗 Important URLs

| Service | URL |
|---------|-----|
| **Live App** | https://sage50-sync.four13.dev |
| **CapRover** | https://captain.server.four13.dev |
| **GitHub** | https://github.com/four13co/sage50-journal-entry-sync |
| **Shopify Partners** | https://partners.shopify.com/129641350/apps/326053265409 |
| **Neon DB** | https://console.neon.tech |

---

## 🔧 CapRover Environment Variables

```
NODE_ENV=production
SHOPIFY_APP_URL=https://sage50-sync.four13.dev
SHOPIFY_API_KEY=ec004ce28be778f86415a4b18a7ab9a2
SHOPIFY_API_SECRET=your_secret
DATABASE_URL=postgresql://...
SCOPES=read_shopify_payments_payouts,read_shopify_payments_accounts,read_orders
```

---

## 🎯 Standard Workflow

1. **Edit code**
2. `git add -A`
3. `git commit -m "Message"`
4. `git push origin Production`
5. `caprover deploy --default`
6. **Wait ~2 min**
7. **Refresh Shopify app** (`Cmd+Shift+R`)
8. **Test feature**

---

## 📊 Key Files

| File | Purpose |
|------|---------|
| `app/services/reconciler.server.ts` | Journal entry generation logic |
| `app/services/batch-processor.server.ts` | Export orchestration |
| `app/routes/app.exports.tsx` | Export Center UI |
| `shopify.app.sage-50-sync-for-fly-shop.toml` | Shopify app config |
| `Dockerfile` | Docker container config |
| `package.json` | Dependencies and scripts |

---

## 🐛 Quick Fixes

**App won't load**:
```bash
# Check SHOPIFY_APP_URL in CapRover
# Should be: https://sage50-sync.four13.dev
```

**Export fails**:
```bash
# Check DATABASE_URL in CapRover
# Check CapRover logs during export
```

**Download doesn't work**:
```bash
# Use window.open() in JavaScript
# Don't use <s-link> or <a href> (Shopify intercepts)
```

---

## ✅ Deployment Checklist

Before deploying:
- [ ] Code changes tested locally (`npm run build`)
- [ ] Commit message is descriptive
- [ ] Pushed to GitHub (`git push origin Production`)

After deploying:
- [ ] CapRover logs show "Deployed successfully"
- [ ] App starts without errors
- [ ] Hard refresh Shopify app
- [ ] Test the feature
- [ ] Validate CSV if applicable

---

**Keep this file open in a tab for instant reference!** 📌
