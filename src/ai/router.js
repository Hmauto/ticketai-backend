/**
 * Smart Routing Logic for TicketAI
 * Routes tickets to the best agent or team based on AI analysis
 */

/**
 * Route a ticket to the best agent/team
 * @param {Object} params - Routing parameters
 * @param {Object} params.ticket - Ticket data
 * @param {Array} params.agents - Available agents
 * @param {Array} params.teams - Available teams
 * @param {Array} params.rules - Routing rules
 * @returns {Object} Routing decision
 */
async function route({ ticket, agents, teams, rules }) {
  const routing = {
    assignToUser: null,
    assignToTeam: null,
    setPriority: null,
    addTags: [],
    reason: '',
    confidence: 0
  };

  // Step 1: Apply routing rules first
  const ruleMatch = applyRoutingRules(ticket, rules);
  if (ruleMatch) {
    routing.assignToTeam = ruleMatch.assignToTeam;
    routing.assignToUser = ruleMatch.assignToUser;
    routing.setPriority = ruleMatch.setPriority;
    routing.addTags = ruleMatch.addTags || [];
    routing.reason = `Matched routing rule: ${ruleMatch.ruleName}`;
    routing.confidence = 0.9;
  }

  // Step 2: If no team assigned, route by category
  if (!routing.assignToTeam && ticket.category) {
    const teamByCategory = findTeamByCategory(ticket.category, teams);
    if (teamByCategory) {
      routing.assignToTeam = teamByCategory.id;
      routing.reason = routing.reason || `Routed to ${teamByCategory.name} team based on category`;
    }
  }

  // Step 3: If team assigned but no agent, find best agent
  if (routing.assignToTeam && !routing.assignToUser) {
    const bestAgent = findBestAgentInTeam(
      routing.assignToTeam,
      agents,
      ticket
    );
    if (bestAgent) {
      routing.assignToUser = bestAgent.id;
      routing.reason += ` -> Assigned to ${bestAgent.first_name}`;
    }
  }

  // Step 4: Handle escalations
  if (shouldEscalate(ticket)) {
    routing.setPriority = 'urgent';
    routing.addTags.push('escalated');
    
    // Try to find senior agent
    const seniorAgent = findSeniorAgent(agents, routing.assignToTeam);
    if (seniorAgent) {
      routing.assignToUser = seniorAgent.id;
      routing.reason += ' (Escalated to senior agent)';
    }
  }

  // Step 5: Load balancing if still no assignment
  if (!routing.assignToUser && !routing.assignToTeam) {
    const leastBusyAgent = findLeastBusyAgent(agents);
    if (leastBusyAgent) {
      routing.assignToUser = leastBusyAgent.id;
      routing.reason = 'Assigned via load balancing';
    }
  }

  // Calculate final confidence
  routing.confidence = calculateRoutingConfidence(routing, ticket);

  return routing;
}

/**
 * Apply routing rules to ticket
 * @param {Object} ticket - Ticket data
 * @param {Array} rules - Routing rules
 * @returns {Object|null} Matched rule actions
 */
function applyRoutingRules(ticket, rules) {
  if (!rules || rules.length === 0) return null;

  // Sort by priority (highest first)
  const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const rule of sortedRules) {
    if (matchesRule(ticket, rule.conditions)) {
      return {
        ruleName: rule.name,
        assignToTeam: rule.assign_to_team,
        assignToUser: rule.assign_to_user,
        setPriority: rule.set_priority,
        addTags: rule.add_tags
      };
    }
  }

  return null;
}

/**
 * Check if ticket matches rule conditions
 * @param {Object} ticket - Ticket data
 * @param {Object} conditions - Rule conditions
 * @returns {boolean}
 */
function matchesRule(ticket, conditions) {
  if (!conditions) return false;

  for (const [key, value] of Object.entries(conditions)) {
    const ticketValue = ticket[key];
    
    if (Array.isArray(value)) {
      // Array means "any of these values"
      if (!value.includes(ticketValue)) return false;
    } else if (typeof value === 'object') {
      // Object conditions (e.g., { $gt: 5 })
      if (value.$gt !== undefined && !(ticketValue > value.$gt)) return false;
      if (value.$lt !== undefined && !(ticketValue < value.$lt)) return false;
      if (value.$gte !== undefined && !(ticketValue >= value.$gte)) return false;
      if (value.$lte !== undefined && !(ticketValue <= value.$lte)) return false;
      if (value.$ne !== undefined && ticketValue === value.$ne) return false;
    } else {
      // Direct comparison
      if (ticketValue !== value) return false;
    }
  }

  return true;
}

/**
 * Find team by category
 * @param {string} category - Ticket category
 * @param {Array} teams - Available teams
 * @returns {Object|null} Matching team
 */
