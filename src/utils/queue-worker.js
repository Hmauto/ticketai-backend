/**
 * Queue worker for processing AI classification jobs
 */
const classifier = require('./ai/classifier');

class QueueWorker {
  constructor(redis, supabase, logger) {
    this.redis = redis;
    this.supabase = supabase;
    this.logger = logger;
    this.running = false;
    this.processingCount = 0;
  }

  /**
   * Start the queue worker
   */
  start() {
    if (this.running) return;
    
    this.running = true;
    this.logger.info('Queue worker started');
    
    this.processLoop();
  }

  /**
   * Stop the queue worker
   */
  stop() {
    this.running = false;
    this.logger.info('Queue worker stopping...');
  }

  /**
   * Main processing loop
   */
  async processLoop() {
    while (this.running) {
      try {
        // Wait for job from queue (blocking pop)
        const result = await this.redis.brpop('ai:classification:queue', 5);
        
        if (result) {
          const [, jobData] = result;
          await this.processJob(JSON.parse(jobData));
        }
      } catch (error) {
        this.logger.error('Queue processing error:', error);
        await this.sleep(1000);
      }
    }
  }

  /**
   * Process a single job
   */
  async processJob(job) {
    this.processingCount++;
    const startTime = Date.now();
    
    try {
      this.logger.info('Processing classification job', { 
        ticketId: job.ticketId 
      });

      // Run classification
      const classification = await classifier.classify({
        subject: job.subject,
        body: job.body
      });

      // Save classification to database
      await this.supabase
        .from('classifications')
        .insert({
          ticket_id: job.ticketId,
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
      await this.supabase
        .from('tickets')
        .update({
          category: classification.category,
          priority: classification.priority,
          sentiment: classification.sentiment.label,
          sentiment_score: classification.sentiment.score,
          ai_confidence: classification.overallConfidence,
          ai_processed: true
        })
        .eq('id', job.ticketId);

      // Queue routing job if auto-routing is enabled
      if (process.env.ENABLE_AUTO_ROUTING === 'true') {
        await this.redis.lpush('ai:routing:queue', JSON.stringify({
          ticketId: job.ticketId,
          tenantId: job.tenantId
        }));
      }

      const duration = Date.now() - startTime;
      this.logger.info('Classification completed', {
        ticketId: job.ticketId,
        category: classification.category,
        priority: classification.priority,
        sentiment: classification.sentiment.label,
        confidence: classification.overallConfidence,
        duration
      });

    } catch (error) {
      this.logger.error('Classification job failed', {
        ticketId: job.ticketId,
        error: error.message
      });
      
      // Re-queue if it's a temporary error
      if (this.isRetryableError(error)) {
        await this.redis.lpush('ai:classification:queue:retry', JSON.stringify(job));
      }
    } finally {
      this.processingCount--;
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'RATE_LIMITED'
    ];
    
    return retryableCodes.some(code => 
      error.message?.includes(code) || error.code === code
    );
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get worker stats
   */
  getStats() {
    return {
      running: this.running,
      processingCount: this.processingCount
    };
  }
}

module.exports = QueueWorker;
