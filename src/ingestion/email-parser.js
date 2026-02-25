const { simpleParser } = require('mailparser');

/**
 * Parse incoming email data
 * @param {Object} emailData - Raw email data
 * @returns {Object} Parsed email
 */
async function parse(emailData) {
  // If we have raw email content, parse it
  if (emailData.raw) {
    return parseRawEmail(emailData.raw);
  }

  // Otherwise, parse structured email data
  return {
    messageId: emailData.messageId || emailData.headers?.['message-id'],
    inReplyTo: emailData.headers?.['in-reply-to'],
    references: emailData.headers?.references?.split(/\s+/) || [],
    
    from: emailData.from,
    to: Array.isArray(emailData.to) ? emailData.to : [emailData.to],
    cc: emailData.cc || [],
    
    subject: cleanSubject(emailData.subject || ''),
    
    customerEmail: extractEmailAddress(emailData.from),
    customerName: extractDisplayName(emailData.from),
    
    body: emailData.text || stripHtml(emailData.html) || '',
    bodyText: emailData.text || '',
    bodyHtml: emailData.html || '',
    
    attachments: parseAttachments(emailData.attachments || []),
    
    date: emailData.date ? new Date(emailData.date) : new Date(),
    
    // Threading info
    isReply: isReply(emailData.subject),
    threadId: emailData.threadId || emailData.headers?.['x-thread-id']
  };
}

/**
 * Parse raw email content using mailparser
 * @param {string|Buffer} rawEmail - Raw email content
 * @returns {Object} Parsed email
 */
async function parseRawEmail(rawEmail) {
  try {
    const parsed = await simpleParser(rawEmail);

    return {
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references || [],
      
      from: parsed.from?.text || parsed.from,
      to: parsed.to?.map(a => a.text) || [parsed.to?.text],
      cc: parsed.cc?.map(a => a.text) || [],
      
      subject: cleanSubject(parsed.subject || ''),
      
      customerEmail: extractEmailAddress(parsed.from?.text),
      customerName: extractDisplayName(parsed.from?.text),
      
      body: parsed.text || stripHtml(parsed.html) || '',
      bodyText: parsed.text || '',
      bodyHtml: parsed.html || '',
      
      attachments: parsed.attachments?.map(att => ({
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        content: att.content?.toString('base64')
      })) || [],
      
      date: parsed.date || new Date(),
      
      isReply: isReply(parsed.subject),
      threadId: parsed.threadId
    };
  } catch (error) {
    console.error('Raw email parsing error:', error);
    throw new Error('Failed to parse email');
  }
}

/**
 * Clean subject line (remove Re:, Fwd: prefixes)
 * @param {string} subject - Raw subject
 * @returns {string} Cleaned subject
 */
function cleanSubject(subject) {
  if (!subject) return '';
  
  return subject
    .replace(/^(Re:|RE:|Fwd:|FWD:|Fw:|FW:)\s*/gi, '')
    .trim();
}

/**
 * Check if subject indicates a reply
 * @param {string} subject - Email subject
 * @returns {boolean}
 */
function isReply(subject) {
  if (!subject) return false;
  return /^(Re:|RE:)\s*/i.test(subject);
}

/**
 * Extract email address from string
 * @param {string} str - String containing email
 * @returns {string} Email address
 */
function extractEmailAddress(str) {
  if (!str) return '';
  
  const match = str.match(/<([^>]+)>/);
  if (match) return match[1];
  
  const emailMatch = str.match(/[\w.-]+@[\w.-]+\.\w+/);
  return emailMatch ? emailMatch[0] : str;
}

/**
 * Extract display name from email string
 * @param {string} str - String like "John Doe <john@example.com>"
 * @returns {string} Display name
 */
function extractDisplayName(str) {
  if (!str) return '';
  
  const match = str.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  
  return '';
}

/**
 * Extract domain from email address
 * @param {string} email - Email address
 * @returns {string} Domain
 */
function extractDomain(email) {
  if (!email) return '';
  
  const cleanEmail = extractEmailAddress(email);
  const parts = cleanEmail.split('@');
  return parts.length === 2 ? parts[1] : '';
}

/**
 * Strip HTML tags from string
 * @param {string} html - HTML content
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html) return '';
  
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse attachments
 * @param {Array} attachments - Raw attachments
 * @returns {Array} Parsed attachments
 */
function parseAttachments(attachments) {
  return attachments.map(att => ({
    filename: att.filename || att.name || 'unnamed',
    contentType: att.contentType || att.type || 'application/octet-stream',
    size: att.size || 0,
    content: att.content,
    url: att.url
  }));
}

/**
 * Extract quoted text from email body
 * @param {string} body - Email body
 * @returns {Object} { originalText, quotedText }
 */
function extractQuotedText(body) {
  if (!body) return { originalText: '', quotedText: '' };
  
  // Common quote patterns
  const quotePatterns = [
    /^\s*On\s+.+\s+wrote:/m,
    /^\s*>/m,
    /^\s*From:/m,
    /^-{5,}\s*Original Message\s*-{5,}/m,
    /^\s*________________________________/m
  ];
  
  let splitIndex = body.length;
  
  for (const pattern of quotePatterns) {
    const match = body.match(pattern);
    if (match && match.index < splitIndex) {
      splitIndex = match.index;
    }
  }
  
  return {
    originalText: body.substring(0, splitIndex).trim(),
    quotedText: body.substring(splitIndex).trim()
  };
}

/**
 * Validate email data
 * @param {Object} emailData - Email data to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validate(emailData) {
  const errors = [];
  
  if (!emailData.from) {
    errors.push('Missing from address');
  }
  
  if (!emailData.to || (Array.isArray(emailData.to) && emailData.to.length === 0)) {
    errors.push('Missing to address');
  }
  
  if (!emailData.subject && !emailData.body) {
    errors.push('Missing subject and body');
  }
  
  const customerEmail = extractEmailAddress(emailData.from);
  if (!customerEmail || !customerEmail.includes('@')) {
    errors.push('Invalid from email address');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  parse,
  parseRawEmail,
  cleanSubject,
  isReply,
  extractEmailAddress,
  extractDisplayName,
  extractDomain,
  stripHtml,
  parseAttachments,
  extractQuotedText,
  validate
};
