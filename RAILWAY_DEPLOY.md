# TicketAI Backend - Railway Deployment Guide

## 🚀 Quick Deploy

### Option 1: One-Click Deploy (Recommended)
Click this button to deploy directly to Railway:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/Hmauto/ticketai-backend)

### Option 2: Manual Deploy via Railway Dashboard

1. Go to https://railway.app/dashboard
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose **`Hmauto/ticketai-backend`**
5. Railway will auto-detect the Node.js app
6. Add the environment variables (see below)
7. Click **"Deploy"**

### Option 3: Railway CLI (if token works)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login (opens browser)
railway login

# Link to project
cd ticketai-backend
railway link

# Deploy
railway up
```

---

## 🔧 Required Environment Variables

Add these in Railway Dashboard → Variables:

```bash
# Database (Supabase)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.zywvnaactgvetvfidmzl.supabase.co:5432/postgres
SUPABASE_URL=https://zywvnaactgvetvfidmzl.supabase.co
SUPABASE_KEY=your_supabase_service_key

# AI/ML
OPENAI_API_KEY=sk-your_openai_key
KIMI_API_KEY=sk-kimi-6opAXLb9EbS7Ehf4MTQ2cNhYp2JqkSdOHLj31KzeofvoRTDKc9pPXohMdcMs7FAn

# Auth
JWT_SECRET=your_super_secret_jwt_key

# Redis (optional - can use Railway Redis)
REDIS_URL=${{Redis.REDIS_URL}}

# Server
PORT=3000
NODE_ENV=production
```

---

## 📝 Post-Deployment Steps

1. **Run Database Migrations**
   ```bash
   railway run npm run migrate
   ```

2. **Verify Deployment**
   - Health check: `https://your-app.railway.app/health`
   - Should return: `{"status":"healthy"}`

3. **Update Frontend API URL**
   - In Vercel dashboard
   - Set `NEXT_PUBLIC_API_URL` to your Railway URL

---

## 🔗 Useful Links

- **Railway Dashboard**: https://railway.app/dashboard
- **Backend Repo**: https://github.com/Hmauto/ticketai-backend
- **Frontend Repo**: https://github.com/Hmauto/ticketai
- **Frontend Live**: https://frontend-nu-sooty-37.vercel.app

---

## 📊 Expected Output

After deployment, your backend will be available at:
```
https://ticketai-backend-production.up.railway.app
```

API Endpoints:
- `GET /health` - Health check
- `POST /api/tickets` - Create ticket
- `GET /api/tickets` - List tickets
- `POST /api/tickets/:id/classify` - AI classification
- `GET /api/analytics/dashboard` - Dashboard metrics

---

*Ready to deploy! 🚀*
