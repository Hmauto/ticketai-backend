/**
 * Database utilities for TicketAI
 */

/**
 * Build ticket query with filters
 * @param {Object} supabase - Supabase client
 * @param {Object} filters - Query filters
 * @returns {Object} Query builder
 */
function buildTicketQuery(supabase, filters) {
  const {
    tenantId,
    status,
    priority,
    category,
    sentiment,
    assignedTo,
    assignedTeam,
    search,
    dateFrom,
    dateTo,
    tags
  } = filters;

  let query = supabase
    .from('tickets')
    .select(`
      *,
      assigned_to:users(id, first_name, last_name, email, avatar_url),
      assigned_team:teams(id, name)
    `, { count: 'exact' })
    .eq('tenant_id', tenantId);

  if (status) query = query.eq('status', status);
  if (priority) query = query.eq('priority', priority);
  if (category) query = query.eq('category', category);
  if (sentiment) query = query.eq('sentiment', sentiment);
  if (assignedTo) query = query.eq('assigned_to', assignedTo);
  if (assignedTeam) query = query.eq('assigned_team', assignedTeam);
  
  if (dateFrom) {
    query = query.gte('created_at', dateFrom);
  }
  
  if (dateTo) {
    query = query.lte('created_at', dateTo);
  }

  if (tags && tags.length > 0) {
    query = query.contains('tags', tags);
  }

  if (search) {
    query = query.or(`subject.ilike.%${search}%,body.ilike.%${search}%,customer_email.ilike.%${search}%`);
  }

  return query;
}

/**
 * Calculate ticket metrics
 * @param {Array} tickets - Array of tickets
 * @returns {Object} Metrics
 */
function calculateTicketMetrics(tickets) {
  if (!tickets || tickets.length === 0) {
    return {
      total: 0,
      byStatus: {},
      byPriority: {},
      byCategory: {},
      avgResponseTime: 0,
      avgResolutionTime: 0
    };
  }

  const byStatus = {};
  const byPriority = {};
  const byCategory = {};
  
  let totalResponseTime = 0;
  let totalResolutionTime = 0;
  let respondedCount = 0;
  let resolvedCount = 0;

  tickets.forEach(ticket => {
    // Status counts
    byStatus[ticket.status] = (byStatus[ticket.status] || 0) + 1;
    
    // Priority counts
    if (ticket.priority) {
      byPriority[ticket.priority] = (byPriority[ticket.priority] || 0) + 1;
    }
    
    // Category counts
    if (ticket.category) {
      byCategory[ticket.category] = (byCategory[ticket.category] || 0) + 1;
    }

    // Response time
    if (ticket.first_response_at && ticket.created_at) {
      const responseTime = new Date(ticket.first_response_at) - new Date(ticket.created_at);
      totalResponseTime += responseTime;
      respondedCount++;
    }

    // Resolution time
    if (ticket.resolved_at && ticket.created_at) {
      const resolutionTime = new Date(ticket.resolved_at) - new Date(ticket.created_at);
      totalResolutionTime += resolutionTime;
      resolvedCount++;
    }
  });

  return {
    total: tickets.length,
    byStatus,
    byPriority,
    byCategory,
    avgResponseTime: respondedCount > 0 
      ? Math.round(totalResponseTime / respondedCount / 60000) // in minutes
      : 0,
    avgResolutionTime: resolvedCount > 0
      ? Math.round(totalResolutionTime / resolvedCount / 60000) // in minutes
      : 0
  };
}

/**
 * Format ticket for API response
 * @param {Object} ticket - Raw ticket data
 * @returns {Object} Formatted ticket
 */
function formatTicket(ticket) {
  if (!ticket) return null;

  return {
    id: ticket.id,
    tenantId: ticket.tenant_id,
    source: ticket.source,
    customerEmail: ticket.customer_email,
    customerName: ticket.customer_name,
    subject: ticket.subject,
    body: ticket.body,
    sentiment: ticket.sentiment,
    sentimentScore: ticket.sentiment_score,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    assignedTo: ticket.assigned_to,
    assignedTeam: ticket.assigned_team,
    tags: ticket.tags,
    aiProcessed: ticket.ai_processed,
    aiConfidence: ticket.ai_confidence,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at,
    firstResponseAt: ticket.first_response_at
  };
}

/**
 * Paginate query results
 * @param {Object} query - Supabase query
 * @param {Object} pagination - Pagination options
 * @returns {Object} Query with pagination
 */
function paginate(query, { page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'desc' }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  return query
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(from, to);
}

module.exports = {
  buildTicketQuery,
  calculateTicketMetrics,
  formatTicket,
  paginate
};
