const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { simpleParser } = require('mailparser');

// Import ingestion handlers
const emailParser = require('../ingestion/email-parser');

/**
 * Verify webhook signature
 */
const verifyWebhookSignature = (payload, signature, secret) => {
  if (!signature || !secret) return false;
  
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = hmac.digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
};

/**
 * POST /api/webhooks/email
 * Receive incoming email webhook (SendGrid, AWS SES, etc.)
 */
router.post('/email', async (req, res, next) => {
  try {
    const logger = req.app.locals.logger;
    const supabase = req.app.locals.supabase;
    
    // Verify webhook signature if configured
    const signature = req.headers['x-webhook-signature'];
    const secret = process.env.EMAIL_WEBHOOK_SECRET;
    
    if (secret && !verifyWebhookSignature(JSON.stringify(req.body), signature, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse email based on provider format
    let emailData;
    
    // SendGrid format
    if (req.body.from && req.body.subject) {
      emailData = {
        from: req.body.from,
        to: req.body.to,
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html,
        headers: req.body.headers,
        attachments: req.body.attachments
      };
    }
    // AWS SES format
    else if (req.body.Records && req.body.Records[0]?.ses) {
      const ses = req.body.Records[0].ses;
      emailData = {
        from: ses.mail.source,
        to: ses.mail.destination,
        subject: ses.mail.commonHeaders.subject,
        messageId: ses.mail.messageId
      };
    }
    // Generic format
    else {
      emailData = req.body;
    }

    logger.info('Received email webhook', { 
      from: emailData.from,
      subject: emailData.subject 
    });

    // Find tenant by email domain
    const fromDomain = emailParser.extractDomain(emailData.to);
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('email_domain', fromDomain)
      .single();

    if (!tenant) {
      logger.warn('No tenant found for domain', { domain: fromDomain });
      return res.status(404).json({ error: 'Tenant not found for this domain' });
    }

    // Parse email content
    const parsed = await emailParser.parse({
      ...emailData,
      tenantId: tenant.id
    });

    // Check for existing ticket (threading)
    const { data: existingTicket } = await supabase
      .from('tickets')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('customer_email', parsed.customerEmail)
      .eq('status', 'open')
      .ilike('subject', `%${parsed.subject.replace(/^Re:\s*/i, '')}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingTicket) {
      // Add as reply to existing ticket
      await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: existingTicket.id,
          sender_type: 'customer',
          sender_email: parsed.customerEmail,
          sender_name: parsed.customerName,
          body: parsed.body,
          body_html: parsed.bodyHtml,
          message_id: parsed.messageId,
          in_reply_to: parsed.inReplyTo,
          attachments: parsed.attachments
        });

      logger.info('Added reply to existing ticket', { 
        ticketId: existingTicket.id 
      });

      return res.json({
        success: true,
        ticketId: existingTicket.id,
        action: 'reply_added'
      });
    }

    // Create new ticket
    const { data: ticket, error } = await supabase
      .from('tickets')
      .insert({
        tenant_id: tenant.id,
        source: 'email',
        source_id: parsed.messageId,
        customer_email: parsed.customerEmail,
        customer_name: parsed.customerName,
        subject: parsed.subject,
        body: parsed.body,
        body_text: parsed.bodyText,
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
        sender_email: parsed.customerEmail,
        sender_name: parsed.customerName,
        body: parsed.body,
        body_html: parsed.bodyHtml,
        message_id: parsed.messageId,
        attachments: parsed.attachments
      });

    // Queue AI classification
    const queue = req.app.locals.redis;
    await queue.lpush('ai:classification:queue', JSON.stringify({
      ticketId: ticket.id,
      tenantId: tenant.id,
      subject: parsed.subject,
      body: parsed.body
    }));

    logger.info('Created ticket from email', { 
      ticketId: ticket.id,
      tenantId: tenant.id 
    });

    res.status(201).json({
      success: true,
      ticketId: ticket.id,
      action: 'ticket_created'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/webhooks/:tenantId
 * Generic webhook endpoint for integrations
 */
router.post('/:tenantId', async (req, res, next) => {
  try {
    const logger = req.app.locals.logger;
    const supabase = req.app.locals.supabase;
    const { tenantId } = req.params;

    // Verify tenant exists
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, webhook_secret')
      .eq('id', tenantId)
      .single();

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Verify signature if secret is configured
    if (tenant.webhook_secret) {
      const signature = req.headers['x-webhook-signature'];
      const payload = JSON.stringify(req.body);
      
      if (!verifyWebhookSignature(payload, signature, tenant.webhook_secret)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Handle different webhook types
    const { type, data } = req.body;

    switch (type) {
      case 'ticket.create':
        // Handle external ticket creation
        const { data: ticket } = await supabase
          .from('tickets')
          .insert({
            tenant_id: tenantId,
            source: 'webhook',
            source_id: data.id,
            customer_email: data.customerEmail,
            customer_name: data.customerName,
            subject: data.subject,
            body: data.body,
            status: 'open',
            metadata: data.metadata || {}
          })
          .select()
          .single();

        // Queue AI classification
        const queue = req.app.locals.redis;
        await queue.lpush('ai:classification:queue', JSON.stringify({
          ticketId: ticket.id,
          tenantId,
          subject: data.subject,
          body: data.body
        }));

        return res.status(201).json({ ticketId: ticket.id });

      case 'ticket.update':
        // Handle external ticket update
        await supabase
          .from('tickets')
          .update({
            status: data.status,
            priority: data.priority,
            updated_at: new Date().toISOString()
          })
          .eq('source_id', data.id)
          .eq('tenant_id', tenantId);

        return res.json({ success: true });

      default:
        logger.warn('Unknown webhook type', { type, tenantId });
        return res.status(400).json({ error: 'Unknown webhook type' });
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
