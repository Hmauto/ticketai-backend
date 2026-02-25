#!/bin/bash
# Deploy TicketAI Backend to Railway

echo "🚀 TicketAI Backend Deployment Script"
echo "======================================"
echo ""

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "📦 Installing Railway CLI..."
    npm install -g @railway/cli
fi

echo ""
echo "🔐 Please login to Railway (opens browser)..."
railway login

echo ""
echo "📁 Initializing project..."
cd "$(dirname "$0")"

# Check if already linked
if [ ! -f .railway/config.json ]; then
    echo "🔗 Linking to Railway project..."
    railway init --name ticketai-backend
fi

echo ""
echo "🔧 Setting up environment variables..."
echo "Please add these variables in Railway Dashboard:"
echo ""
echo "  DATABASE_URL=postgresql://..."
echo "  SUPABASE_URL=https://zywvnaactgvetvfidmzl.supabase.co"
echo "  SUPABASE_KEY=your_key"
echo "  OPENAI_API_KEY=sk-..."
echo "  KIMI_API_KEY=sk-kimi-..."
echo "  JWT_SECRET=your_secret"
echo "  REDIS_URL=redis://..."
echo ""
read -p "Press Enter when environment variables are set..."

echo ""
echo "🚀 Deploying to Railway..."
railway up

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Your backend will be available at:"
railway domain
echo ""
echo "🔍 Health check:"
echo "  curl https://$(railway domain)/health"
