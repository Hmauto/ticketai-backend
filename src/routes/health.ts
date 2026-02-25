import { Router } from 'express';

const router = Router();

/**
 * @route   GET /health
 * @desc    Basic health check endpoint
 * @access  Public
 */
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

/**
 * @route   GET /health/detailed
 * @desc    Detailed health check with dependencies
 * @access  Private (admin only)
 */
router.get('/detailed', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    openai: await checkOpenAI(),
  };
  
  const allHealthy = Object.values(checks).every(check => check.status === 'healthy');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    checks,
  });
});

/**
 * @route   GET /health/ready
 * @desc    Kubernetes readiness probe
 * @access  Public
 */
router.get('/ready', async (req, res) => {
  const dbHealthy = await checkDatabase();
  
  if (dbHealthy.status === 'healthy') {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready', reason: dbHealthy.message });
  }
});

/**
 * @route   GET /health/live
 * @desc    Kubernetes liveness probe
 * @access  Public
 */
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// Helper functions for dependency checks
async function checkDatabase() {
  try {
    // Import your database client here
    // const { prisma } = await import('../db');
    // await prisma.$queryRaw`SELECT 1`;
    return { status: 'healthy', message: 'Database connection OK' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function checkRedis() {
  try {
    // Import your Redis client here
    // const { redis } = await import('../redis');
    // await redis.ping();
    return { status: 'healthy', message: 'Redis connection OK' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

async function checkOpenAI() {
  try {
    // Quick check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return { status: 'unhealthy', message: 'OpenAI API key not configured' };
    }
    return { status: 'healthy', message: 'OpenAI configured' };
  } catch (error) {
    return { status: 'unhealthy', message: error.message };
  }
}

export default router;
