# 🚀 TicketAI Backend - Deployment Options

## ✅ Quick Deploy Links

### Option 1: Railway (Recommended)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/Hmauto/ticketai-backend)

**Direct URL:** https://railway.app/new/template?template=https://github.com/Hmauto/ticketai-backend

### Option 2: Render
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Hmauto/ticketai-backend)

**Direct URL:** https://render.com/deploy?repo=https://github.com/Hmauto/ticketai-backend

### Option 3: Heroku
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/Hmauto/ticketai-backend)

---

## 🔧 Step-by-Step: Railway Dashboard

1. **Go to Railway Dashboard**
   - URL: https://railway.app/dashboard

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"

3. **Select Repository**
   - Choose `Hmauto/ticketai-backend`
   - Railway will auto-detect Node.js

4. **Add Environment Variables**
   Go to Variables tab and add:

   ```bash
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.zywvnaactgvetvfidmzl.supabase.co:5432/postgres
   SUPABASE_URL=https://zywvnaactgvetvfidmzl.supabase.co
   SUPABASE_KEY=your_supabase_service_key
   OPENAI_API_KEY=sk-your_openai_key
   KIMI_API_KEY=sk-kimi-6opAXLb9EbS7Ehf4MTQ2cNhYp2JqkSdOHLj31KzeofvoRTDKc9pPXohMdcMs7FAn
   JWT_SECRET=your_random_secret_key
   PORT=3000
   NODE_ENV=production
   ```

5. **Deploy**
   - Click "Deploy"
   - Wait for build to complete (2-3 minutes)

6. **Get URL**
   - Railway will provide a URL like:
   - `https://ticketai-backend-production.up.railway.app`

---

## ✅ Post-Deployment

### 1. Test Health Endpoint
```bash
curl https://your-app.railway.app/health
```

Expected response:
```json
{"status":"healthy","timestamp":"2026-02-25T...","version":"1.0.0"}
```

### 2. Update Frontend
In Vercel dashboard, set environment variable:
```
NEXT_PUBLIC_API_URL=https://your-app.railway.app
```

### 3. Run Database Migrations
In Railway dashboard:
- Go to your service
- Click "Shell" tab
- Run: `npx prisma migrate deploy` or `node scripts/migrate.js`

---

## 📊 Current Status

| Component | Status | URL |
|-----------|--------|-----|
| Frontend | ✅ **LIVE** | https://frontend-nu-sooty-37.vercel.app |
| Frontend Repo | ✅ | https://github.com/Hmauto/ticketai |
| Backend Repo | ✅ Ready | https://github.com/Hmauto/ticketai-backend |
| Backend Live | ⏳ **DEPLOY NOW** | Click button above |

---

## 🔗 Useful Commands

### Health Check
```bash
curl https://your-app.railway.app/health
```

### API Test
```bash
curl -X POST https://your-app.railway.app/api/tickets \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Test ticket",
    "body": "This is a test",
    "customerEmail": "test@example.com"
  }'
```

### View Logs
In Railway dashboard → Deployments → View Logs

---

## 🆘 Troubleshooting

### Build Fails
- Check that all environment variables are set
- Verify DATABASE_URL is correct
- Check logs in Railway dashboard

### Database Connection Error
- Ensure Supabase project is active
- Check DATABASE_URL format
- Verify IP allowlist in Supabase

### API Returns 500
- Check that all env vars are set
- View logs: `railway logs` or dashboard
- Verify database migrations ran

---

**Ready to deploy! Click the Railway button above ☝️**
