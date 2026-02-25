const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4';

/**
 * Generate response suggestions for a ticket
 * @param {Object} params - Parameters
 * @param {Object} params.ticket - Ticket data
 * @param {Array} params.templates - Response templates
 * @param {Array} params.kbArticles - Knowledge base articles
 * @returns {Array} Response suggestions
 */
async function generate({ ticket, templates, kbArticles }) {
  const suggestions = [];

  // 1. Find matching templates
  const templateMatches = findMatchingTemplates(ticket, templates);
  suggestions.push(...templateMatches);

  // 2. Find relevant KB articles
  const kbMatches = findRelevantKBArticles(ticket, kbArticles);
  suggestions.push(...kbMatches);

  // 3. Generate AI response if confidence is high enough
  const aiSuggestion = await generateAIResponse(ticket, kbMatches);
  if (aiSuggestion) {
    suggestions.push(aiSuggestion);
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions.slice(0, 5); // Return top 5
}

/**
 * Find matching response templates
 * @param {Object} ticket - Ticket data
 * @param {Array} templates - Available templates
 * @returns {Array} Matching templates as suggestions
 */
function findMatchingTemplates(ticket, templates) {
  if (!templates || templates.length === 0) return [];

  const suggestions = [];
  const ticketText = `${ticket.subject} ${ticket.body}`.toLowerCase();

  for (const template of templates) {
    let score = 0;
    let matches = 0;

    // Category match
    if (template.category && template.category === ticket.category) {
      score += 30;
      matches++;
    }

    // Tag match
    if (template.tags && template.tags.length > 0) {
      const ticketTags = ticket.tags || [];
      const tagMatches = template.tags.filter(tag =>
        ticketTags.includes(tag)
      ).length;
      score += tagMatches * 10;
      if (tagMatches > 0) matches++;
    }

    // Keyword match
    if (template.keywords && template.keywords.length > 0) {
      const keywordMatches = template.keywords.filter(keyword =>
        ticketText.includes(keyword.toLowerCase())
      ).length;
      score += keywordMatches * 5;
      if (keywordMatches > 0) matches++;
    }

    // Only include if we have some matching
    if (matches > 0) {
      const confidence = Math.min(0.95, 0.4 + (score / 100));
      
      suggestions.push({
        id: `template_${template.id}`,
        type: 'template',
        source: 'template_matched',
        content: template.body,
        subject: template.subject,
        templateId: template.id,
        templateName: template.name,
        confidence,
        reason: `Matched ${matches} criteria from template "${template.name}"`
      });
    }
  }

  return suggestions;
}

/**
 * Find relevant KB articles
 * @param {Object} ticket - Ticket data
 * @param {Array} kbArticles - KB articles
 * @returns {Array} Relevant articles as suggestions
 */
function findRelevantKBArticles(ticket, kbArticles) {
  if (!kbArticles || kbArticles.length === 0) return [];

  const suggestions = [];
  const ticketText = `${ticket.subject} ${ticket.body}`.toLowerCase();
  const ticketWords = ticketText.split(/\s+/);

  for (const article of kbArticles) {
    let score = 0;

    // Category match
    if (article.category && article.category === ticket.category) {
      score += 20;
    }

    // Tag match
    if (article.tags && article.tags.length > 0) {
      const matchingTags = article.tags.filter(tag =>
        ticketText.includes(tag.toLowerCase())
      ).length;
      score += matchingTags * 15;
    }

    // Content similarity (simple word overlap)
    const articleText = `${article.title} ${article.content}`.toLowerCase();
    const articleWords = new Set(articleText.split(/\s+/));
    const commonWords = ticketWords.filter(word =>
      articleWords.has(word) && word.length > 3
    );
    score += commonWords.length * 2;

    // Only include if score is high enough
    if (score >= 15) {
      const confidence = Math.min(0.9, 0.3 + (score / 100));
      
      suggestions.push({
        id: `kb_${article.id}`,
        type: 'kb_article',
        source: 'kb_matched',
        content: article.summary || article.content.substring(0, 500),
        title: article.title,
        articleId: article.id,
        fullArticleUrl: `/kb/${article.id}`,
        confidence,
        reason: `Relevant KB article: "${article.title}"`
      });
    }
  }

  return suggestions;
}

/**
 * Generate AI response suggestion
 * @param {Object} ticket - Ticket data
 * @param {Array} contextArticles - Relevant KB articles for context
 * @returns {Object|null} AI suggestion
 */
async function generateAIResponse(ticket, contextArticles) {
  try {
    // Build context from KB articles
    const context = contextArticles
      .slice(0, 3)
      .map(a => `Article: ${a.title}\n${a.content?.substring(0, 1000) || ''}`)
      .join('\n\n---\n\n');

    const prompt = `You are a helpful customer support agent. Draft a response to the following ticket.

TICKET:
Subject: ${ticket.subject}
Body: ${ticket.body}
Category: ${ticket.category || 'general'}
Priority: ${ticket.priority || 'medium'}

${context ? `RELEVANT KNOWLEDGE BASE ARTICLES:\n${context}\n\n` : ''}
Instructions:
1. Be professional, empathetic, and helpful
2. Address the customer's specific issue
3. If you reference a KB article, include the link
4. Provide clear next steps
5. Sign off professionally

Draft a response:`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a professional customer support agent. Write clear, helpful responses.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const content = response.choices[0].message.content.trim();

    return {
      id: `ai_${Date.now()}`,
      type: 'ai_generated',
      source: 'ai_generated',
      content,
      confidence: 0.75,
      reason: 'AI-generated response based on ticket analysis'
    };
  } catch (error) {
    console.error('AI response generation error:', error);
    return null;
  }
}

/**
 * Improve response based on feedback
 * @param {string} originalResponse - Original AI response
 * @param {string} feedback - User feedback
 * @returns {string} Improved response
 */
async function improveResponse(originalResponse, feedback) {
  try {
    const prompt = `Improve the following customer support response based on the feedback provided.

ORIGINAL RESPONSE:
${originalResponse}

FEEDBACK:
${feedback}

Please provide an improved version:`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are improving a customer support response based on feedback.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.5,
      max_tokens: 800
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Response improvement error:', error);
    return originalResponse;
  }
}

/**
 * Summarize a long ticket thread
 * @param {Array} messages - Ticket messages
 * @returns {string} Summary
 */
async function summarizeThread(messages) {
  try {
    const threadText = messages
      .map(m => `${m.sender_type}: ${m.body}`)
      .join('\n\n');

    const prompt = `Summarize the following support ticket thread in 2-3 sentences:

${threadText}

Summary:`;

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'Summarize support ticket threads concisely.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Thread summarization error:', error);
    return '';
  }
}

module.exports = {
  generate,
  findMatchingTemplates,
  findRelevantKBArticles,
  generateAIResponse,
  improveResponse,
  summarizeThread
};
