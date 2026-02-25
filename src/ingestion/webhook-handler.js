/**
 * Webhook Handler for TicketAI
 * Handles incoming webhooks from various integrations
 */

const crypto = require('crypto');

/**
 * Verify webhook signature
 * @param {string} payload - Raw request body
 * @param {string} signature - Signature from header
 * @param {string} secret - Webhook secret
 * @param {string} algorithm - Hash algorithm (default: sha256)
 * @returns {boolean}
 */
function verifySignature(payload, signature, secret, algorithm = 'sha256') {
  if (!signature || !secret) return false;
  
  try {
    const hmac = crypto.createHmac(algorithm, secret);
    hmac.update(payload);
    const digest = hmac.digest('hex');
    
    // Handle different signature formats
    const sig = signature.replace(/^sha256=/, '').trim();
    
    return crypto.timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(digest)
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Parse SendGrid webhook payload
 * @param {Object} payload - SendGrid webhook data
 * @returns {Object} Normalized email data
 */
function parseSendGridPayload(payload) {
  // SendGrid Inbound Parse sends arrays
  const normalize = (val) => Array.isArray(val) ? val[0] : val;
  
  return {
    from: normalize(payload.from),
    to: normalize(payload.to),
    cc: payload.cc ? normalize(payload.cc).split(',').map(s => s.trim()) : [],
    subject: normalize(payload.subject) || '',
    text: normalize(payload.text) || '',
    html: normalize(payload.html) || '',
    headers: parseHeaders(normalize(payload.headers)),
    attachments: parseSendGridAttachments(payload.attachments || {}),
    envelope: payload.envelope ? JSON.parse(normalize(payload.envelope)) : {},
    charsets: payload.charsets ? JSON.parse(normalize(payload.charsets)) : {}
  };
}

/**
 * Parse AWS SES webhook payload
 * @param {Object} payload - AWS SES SNS notification
 * @returns {Object|null} Normalized email data or null if not a valid email
 */
function parseSESPayload(payload) {
  // SES sends SNS notifications
  if (payload.Event === 'Receive' || payload.eventType === 'Receive') {
    const mail = payload.mail || payload.Message?.mail;
    const receipt = payload.receipt || payload.Message?.receipt;
    
    if (!mail) return null;
    
    return {
      messageId: mail.messageId,
      from: mail.source,
      to: mail.destination,
      cc: mail.commonHeaders?.cc || [],
      subject: mail.commonHeaders?.subject || '',
      date: mail.timestamp,
      headers: mail.headers?.reduce((acc, h) => {
        acc[h.name] = h.value;
        return acc;
      }, {}) || {},
      // Note: Actual content needs to be fetched from S3
      s3Bucket: receipt?.action?.bucketName,
      s3Key: receipt?.action?.objectKey
    };
  }
  
  return null;
}

/**
 * Parse Mailgun webhook payload
 * @param {Object} payload - Mailgun webhook data
 * @returns {Object} Normalized email data
 */
function parseMailgunPayload(payload) {
  return {
    from: payload.sender || payload.from,
    to: payload.recipient || payload.to,
    subject: payload.subject || '',
    text: payload['body-plain'] || payload.text || '',
    html: payload['body-html'] || payload.html || '',
    messageId: payload['Message-Id'] || payload.messageId,
    headers: parseHeaders(payload['message-headers']),
    attachments: [], // Mailgun sends attachments separately
    timestamp: payload.timestamp,
    token: payload.token,
    signature: payload.signature
  };
}

/**
 * Parse Postmark webhook payload
 * @param {Object} payload - Postmark webhook data
 * @returns {Object} Normalized email data
 */
function parsePostmarkPayload(payload) {
  return {
    from: payload.From,
    to: payload.To,
    cc: payload.Cc,
    subject: payload.Subject || '',
    text: payload.TextBody || '',
    html: payload.HtmlBody || '',
    messageId: payload.MessageID,
    headers: payload.Headers?.reduce((acc, h) => {
      acc[h.Name] = h.Value;
      return acc;
    }, {}) || {},
    attachments: payload.Attachments?.map(att => ({
      filename: att.Name,
      contentType: att.ContentType,
      size: att.ContentLength,
      content: att.Content
    })) || [],
    date: payload.Date
  };
}

/**
 * Parse generic webhook payload
 * @param {Object} payload - Generic webhook data
 * @returns {Object} Normalized email data
 */
function parseGenericPayload(payload) {
  return {
    from: payload.from || payload.sender || payload.From,
    to: payload.to || payload.recipient || payload.To,
    cc: payload.cc || payload.Cc || [],
    subject: payload.subject || payload.Subject || '',
    text: payload.text || payload.body || payload.TextBody || '',
    html: payload.html || payload.HtmlBody || '',
    messageId: payload.messageId || payload.MessageID || payload['Message-Id'],
    headers: payload.headers || {},
    attachments: payload.attachments || [],
    raw: payload.raw
  };
}

/**
 * Parse headers string into object
 * @param {string|Array} headers - Headers string or array
 * @returns {Object} Parsed headers
 */
function parseHeaders(headers) {
  if (!headers) return {};
  
  if (typeof headers === 'object' && !Array.isArray(headers)) {
    return headers;
  }
  
  const result = {};
  
  if (typeof headers === 'string') {
    headers.split('\n').forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        result[key] = value;
      }
    });
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      result[key] = value;
    });
  }
  
  return result;
}

/**
 * Parse SendGrid attachments
 * @param {Object} attachments - SendGrid attachments object
 * @returns {Array} Parsed attachments
 */
function parseSendGridAttachments(attachments) {
  return Object.entries(attachments).map(([name, data]) => ({
    filename: name,
    contentType: data.type,
    size: data.size,
    content: data.content // base64 encoded
  }));
}

/**
 * Auto-detect and parse webhook payload
 * @param {Object} payload - Raw webhook payload
 * @param {Object} headers - Request headers
 * @returns {Object} { provider: string, data: Object }
 */
function autoParse(payload, headers) {
  const userAgent = headers['user-agent'] || '';
  const contentType = headers['content-type'] || '';
  
  // Detect provider
  if (userAgent.includes('SendGrid') || payload.envelope || payload.charsets) {
    return {
      provider: 'sendgrid',
      data: parseSendGridPayload(payload)
    };
  }
  
  if (payload.Type === 'Notification' || payload.TopicArn || payload.mail?.source) {
    return {
      provider: 'ses',
      data: parseSESPayload(payload)
    };
  }
  
  if (payload.token && payload.signature && payload.timestamp) {
    return {
      provider: 'mailgun',
      data: parseMailgunPayload(payload)
    };
  }
  
  if (payload.MessageID || payload.FromFull) {
    return {
      provider: 'postmark',
      data: parsePostmarkPayload(payload)
    };
  }
  
  // Default to generic
  return {
    provider: 'generic',
    data: parseGenericPayload(payload)
  };
}

/**
 * Create webhook response
 * @param {boolean} success - Whether processing succeeded
 * @param {string} message - Response message
 * @param {Object} data - Additional data
 * @returns {Object} Response object
 */
function createResponse(success, message, data = {}) {
  return {
    success,
    message,
    ...data,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  verifySignature,
  parseSendGridPayload,
  parseSESPayload,
  parseMailgunPayload,
  parsePostmarkPayload,
  parseGenericPayload,
  autoParse,
  createResponse,
  parseHeaders
};
