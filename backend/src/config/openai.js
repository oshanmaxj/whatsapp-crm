const openaiApiKey = process.env.OPENAI_API_KEY || '';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

module.exports = {
  apiKey: openaiApiKey,
  model: openaiModel,
  maxTokens: 500,
  temperature: 0.2,
  sentimentTemperature: 0.0
};
