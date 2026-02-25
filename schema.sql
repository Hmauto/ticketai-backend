-- TicketAI Database Schema
-- PostgreSQL (Supabase)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CORE TABLES
-- ============================================

-- Tenants (multi-tenant support)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'free', -- free, starter, pro, enterprise
    settings JSONB DEFAULT '{}',
    api_key VARCHAR(255) UNIQUE,
    webhook_url TEXT,
    email_domain VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users (agents, admins, managers)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    role VARCHAR(50) DEFAULT 'agent', -- admin, manager, agent, viewer
    avatar_url TEXT,
    skills TEXT[], -- e.g., ['billing', 'technical', 'spanish']
    max_tickets INTEGER DEFAULT 10, -- for load balancing
    is_active BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Teams (for routing)
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    skills TEXT[], -- required skills for this team
    auto_assign BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Team members (many-to-many)
CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_team_lead BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- ============================================
-- TICKET TABLES
-- ============================================

-- Tickets
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Source info
    source VARCHAR(50) DEFAULT 'email', -- email, api, webhook, manual
    source_id VARCHAR(255), -- external ID from email provider, etc.
    
    -- Customer info
    customer_email VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255),
    customer_id UUID, -- if linked to a customers table later
    
    -- Content
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    body_text TEXT, -- plain text version
    
    -- AI Classification
    sentiment VARCHAR(20), -- positive, neutral, negative, very_negative
    sentiment_score DECIMAL(4,3), -- -1.0 to 1.0
    category VARCHAR(100), -- billing, technical, feature_request, bug, general
    priority VARCHAR(20) DEFAULT 'medium', -- low, medium, high, urgent
    language VARCHAR(10) DEFAULT 'en',
    
    -- Status & Assignment
    status VARCHAR(50) DEFAULT 'open', -- open, pending, resolved, closed, spam
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_team UUID REFERENCES teams(id) ON DELETE SET NULL,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    first_response_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    tags TEXT[],
    
    -- AI confidence scores
    ai_confidence DECIMAL(4,3), -- 0.0 to 1.0
    ai_processed BOOLEAN DEFAULT false
);

-- Ticket history (audit log)
CREATE TABLE ticket_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL, -- created, classified, assigned, status_changed, note_added, etc.
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    old_value TEXT,
    new_value TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ticket messages (replies)
CREATE TABLE ticket_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    
    -- Sender info
    sender_type VARCHAR(20) NOT NULL, -- customer, agent, system, ai
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    sender_email VARCHAR(255),
    sender_name VARCHAR(255),
    
    -- Content
    body TEXT NOT NULL,
    body_html TEXT,
    is_internal BOOLEAN DEFAULT false, -- internal notes
    
    -- Metadata
    message_id VARCHAR(255), -- email Message-ID header
    in_reply_to VARCHAR(255), -- for threading
    attachments JSONB DEFAULT '[]',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- AI/ML TABLES
-- ============================================

-- Classifications (AI predictions log)
CREATE TABLE classifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    
    -- Predictions
    predicted_category VARCHAR(100),
    category_confidence DECIMAL(4,3),
    
    predicted_priority VARCHAR(20),
    priority_confidence DECIMAL(4,3),
    
    predicted_sentiment VARCHAR(20),
    sentiment_confidence DECIMAL(4,3),
    sentiment_score DECIMAL(4,3),
    
    -- Model info
    model_version VARCHAR(50),
    processing_time_ms INTEGER,
    
    -- Feedback
    was_correct BOOLEAN, -- user feedback
    corrected_category VARCHAR(100),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sentiment scores (detailed sentiment tracking)
CREATE TABLE sentiment_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    message_id UUID REFERENCES ticket_messages(id) ON DELETE CASCADE,
    
    -- Scores
    score DECIMAL(4,3) NOT NULL, -- -1.0 to 1.0
    magnitude DECIMAL(4,3), -- 0.0 to 1.0 (strength of emotion)
    
    -- Breakdown
    joy DECIMAL(4,3),
    anger DECIMAL(4,3),
    sadness DECIMAL(4,3),
    fear DECIMAL(4,3),
    disgust DECIMAL(4,3),
    
    -- Model info
    model_version VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Response suggestions (AI generated responses)
CREATE TABLE response_suggestions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    
    -- Suggestion
    content TEXT NOT NULL,
    content_html TEXT,
    
    -- Source
    source VARCHAR(50), -- ai_generated, template_matched, kb_article
    template_id UUID,
    kb_article_id UUID,
    
    -- Metadata
    confidence DECIMAL(4,3),
    was_used BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Routing rules
CREATE TABLE routing_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- Conditions (JSON for flexibility)
    conditions JSONB NOT NULL, -- e.g., {"category": "billing", "sentiment": "negative"}
    
    -- Actions
    assign_to_team UUID REFERENCES teams(id) ON DELETE SET NULL,
    assign_to_user UUID REFERENCES users(id) ON DELETE SET NULL,
    set_priority VARCHAR(20),
    add_tags TEXT[],
    
    -- Settings
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0, -- rule evaluation order
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ANALYTICS TABLES
-- ============================================

