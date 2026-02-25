const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { generateToken } = require('../middleware/auth');

// Validation schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  tenantName: z.string().min(1)
});

/**
 * POST /api/auth/login
 * Authenticate user and return JWT
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const supabase = req.app.locals.supabase;

    // Fetch user with tenant info
    const { data: user, error } = await supabase
      .from('users')
      .select('*, tenants(*)')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    // Verify password (using bcrypt)
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last seen
    await supabase
      .from('users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', user.id);

    // Generate token
    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        tenant: {
          id: user.tenants.id,
          name: user.tenants.name,
          plan: user.tenants.plan
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/register
 * Register new tenant and admin user
 */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, tenantName } = registerSchema.parse(req.body);
    const supabase = req.app.locals.supabase;

    // Check if email already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Create tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: tenantName,
        slug: tenantName.toLowerCase().replace(/\s+/g, '-'),
        plan: 'free'
      })
      .select()
      .single();

    if (tenantError) {
      throw tenantError;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create admin user
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        tenant_id: tenant.id,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        role: 'admin'
      })
      .select()
      .single();

    if (userError) {
      // Rollback tenant creation
      await supabase.from('tenants').delete().eq('id', tenant.id);
      throw userError;
    }

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const supabase = req.app.locals.supabase;
    const { data: user, error } = await supabase
      .from('users')
      .select('*, tenants(*)')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        tenant: {
          id: user.tenants.id,
          name: user.tenants.name,
          plan: user.tenants.plan
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
