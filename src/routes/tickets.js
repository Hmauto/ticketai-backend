const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');

// Import AI modules
const classifier = require('../ai/classifier');
const routerAI = require('../ai/router');
const suggester = require('../ai/suggester');

// Validation schemas
const createTicketSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50000),
  customerEmail: z.string().email(),
  customerName: z.string().optional(),
  source: z.enum(['email', 'api', 'webhook', 'manual']).default('manual'),
  sourceId: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

const updateTicketSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed', 'spam']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  assignedTeam: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional()
});

const addMessageSchema = z.object({
  body: z.string().min(1),
  isInternal: z.boolean().default(false),
  senderType: z.enum(['customer', 'agent', 'system', 'ai']).default('agent')
});

/**
 * GET /api/tickets
 * List tickets with filters
 */
router.get('/', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    
    // Query params
    const {
      status,
      priority,
      category,
      sentiment,
      assignedTo,
      assignedTeam,
      search,
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = supabase
      .from('tickets')
      .select(`
        *,
        assigned_to:users(id, first_name, last_name, email),
        assigned_team:teams(id, name)
      `, { count: 'exact' })
      .eq('tenant_id', tenantId);

    // Apply filters
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (category) query = query.eq('category', category);
    if (sentiment) query = query.eq('sentiment', sentiment);
    if (assignedTo) query = query.eq('assigned_to', assignedTo);
    if (assignedTeam) query = query.eq('assigned_team', assignedTeam);
    
    // Search
    if (search) {
      query = query.or(`subject.ilike.%${search}%,body.ilike.%${search}%,customer_email.ilike.%${search}%`);
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    query = query
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(from, to);

    const { data: tickets, error, count } = await query;

    if (error) throw error;

    res.json({
      tickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tickets
 * Create new ticket
 */
router.post('/', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    
    const data = createTicketSchema.parse(req.body);
    
    // Create ticket
    const { data: ticket, error } = await supabase
      .from('tickets')
      .insert({
        tenant_id: tenantId,
        subject: data.subject,
        body: data.body,
        customer_email: data.customerEmail,
        customer_name: data.customerName,
        source: data.source,
        source_id: data.sourceId,
        metadata: data.metadata || {},
        status: 'open'
      })
      .select()
      .single();

    if (error) throw error;

    // Create initial message
    await supabase
      .from('ticket_messages')
      .insert({
        ticket_id: ticket.id,
        sender_type: 'customer',
        sender_email: data.customerEmail,
        sender_name: data.customerName,
        body: data.body
      });

    // Queue AI classification (async)
    const queue = req.app.locals.redis;
    await queue.lpush('ai:classification:queue', JSON.stringify({
      ticketId: ticket.id,
      tenantId,
      subject: data.subject,
      body: data.body
    }));

    res.status(201).json({
      ticket,
      message: 'Ticket created successfully. AI classification in progress.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/tickets/:id
 * Get ticket details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    // Get ticket with relations
    const { data: ticket, error } = await supabase
      .from('tickets')
      .select(`
        *,
        assigned_to:users(id, first_name, last_name, email, avatar_url),
        assigned_team:teams(id, name),
        classifications(*)
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get messages
    const { data: messages } = await supabase
      .from('ticket_messages')
      .select(`
        *,
        sender:users(id, first_name, last_name, avatar_url)
      `)
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    // Get history
    const { data: history } = await supabase
      .from('ticket_history')
      .select(`
        *,
        performed_by:users(id, first_name, last_name)
      `)
      .eq('ticket_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({
      ticket,
      messages: messages || [],
      history: history || []
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/tickets/:id
 * Update ticket
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { id } = req.params;

    const data = updateTicketSchema.parse(req.body);

    // Check ticket exists and belongs to tenant
    const { data: existingTicket } = await supabase
      .from('tickets')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (!existingTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Build update object
    const updateData = {};
    if (data.status) updateData.status = data.status;
    if (data.priority) updateData.priority = data.priority;
    if (data.assignedTo !== undefined) updateData.assigned_to = data.assignedTo;
    if (data.assignedTeam !== undefined) updateData.assigned_team = data.assignedTeam;
    if (data.tags) updateData.tags = data.tags;

    // Add resolved_at timestamp if status changed to resolved
    if (data.status === 'resolved' && existingTicket.status !== 'resolved') {
      updateData.resolved_at = new Date().toISOString();
    }

    const { data: ticket, error } = await supabase
      .from('tickets')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Log to history
    await supabase
      .from('ticket_history')
      .insert({
        ticket_id: id,
        action: 'updated',
        performed_by: userId,
        new_value: JSON.stringify(updateData)
      });

    res.json({ ticket });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tickets/:id/messages
 * Add message to ticket
 */
router.post('/:id/messages', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { id } = req.params;

    const data = addMessageSchema.parse(req.body);

    // Check ticket exists
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, customer_email, first_response_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Create message
    const { data: message, error } = await supabase
      .from('ticket_messages')
      .insert({
        ticket_id: id,
        sender_type: data.senderType,
        sender_id: data.senderType === 'agent' ? userId : null,
        body: data.body,
        is_internal: data.isInternal
      })
      .select()
      .single();

    if (error) throw error;

    // Update first_response_at if this is the first agent response
    if (data.senderType === 'agent' && !ticket.first_response_at) {
      await supabase
        .from('tickets')
        .update({ first_response_at: new Date().toISOString() })
        .eq('id', id);
    }

    res.status(201).json({ message });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tickets/:id/classify
 * Run AI classification on ticket
 */
router.post('/:id/classify', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    // Get ticket
    const { data: ticket } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Run classification
    const classification = await classifier.classify({
      subject: ticket.subject,
      body: ticket.body
    });

    // Save classification
    await supabase
      .from('classifications')
      .insert({
        ticket_id: id,
        predicted_category: classification.category,
        category_confidence: classification.confidence.category,
        predicted_priority: classification.priority,
        priority_confidence: classification.confidence.priority,
        predicted_sentiment: classification.sentiment.label,
        sentiment_confidence: classification.confidence.sentiment,
        sentiment_score: classification.sentiment.score,
        model_version: classification.modelVersion,
        processing_time_ms: classification.processingTimeMs
      });

    // Update ticket with classification
    await supabase
      .from('tickets')
      .update({
        category: classification.category,
        priority: classification.priority,
        sentiment: classification.sentiment.label,
        sentiment_score: classification.sentiment.score,
        ai_confidence: classification.overallConfidence,
        ai_processed: true
      })
      .eq('id', id);

    res.json({
      classification,
      message: 'Ticket classified successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tickets/:id/assign
 * Smart assign ticket using AI routing
 */
router.post('/:id/assign', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { id } = req.params;

    // Get ticket with current classification
    const { data: ticket } = await supabase
      .from('tickets')
      .select(`
        *,
        classifications(*)
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get available agents and teams
    const { data: agents } = await supabase
      .from('users')
      .select('*, team_members(team_id, teams(id, name, skills))')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .eq('role', 'agent');

    const { data: teams } = await supabase
      .from('teams')
      .select('*, team_members(user_id)')
      .eq('tenant_id', tenantId);

    // Get routing rules
    const { data: rules } = await supabase
      .from('routing_rules')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    // Run routing
    const routing = await routerAI.route({
      ticket,
      agents: agents || [],
      teams: teams || [],
      rules: rules || []
    });

    // Apply assignment
    const updateData = {};
    if (routing.assignToUser) updateData.assigned_to = routing.assignToUser;
    if (routing.assignToTeam) updateData.assigned_team = routing.assignToTeam;
    if (routing.setPriority) updateData.priority = routing.setPriority;

    await supabase
      .from('tickets')
      .update(updateData)
      .eq('id', id);

    // Add tags if specified
    if (routing.addTags && routing.addTags.length > 0) {
      const currentTags = ticket.tags || [];
      const newTags = [...new Set([...currentTags, ...routing.addTags])];
      await supabase
        .from('tickets')
        .update({ tags: newTags })
        .eq('id', id);
    }

    // Log assignment
    await supabase
      .from('ticket_history')
      .insert({
        ticket_id: id,
        action: 'auto_assigned',
        performed_by: userId,
        new_value: JSON.stringify(routing)
      });

    res.json({
      routing,
      message: 'Ticket assigned successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/tickets/:id/suggestions
 * Get AI response suggestions
 */
router.get('/:id/suggestions', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    // Get ticket with messages
    const { data: ticket } = await supabase
      .from('tickets')
      .select(`
        *,
        ticket_messages(*)
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get templates
    const { data: templates } = await supabase
      .from('templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    // Get KB articles
    const { data: kbArticles } = await supabase
      .from('kb_articles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_published', true);

    // Generate suggestions
    const suggestions = await suggester.generate({
      ticket,
      templates: templates || [],
      kbArticles: kbArticles || []
    });

    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
