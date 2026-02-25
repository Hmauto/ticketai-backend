const express = require('express');
const router = express.Router();

/**
 * GET /api/analytics/dashboard
 * Get dashboard metrics
 */
router.get('/dashboard', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    
    const { period = '7d' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '24h':
        startDate.setDate(now.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get current metrics
    const { data: currentMetrics } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    // Aggregate metrics
    const aggregated = currentMetrics?.reduce((acc, day) => {
      acc.ticketsCreated += day.tickets_created || 0;
      acc.ticketsResolved += day.tickets_resolved || 0;
      acc.totalResponseTime += (day.avg_first_response_time || 0) * (day.tickets_created || 0);
      acc.totalResolutionTime += (day.avg_resolution_time || 0) * (day.tickets_resolved || 0);
      acc.totalTicketsForAvg += day.tickets_created || 0;
      acc.totalResolvedForAvg += day.tickets_resolved || 0;
      return acc;
    }, {
      ticketsCreated: 0,
      ticketsResolved: 0,
      totalResponseTime: 0,
      totalResolutionTime: 0,
      totalTicketsForAvg: 0,
      totalResolvedForAvg: 0
    }) || {};

    const avgResponseTime = aggregated.totalTicketsForAvg > 0 
      ? Math.round(aggregated.totalResponseTime / aggregated.totalTicketsForAvg)
      : 0;
    
    const avgResolutionTime = aggregated.totalResolvedForAvg > 0
      ? Math.round(aggregated.totalResolutionTime / aggregated.totalResolvedForAvg)
      : 0;

    // Get current ticket counts by status
    const { data: statusCounts } = await supabase
      .from('tickets')
      .select('status', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .neq('status', 'closed');

    const statusBreakdown = statusCounts?.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {}) || {};

    // Get priority distribution
    const { data: priorityData } = await supabase
      .from('tickets')
      .select('priority')
      .eq('tenant_id', tenantId)
      .in('status', ['open', 'pending']);

    const priorityBreakdown = priorityData?.reduce((acc, t) => {
      acc[t.priority] = (acc[t.priority] || 0) + 1;
      return acc;
    }, {}) || {};

    // Get sentiment distribution
    const { data: sentimentData } = await supabase
      .from('tickets')
      .select('sentiment')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate.toISOString());

    const sentimentBreakdown = sentimentData?.reduce((acc, t) => {
      acc[t.sentiment] = (acc[t.sentiment] || 0) + 1;
      return acc;
    }, {}) || {};

    // Get category distribution
    const { data: categoryData } = await supabase
      .from('tickets')
      .select('category')
      .eq('tenant_id', tenantId)
      .gte('created_at', startDate.toISOString());

    const categoryBreakdown = categoryData?.reduce((acc, t) => {
      if (t.category) {
        acc[t.category] = (acc[t.category] || 0) + 1;
      }
      return acc;
    }, {}) || {};

    // Get top agents
    const { data: agentMetrics } = await supabase
      .from('agent_metrics')
      .select(`
        *,
        user:users(id, first_name, last_name, avatar_url)
      `)
      .eq('tenant_id', tenantId)
      .gte('date', startDate.toISOString().split('T')[0])
      .order('tickets_resolved', { ascending: false })
      .limit(5);

    res.json({
      summary: {
        ticketsCreated: aggregated.ticketsCreated,
        ticketsResolved: aggregated.ticketsResolved,
        avgResponseTime,
        avgResolutionTime,
        openTickets: statusBreakdown.open || 0,
        pendingTickets: statusBreakdown.pending || 0
      },
      breakdown: {
        status: statusBreakdown,
        priority: priorityBreakdown,
        sentiment: sentimentBreakdown,
        category: categoryBreakdown
      },
      topAgents: agentMetrics || [],
      period,
      dateRange: {
        from: startDate.toISOString(),
        to: now.toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/trends
 * Get trend data for charts
 */
router.get('/trends', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    
    const { period = '30d', groupBy = 'day' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(now.getDate() - 90);
        break;
      default:
        startDate.setDate(now.getDate() - 30);
    }

    // Get daily metrics
    const { data: dailyMetrics } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    // Format for chart
    const volumeTrend = dailyMetrics?.map(day => ({
      date: day.date,
      created: day.tickets_created,
      resolved: day.tickets_resolved,
      closed: day.tickets_closed
    })) || [];

    const performanceTrend = dailyMetrics?.map(day => ({
      date: day.date,
      avgResponseTime: day.avg_first_response_time,
      avgResolutionTime: day.avg_resolution_time,
      resolutionRate: day.resolution_rate
    })) || [];

    const sentimentTrend = dailyMetrics?.map(day => ({
      date: day.date,
      avgSentiment: day.avg_sentiment,
      positive: day.positive_tickets,
      negative: day.negative_tickets
    })) || [];

    // Get category trends
    const { data: categoryTrends } = await supabase
      .from('category_metrics')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    // Group by category
    const categoryData = categoryTrends?.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push({
        date: item.date,
        count: item.ticket_count,
        avgResolutionTime: item.avg_resolution_time
      });
      return acc;
    }, {}) || {};

    res.json({
      volume: volumeTrend,
      performance: performanceTrend,
      sentiment: sentimentTrend,
      categories: categoryData,
      period,
      groupBy
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/agents
 * Get agent performance metrics
 */
router.get('/agents', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    
    const { period = '30d' } = req.query;
    
    const now = new Date();
    let startDate = new Date();
    startDate.setDate(now.getDate() - parseInt(period));

    // Get agent metrics
    const { data: agentMetrics } = await supabase
      .from('agent_metrics')
      .select(`
        *,
        user:users(id, first_name, last_name, email, avatar_url)
      `)
      .eq('tenant_id', tenantId)
      .gte('date', startDate.toISOString().split('T')[0]);

    // Aggregate by agent
    const agentStats = agentMetrics?.reduce((acc, metric) => {
      const userId = metric.user_id;
      if (!acc[userId]) {
        acc[userId] = {
          user: metric.user,
          ticketsAssigned: 0,
          ticketsResolved: 0,
          totalResponseTime: 0,
          totalResolutionTime: 0,
          responseCount: 0,
          resolutionCount: 0
        };
      }
      
      acc[userId].ticketsAssigned += metric.tickets_assigned || 0;
      acc[userId].ticketsResolved += metric.tickets_resolved || 0;
      
      if (metric.avg_response_time) {
        acc[userId].totalResponseTime += metric.avg_response_time * metric.tickets_assigned;
        acc[userId].responseCount += metric.tickets_assigned;
      }
      
      if (metric.avg_resolution_time) {
        acc[userId].totalResolutionTime += metric.avg_resolution_time * metric.tickets_resolved;
        acc[userId].resolutionCount += metric.tickets_resolved;
      }
      
      return acc;
    }, {}) || {};

    // Calculate averages
    const agents = Object.values(agentStats).map(agent => ({
      ...agent,
      avgResponseTime: agent.responseCount > 0 
        ? Math.round(agent.totalResponseTime / agent.responseCount)
        : 0,
      avgResolutionTime: agent.resolutionCount > 0
        ? Math.round(agent.totalResolutionTime / agent.resolutionCount)
        : 0
    }));

    res.json({
      agents,
      period
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
