const express = require('express');
const router = express.Router();
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { requireRole } = require('../middleware/auth');

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['admin', 'manager', 'agent', 'viewer']).default('agent'),
  skills: z.array(z.string()).optional(),
  maxTickets: z.number().int().min(1).max(100).default(10)
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(['admin', 'manager', 'agent', 'viewer']).optional(),
  skills: z.array(z.string()).optional(),
  maxTickets: z.number().int().min(1).max(100).optional(),
  isActive: z.boolean().optional()
});

/**
 * GET /api/users
 * List users (admin/manager only)
 */
router.get('/', requireRole(['admin', 'manager']), async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    
    const { role, isActive, page = 1, limit = 20 } = req.query;

    let query = supabase
      .from('users')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (role) query = query.eq('role', role);
    if (isActive !== undefined) query = query.eq('is_active', isActive === 'true');

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: users, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    // Remove password hashes from response
    const safeUsers = users?.map(user => {
      const { password_hash, ...safeUser } = user;
      return safeUser;
    });

    res.json({
      users: safeUsers,
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
 * GET /api/users/:id
 * Get user details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        *,
        team_members(
          team_id,
          is_team_lead,
          team:teams(id, name)
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password hash
    const { password_hash, ...safeUser } = user;

    res.json({ user: safeUser });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/users
 * Create new user (admin only)
 */
router.post('/', requireRole(['admin']), async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    
    const data = createUserSchema.parse(req.body);

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', data.email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Create user
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        tenant_id: tenantId,
        email: data.email.toLowerCase(),
        password_hash: passwordHash,
        first_name: data.firstName,
        last_name: data.lastName,
        role: data.role,
        skills: data.skills || [],
        max_tickets: data.maxTickets
      })
      .select()
      .single();

    if (error) throw error;

    // Remove password hash from response
    const { password_hash, ...safeUser } = user;

    res.status(201).json({ user: safeUser });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/users/:id
 * Update user
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;
    const { id } = req.params;

    // Check permissions
    if (currentUserId !== id && currentUserRole !== 'admin' && currentUserRole !== 'manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const data = updateUserSchema.parse(req.body);

    // Build update object
    const updateData = {};
    if (data.firstName) updateData.first_name = data.firstName;
    if (data.lastName) updateData.last_name = data.lastName;
    if (data.skills) updateData.skills = data.skills;
    if (data.maxTickets) updateData.max_tickets = data.maxTickets;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;
    
    // Only admins can change roles
    if (data.role && currentUserRole === 'admin') {
      updateData.role = data.role;
    }

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove password hash
    const { password_hash, ...safeUser } = user;

    res.json({ user: safeUser });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/users/:id
 * Deactivate user (admin only)
 */
router.delete('/:id', requireRole(['admin']), async (req, res, next) => {
  try {
    const supabase = req.app.locals.supabase;
    const tenantId = req.user.tenantId;
    const { id } = req.params;

    // Prevent self-deactivation
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot deactivate yourself' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