-- Daily metrics (pre-aggregated for dashboard)
CREATE TABLE daily_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    -- Volume
    tickets_created INTEGER DEFAULT 0,
    tickets_resolved INTEGER DEFAULT 0,
    tickets_closed INTEGER DEFAULT 0,
    
    -- Performance
    avg_first_response_time INTEGER, -- in minutes
    avg_resolution_time INTEGER, -- in minutes
    
    -- Quality
    resolution_rate DECIMAL(5,4), -- 0.0 to 1.0
    customer_satisfaction DECIMAL(3,2), -- 1.0 to 5.0
    
    -- AI metrics
    ai_classified INTEGER DEFAULT 0,
    ai_accuracy DECIMAL(5,4),
    
    -- Sentiment
    avg_sentiment DECIMAL(4,3),
    positive_tickets INTEGER DEFAULT 0,
    negative_tickets INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(tenant_id, date)
);

-- Agent performance metrics
CREATE TABLE agent_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    tickets_assigned INTEGER DEFAULT 0,
    tickets_resolved INTEGER DEFAULT 0,
    avg_response_time INTEGER, -- in minutes
    avg_resolution_time INTEGER, -- in minutes
    customer_satisfaction DECIMAL(3,2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(tenant_id, user_id, date)
);

-- Category metrics
CREATE TABLE category_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    
    ticket_count INTEGER DEFAULT 0,
    avg_resolution_time INTEGER,
    resolution_rate DECIMAL(5,4),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(tenant_id, category, date)
);

-- ============================================
-- KNOWLEDGE BASE TABLES
-- ============================================

-- Templates (response templates)
CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    name VARCHAR(255) NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    
    -- Matching
    category VARCHAR(100),
    tags TEXT[],
    keywords TEXT[],
    
    -- Settings
    is_active BOOLEAN DEFAULT true,
    use_count INTEGER DEFAULT 0,
    
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Knowledge base articles
CREATE TABLE kb_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    
    -- Categorization
    category VARCHAR(100),
    tags TEXT[],
    
    -- Search
    search_vector TSVECTOR,
    
    -- Stats
    view_count INTEGER DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    
    -- Status
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMP WITH TIME ZONE,
    
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Tickets indexes
CREATE INDEX idx_tickets_tenant ON tickets(tenant_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_assigned_to ON tickets(assigned_to);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);
CREATE INDEX idx_tickets_category ON tickets(category);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_sentiment ON tickets(sentiment);
CREATE INDEX idx_tickets_customer_email ON tickets(customer_email);

-- Ticket history indexes
CREATE INDEX idx_ticket_history_ticket ON ticket_history(ticket_id);
CREATE INDEX idx_ticket_history_created ON ticket_history(created_at);

-- Messages indexes
CREATE INDEX idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX idx_ticket_messages_created ON ticket_messages(created_at);

-- Analytics indexes
CREATE INDEX idx_daily_metrics_tenant_date ON daily_metrics(tenant_id, date);
CREATE INDEX idx_agent_metrics_tenant_date ON agent_metrics(tenant_id, date);
CREATE INDEX idx_category_metrics_tenant_date ON category_metrics(tenant_id, date);

-- Search indexes
CREATE INDEX idx_kb_articles_search ON kb_articles USING GIN(search_vector);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to tables
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_routing_rules_updated_at BEFORE UPDATE ON routing_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_metrics_updated_at BEFORE UPDATE ON daily_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_metrics_updated_at BEFORE UPDATE ON agent_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_category_metrics_updated_at BEFORE UPDATE ON category_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kb_articles_updated_at BEFORE UPDATE ON kb_articles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- KB article search vector update
CREATE OR REPLACE FUNCTION update_kb_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'C');
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_kb_search_vector BEFORE INSERT OR UPDATE ON kb_articles
    FOR EACH ROW EXECUTE FUNCTION update_kb_search_vector();

-- Ticket history logging trigger
CREATE OR REPLACE FUNCTION log_ticket_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO ticket_history (ticket_id, action, performed_by, new_value, created_at)
        VALUES (NEW.id, 'created', NULL, jsonb_build_object(
            'subject', NEW.subject,
            'customer_email', NEW.customer_email,
            'status', NEW.status
        ), NOW());
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Log status change
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO ticket_history (ticket_id, action, performed_by, old_value, new_value, created_at)
            VALUES (NEW.id, 'status_changed', NULL, OLD.status, NEW.status, NOW());
        END IF;
        
        -- Log assignment change
        IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
            INSERT INTO ticket_history (ticket_id, action, performed_by, old_value, new_value, created_at)
            VALUES (NEW.id, 'assigned', NULL, OLD.assigned_to::text, NEW.assigned_to::text, NOW());
        END IF;
        
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ language 'plpgsql';

CREATE TRIGGER ticket_change_trigger AFTER INSERT OR UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION log_ticket_change();
