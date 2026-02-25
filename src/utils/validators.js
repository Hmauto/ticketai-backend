/**
 * Validation utilities using Zod
 */
const { z } = require('zod');

// UUID schema
const uuidSchema = z.string().uuid();

// Email schema
const emailSchema = z.string().email();

// Pagination schema
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

// Date range schema
const dateRangeSchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional()
}).refine(data => {
  if (data.dateFrom && data.dateTo) {
    return data.dateFrom <= data.dateTo;
  }
  return true;
}, {
  message: 'dateFrom must be before or equal to dateTo'
});

// Ticket filters schema
const ticketFiltersSchema = z.object({
  status: z.enum(['open', 'pending', 'resolved', 'closed', 'spam']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  category: z.string().optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'very_negative']).optional(),
  assignedTo: uuidSchema.optional(),
  assignedTeam: uuidSchema.optional(),
  search: z.string().optional(),
  tags: z.array(z.string()).optional()
}).merge(paginationSchema);

// Analytics period schema
const analyticsPeriodSchema = z.object({
  period: z.enum(['24h', '7d', '30d', '90d']).default('7d'),
  groupBy: z.enum(['hour', 'day', 'week', 'month']).default('day')
});

// Webhook payload schema
const webhookPayloadSchema = z.object({
  type: z.string(),
  data: z.record(z.any())
});

/**
 * Validate data against schema
 * @param {Object} data - Data to validate
 * @param {z.ZodSchema} schema - Zod schema
 * @returns {Object} { success: boolean, data?: any, errors?: string[] }
 */
function validate(data, schema) {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return { success: false, errors };
    }
    return { success: false, errors: [error.message] };
  }
}

/**
 * Safely parse JSON
 * @param {string} str - JSON string
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed value or default
 */
function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * Sanitize string for SQL (basic)
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeSql(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/;/g, '');
}

module.exports = {
  uuidSchema,
  emailSchema,
  paginationSchema,
  dateRangeSchema,
  ticketFiltersSchema,
  analyticsPeriodSchema,
  webhookPayloadSchema,
  validate,
  safeJsonParse,
  sanitizeSql
};
