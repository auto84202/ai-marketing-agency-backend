import { registerAs } from '@nestjs/config';

export default registerAs('chatbot', () => ({
  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    organizationId: process.env.OPENAI_ORGANIZATION_ID,
    model: process.env.OPENAI_CHATBOT_MODEL || 'gpt-4',
    maxTokens: parseInt(process.env.OPENAI_CHATBOT_MAX_TOKENS || '500'),
    temperature: parseFloat(process.env.OPENAI_CHATBOT_TEMPERATURE || '0.7'),
    topP: parseFloat(process.env.OPENAI_CHATBOT_TOP_P || '1'),
    frequencyPenalty: parseFloat(process.env.OPENAI_CHATBOT_FREQUENCY_PENALTY || '0'),
    presencePenalty: parseFloat(process.env.OPENAI_CHATBOT_PRESENCE_PENALTY || '0'),
  },

  // Rate Limiting
  rateLimit: {
    requestsPerMinute: parseInt(process.env.CHATBOT_RATE_LIMIT_REQUESTS_PER_MINUTE || '60'),
    requestsPerHour: parseInt(process.env.CHATBOT_RATE_LIMIT_REQUESTS_PER_HOUR || '1000'),
    requestsPerDay: parseInt(process.env.CHATBOT_RATE_LIMIT_REQUESTS_PER_DAY || '10000'),
  },

  // Session Configuration
  session: {
    timeoutMinutes: parseInt(process.env.CHATBOT_SESSION_TIMEOUT_MINUTES || '30'),
    maxConversationHistory: parseInt(process.env.CHATBOT_MAX_CONVERSATION_HISTORY || '50'),
    defaultLanguage: process.env.CHATBOT_DEFAULT_LANGUAGE || 'en',
  },

  // Cost Management
  costManagement: {
    limitPerUserMonthly: parseFloat(process.env.CHATBOT_COST_LIMIT_PER_USER_MONTHLY || '50.00'),
    limitPerDay: parseFloat(process.env.CHATBOT_COST_LIMIT_PER_DAY || '100.00'),
    alertThresholdPercentage: parseInt(process.env.CHATBOT_ALERT_THRESHOLD_PERCENTAGE || '80'),
  },

  // Feature Flags
  features: {
    faqEnabled: process.env.CHATBOT_FAQ_ENABLED !== 'false',
    bookingEnabled: process.env.CHATBOT_BOOKING_ENABLED !== 'false',
    upsellingEnabled: process.env.CHATBOT_UPSELLING_ENABLED !== 'false',
    multilingualEnabled: process.env.CHATBOT_MULTILINGUAL_ENABLED !== 'false',
    analyticsEnabled: process.env.CHATBOT_ANALYTICS_ENABLED !== 'false',
  },

  // Security
  security: {
    maxMessageLength: parseInt(process.env.CHATBOT_MAX_MESSAGE_LENGTH || '1000'),
    allowedDomains: process.env.CHATBOT_ALLOWED_DOMAINS?.split(',') || ['*'],
    requireAuthentication: process.env.CHATBOT_REQUIRE_AUTHENTICATION !== 'false',
  },

  // Monitoring
  monitoring: {
    logLevel: process.env.CHATBOT_LOG_LEVEL || 'info',
    enableMetrics: process.env.CHATBOT_ENABLE_METRICS !== 'false',
    enableTracing: process.env.CHATBOT_ENABLE_TRACING !== 'false',
  },
}));
