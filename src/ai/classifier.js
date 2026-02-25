const OpenAI = require('openai');

// Initialize AI client based on available API keys
const getAIClient = () => {
  // Prefer Kimi if key is available (better for international/Chinese support)
  if (process.env.KIMI_API_KEY) {
    return new OpenAI({
      apiKey: process.env.KIMI_API_KEY,
      baseURL: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1'
    });
  }
  
  // Fallback to OpenAI
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
};

const aiClient = getAIClient();

// Model selection
const getModel = () => {
  if (process.env.KIMI_API_KEY) {
    return process.env.KIMI_MODEL || 'moonshot-v1-8k';
  }
  return process.env.OPENAI_MODEL || 'gpt-4';
};

const MODEL = getModel();

// Category definitions
const CATEGORIES = [
  'billing',
  'technical',
  'feature_request',
  'bug',
  'account',
  'general'
];

// Priority definitions
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

// Sentiment definitions
const SENTIMENTS = ['positive', 'neutral', 'negative', 'very_negative'];

/**
 * Classify a ticket using AI (OpenAI or Kimi)
 * @param {Object} ticket - Ticket data
 * @param {string} ticket.subject - Ticket subject
 * @param {string} ticket.body - Ticket body
 * @returns {Object} Classification results
 */
async function classify(ticket) {
  const startTime = Date.now();
  const provider = process.env.KIMI_API_KEY ? 'kimi' : 'openai';
  
  const prompt = `Analyze the following customer support ticket and provide:
1. Category (choose from: ${CATEGORIES.join(', ')})
2. Priority (choose from: ${PRIORITIES.join(', ')})
3. Sentiment (choose from: ${SENTIMENTS.join(', ')})
4. Sentiment score (number between -1.0 and 1.0)
5. Confidence scores for each prediction (0.0 to 1.0)

Ticket Subject: ${ticket.subject}
Ticket Body: ${ticket.body}

Respond in JSON format:
{
  "category": "string",
  "priority": "string",
  "sentiment": {
    "label": "string",
    "score": number
  },
  "confidence": {
    "category": number,
    "priority": number,
    "sentiment": number
  },
  "reasoning": "string"
}`;

  try {
    const response = await aiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an AI assistant that classifies customer support tickets. Be accurate and provide confidence scores.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    const processingTime = Date.now() - startTime;

    // Validate and normalize results
    const classification = {
      category: CATEGORIES.includes(result.category) ? result.category : 'general',
      priority: PRIORITIES.includes(result.priority) ? result.priority : 'medium',
      sentiment: {
        label: SENTIMENTS.includes(result.sentiment?.label) 
          ? result.sentiment.label 
          : 'neutral',
        score: Math.max(-1, Math.min(1, result.sentiment?.score || 0))
      },
      confidence: {
        category: Math.max(0, Math.min(1, result.confidence?.category || 0.5)),
        priority: Math.max(0, Math.min(1, result.confidence?.priority || 0.5)),
        sentiment: Math.max(0, Math.min(1, result.confidence?.sentiment || 0.5))
      },
      reasoning: result.reasoning || '',
      modelVersion: MODEL,
      modelProvider: provider,
      processingTimeMs: processingTime
    };

    // Calculate overall confidence
    classification.overallConfidence = (
      classification.confidence.category +
      classification.confidence.priority +
      classification.confidence.sentiment
    ) / 3;

    return classification;
  } catch (error) {
    console.error('Classification error:', error);
    
    // Return fallback classification
    return {
      category: 'general',
      priority: 'medium',
      sentiment: { label: 'neutral', score: 0 },
      confidence: {
        category: 0,
        priority: 0,
        sentiment: 0
      },
      overallConfidence: 0,
      reasoning: 'Classification failed',
      modelVersion: MODEL,
      modelProvider: provider,
      processingTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Batch classify multiple tickets
 * @param {Array} tickets - Array of ticket objects
 * @returns {Array} Classification results
 */
async function classifyBatch(tickets) {
  const results = [];
  
  for (const ticket of tickets) {
    const result = await classify(ticket);
    results.push({
      ticketId: ticket.id,
      ...result
    });
  }
  
  return results;
}

/**
 * Analyze sentiment in detail
 * @param {string} text - Text to analyze
 * @returns {Object} Detailed sentiment analysis
 */
async function analyzeSentiment(text) {
  const prompt = `Analyze the sentiment of the following text in detail:

Text: "${text}"

Provide:
1. Overall sentiment score (-1.0 to 1.0)
2. Sentiment magnitude/strength (0.0 to 1.0)
3. Emotion breakdown (joy, anger, sadness, fear, disgust) - each 0.0 to 1.0

Respond in JSON format:
{
  "score": number,
  "magnitude": number,
  "emotions": {
    "joy": number,
    "anger": number,
    "sadness": number,
    "fear": number,
    "disgust": number
  }
}`;

  try {
    const response = await aiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a sentiment analysis expert. Provide detailed emotion breakdowns.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return {
      score: 0,
      magnitude: 0,
      emotions: { joy: 0, anger: 0, sadness: 0, fear: 0, disgust: 0 }
    };
  }
}

/**
 * Detect language of text
 * @param {string} text - Text to analyze
 * @returns {string} ISO language code
 */
async function detectLanguage(text) {
  try {
    const response = await aiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'Detect the language of the provided text. Respond with only the ISO 639-1 language code (e.g., "en", "es", "fr", "zh", "ar").'
        },
        {
          role: 'user',
          content: text.substring(0, 500) // Limit text length
        }
      ],
      temperature: 0,
      max_tokens: 10
    });

    return response.choices[0].message.content.trim().toLowerCase();
  } catch (error) {
    console.error('Language detection error:', error);
    return 'en';
  }
}

/**
 * Extract entities from ticket
 * @param {string} text - Text to analyze
 * @returns {Object} Extracted entities
 */
async function extractEntities(text) {
  const prompt = `Extract key entities from the following support ticket:

Text: "${text}"

Extract:
- Order IDs
- Account numbers
- Email addresses
- Phone numbers
- Product names
- Dates

Respond in JSON format:
{
  "orderIds": ["string"],
  "accountNumbers": ["string"],
  "emails": ["string"],
  "phones": ["string"],
  "products": ["string"],
  "dates": ["string"]
}`;

  try {
    const response = await aiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'Extract structured entities from support tickets.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Entity extraction error:', error);
    return {
      orderIds: [],
      accountNumbers: [],
      emails: [],
      phones: [],
      products: [],
      dates: []
    };
  }
}

module.exports = {
  classify,
  classifyBatch,
  analyzeSentiment,
  detectLanguage,
  extractEntities,
  CATEGORIES,
  PRIORITIES,
  SENTIMENTS
};