function findTeamByCategory(category, teams) {
  if (!teams || teams.length === 0) return null;

  // Map categories to typical team skills
  const categoryToSkills = {
    billing: ['billing', 'payments', 'finance'],
    technical: ['technical', 'engineering', 'support'],
    feature_request: ['product', 'feedback'],
    bug: ['technical', 'engineering', 'qa'],
    account: ['account', 'customer_success'],
    general: ['support', 'general']
  };

  const relevantSkills = categoryToSkills[category] || ['support'];

  // Find team with matching skills
  return teams.find(team => {
    if (!team.skills || team.skills.length === 0) return false;
    return relevantSkills.some(skill =
      team.skills.includes(skill)
    );
  }) || teams[0]; // Default to first team if no match
}

/**
 * Find best agent in a team
 * @param {string} teamId - Team ID
 * @param {Array} agents - All agents
 * @param {Object} ticket - Ticket data
 * @returns {Object|null} Best agent
 */
function findBestAgentInTeam(teamId, agents, ticket) {
  if (!agents || agents.length === 0) return null;

  // Filter agents in team
  const teamAgents = agents.filter(agent => {
    if (!agent.team_members) return false;
    return agent.team_members.some(tm => tm.team_id === teamId);
  });

  if (teamAgents.length === 0) return null;

  // Score each agent
  const scoredAgents = teamAgents.map(agent => {
    let score = 0;

    // Skill match
    if (agent.skills && ticket.category) {
      const categorySkills = {
        billing: ['billing', 'finance'],
        technical: ['technical', 'engineering'],
        feature_request: ['product'],
        bug: ['technical', 'qa'],
        account: ['account', 'customer_success']
      };
      
      const relevantSkills = categorySkills[ticket.category] || [];
      const skillMatch = relevantSkills.filter(skill =
        agent.skills.includes(skill)
      ).length;
      score += skillMatch * 10;
    }

    // Availability (lower current load = higher score)
    const currentLoad = agent.current_ticket_count || 0;
    const maxTickets = agent.max_tickets || 10;
    const availability = 1 - (currentLoad / maxTickets);
    score += availability * 20;

    // Team lead bonus
    const isTeamLead = agent.team_members?.some(tm =
      tm.team_id === teamId && tm.is_team_lead
    );
    if (isTeamLead) score += 5;

    return { agent, score };
  });

  // Sort by score (highest first)
  scoredAgents.sort((a, b) => b.score - a.score);

  return scoredAgents[0]?.agent;
}

/**
 * Check if ticket should be escalated
 * @param {Object} ticket - Ticket data
 * @returns {boolean}
 */
function shouldEscalate(ticket) {
  // High priority
  if (ticket.priority === 'urgent') return true;

  // Very negative sentiment
  if (ticket.sentiment === 'very_negative') return true;
  if (ticket.sentiment_score < -0.5) return true;

  // Escalation keywords
  const escalationKeywords = [
    'cancel', 'refund', 'lawsuit', 'lawyer', 'legal',
    'manager', 'supervisor', 'escalate', 'complaint',
    'terrible', 'awful', 'unacceptable', 'fraud'
  ];

  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  return escalationKeywords.some(keyword => text.includes(keyword));
}

/**
 * Find senior agent for escalation
 * @param {Array} agents - Available agents
 * @param {string} teamId - Preferred team ID
 * @returns {Object|null} Senior agent
 */
function findSeniorAgent(agents, teamId) {
  if (!agents || agents.length === 0) return null;

  // Prefer team leads
  const leads = agents.filter(agent => {
    if (!agent.team_members) return false;
    return agent.team_members.some(tm =
      tm.is_team_lead && (!teamId || tm.team_id === teamId)
    );
  });

  if (leads.length > 0) {
    return findLeastBusyAgent(leads);
  }

  // Fall back to managers
  const managers = agents.filter(a => a.role === 'manager');
  if (managers.length > 0) {
    return findLeastBusyAgent(managers);
  }

  return null;
}

/**
 * Find least busy agent for load balancing
 * @param {Array} agents - Available agents
 * @returns {Object|null} Least busy agent
 */
function findLeastBusyAgent(agents) {
  if (!agents || agents.length === 0) return null;

  // Sort by current load percentage
  const sorted = [...agents].sort((a, b) => {
    const loadA = (a.current_ticket_count || 0) / (a.max_tickets || 10);
    const loadB = (b.current_ticket_count || 0) / (b.max_tickets || 10);
    return loadA - loadB;
  });

  return sorted[0];
}

/**
 * Calculate routing confidence score
 * @param {Object} routing - Routing decision
 * @param {Object} ticket - Ticket data
 * @returns {number} Confidence score (0-1)
 */
function calculateRoutingConfidence(routing, ticket) {
  let confidence = 0.5;

  // Higher confidence if we have both team and agent
  if (routing.assignToTeam && routing.assignToUser) {
    confidence += 0.3;
  }

  // Higher confidence if AI processed the ticket
  if (ticket.ai_processed) {
    confidence += 0.1;
  }

  // Higher confidence if we have high AI confidence
  if (ticket.ai_confidence > 0.8) {
    confidence += 0.1;
  }

  return Math.min(1, confidence);
}

module.exports = {
  route,
  applyRoutingRules,
  findTeamByCategory,
  findBestAgentInTeam,
  shouldEscalate,
  findSeniorAgent,
  findLeastBusyAgent
};
