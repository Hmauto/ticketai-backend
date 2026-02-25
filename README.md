# TicketAI Backend

AI-powered customer support ticket intelligence platform - Backend API

## Features

- **AI Classification**: Automatic sentiment, category, and priority detection
- **Smart Routing**: Intelligent ticket assignment to agents and teams
- **Response Suggestions**: AI-generated response templates and KB article matching
- **Email Ingestion**: Webhook support for SendGrid, AWS SES, Mailgun, Postmark
- **Analytics Dashboard**: Real-time metrics and trend analysis
- **Multi-tenant**: Support for multiple organizations

## Tech Stack

- Node.js + Express
- PostgreSQL (Supabase)
- Redis (Bull queues)
- OpenAI GPT-4
- JWT Authentication

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Database Setup

Run the schema in Supabase SQL Editor:
```sql
-- Copy contents of schema.sql
```

### 4. Start Server

```bash
# Development
npm run dev

# Production
npm start
```

## API Documentation

### Authentication

All endpoints (except auth) require Bearer token:
```
Authorization: Bearer <token>
```

### Endpoints

#### Auth
- `POST /api/auth/register` - Register new tenant
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

#### Tickets
- `GET /api/tickets` - List tickets (with filters)
- `POST /api/tickets` - Create ticket
- `GET /api/tickets/:id` - Get ticket details
- `PATCH /api/tickets/:id` - Update ticket
- `POST /api/tickets/:id/messages` - Add message
- `POST /api/tickets/:id/classify` - Run AI classification
- `POST /api/tickets/:id/assign` - Smart assign
- `GET /api/tickets/:id/suggestions` - Get response suggestions

#### Analytics
- `GET /api/analytics/dashboard` - Dashboard metrics
- `GET /api/analytics/trends` - Trend data
- `GET /api/analytics/agents` - Agent performance

#### Users
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `GET /api/users/:id` - Get user
- `PATCH /api/users/:id` - Update user

#### Webhooks
- `POST /api/webhooks/email` - Incoming email webhook
- `POST /api/webhooks/:tenantId` - Generic webhook

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_KEY=...

# AI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-secret-key

# Email
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=...
```

## Deployment

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway up
```

## License

MIT
