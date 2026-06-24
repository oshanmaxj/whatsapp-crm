const OpenAI = require('openai');
const openaiConfig = require('../config/openai');

class AIService {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (!openaiConfig.apiKey) {
      const error = new Error('OPENAI_API_KEY is not configured');
      error.status = 503;
      throw error;
    }

    if (!this.client) {
      this.client = new OpenAI({ apiKey: openaiConfig.apiKey });
    }

    return this.client;
  }

  async createResponse(prompt, options = {}) {
    const input = Array.isArray(prompt) ? prompt : [prompt];
    const response = await this.getClient().responses.create({
      model: openaiConfig.model,
      input,
      temperature: options.temperature ?? openaiConfig.temperature,
      max_output_tokens: options.maxTokens ?? openaiConfig.maxTokens,
      top_p: options.topP || 1,
      stop: options.stop
    });

    const combined = [];
    if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (Array.isArray(item.content)) {
          for (const fragment of item.content) {
            if (fragment.type === 'output_text') {
              combined.push(fragment.text);
            }
          }
        }
      }
    }

    const text = combined.join('').trim() || response.output_text || '';
    return text;
  }

  parseJson(text) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      return null;
    }
  }

  async analyzeMessageSentiment(messageText) {
    if (!messageText) {
      return { label: 'neutral', score: 0.5 };
    }

    const prompt = `Analyze the sentiment of this customer message. Respond with only valid JSON using keys: label, score. Label must be one of positive, neutral, negative. Score must be a number between 0 and 1.\n\nMessage:\n${messageText}`;
    const responseText = await this.createResponse(prompt, { temperature: openaiConfig.sentimentTemperature });
    const result = this.parseJson(responseText);

    if (result && result.label) {
      return {
        label: result.label.toLowerCase(),
        score: Number(result.score) || 0.5
      };
    }

    return { label: 'neutral', score: 0.5 };
  }

  async generateAutoReply({ messageText, contact, lead, sentiment }) {
    const context = [];
    if (contact) {
      context.push(`Contact name: ${contact.firstName || ''} ${contact.lastName || ''}`.trim());
      context.push(`Phone: ${contact.phone || ''}`);
    }

    if (lead) {
      context.push(`Lead stage: ${lead.stage || 'new'}`);
      context.push(`Lead priority: ${lead.priority || 'medium'}`);
    }

    if (sentiment) {
      context.push(`Customer sentiment: ${sentiment.label || 'neutral'}`);
    }

    const prompt = `You are an AI assistant for a sales CRM. A customer message has arrived and you must craft a concise, professional WhatsApp reply. Use the customer message and CRM context to suggest the best next step. If the message appears to be a simple greeting, reply with a friendly acknowledgement and request more details. Reply in one or two short sentences.\n\nContext:\n${context.filter(Boolean).join('\n')}\n\nCustomer message:\n${messageText}\n\nResponse only:`;
    const reply = await this.createResponse(prompt, { temperature: 0.3, maxTokens: 120 });
    return reply;
  }

  async qualifyLead({ contact, lead, latestMessage, conversationSummary }) {
    const prompt = `You are a lead qualification assistant. Using the contact data, existing lead state, latest customer message, and conversation summary, determine if this lead is sales-ready. Return only valid JSON with keys: score, qualificationStatus, qualificationNotes, recommendedPriority. Score should be an integer from 0 to 100. Qualification status should be one of qualified, needs_follow_up, unqualified. Recommended priority should be one of low, medium, high, urgent.\n\nContact: ${contact.firstName || ''} ${contact.lastName || ''}, phone=${contact.phone || ''}.\nLead stage: ${lead.stage || ''}, priority: ${lead.priority || ''}.\nConversation summary: ${conversationSummary || 'none'}.\nLatest message: ${latestMessage}`;

    const responseText = await this.createResponse(prompt, { temperature: 0.3, maxTokens: 220 });
    const result = this.parseJson(responseText);
    if (!result) {
      return {
        score: 50,
        qualificationStatus: 'needs_follow_up',
        qualificationNotes: 'AI qualification unavailable.',
        recommendedPriority: lead.priority || 'medium'
      };
    }

    return {
      score: Number(result.score) || 50,
      qualificationStatus: result.qualificationStatus || 'needs_follow_up',
      qualificationNotes: result.qualificationNotes || result.notes || null,
      recommendedPriority: result.recommendedPriority || lead.priority || 'medium'
    };
  }

  async summarizeConversation({ messages, contact, lead }) {
    const transcript = messages
      .map((message) => `${message.direction === 'inbound' ? 'Customer' : 'Agent'}: ${message.text}`)
      .join('\n');

    const prompt = `Summarize this conversation for an agent handoff in under 120 words. Include key customer needs, requested product or service, sentiment, and any actions already promised.\n\nContact: ${contact.firstName || ''} ${contact.lastName || ''}, phone: ${contact.phone || ''}.\nLead stage: ${lead.stage || ''}, priority: ${lead.priority || ''}.\n\nConversation transcript:\n${transcript}`;

    const summary = await this.createResponse(prompt, { temperature: 0.2, maxTokens: 180 });
    return summary;
  }

  async suggestAgent({ lead, contact, conversationSummary, availableAgents }) {
    const agentList = availableAgents
      .map((agent) => `- ${agent.firstName || ''} ${agent.lastName || ''} (${agent.email || 'no-email'})`.trim())
      .join('\n');

    const prompt = `You are a CRM assistant recommending the best agent for a new lead. Based on the lead state, contact details, conversation summary, and available agents, suggest the single best agent to handle this lead. Return only valid JSON with keys: recommendedAgent, reason.\n\nLead stage: ${lead.stage || ''}, priority: ${lead.priority || ''}.\nContact: ${contact.firstName || ''} ${contact.lastName || ''}, phone: ${contact.phone || ''}.\nConversation summary: ${conversationSummary || 'none'}.\nAvailable agents:\n${agentList}`;

    const responseText = await this.createResponse(prompt, { temperature: 0.3, maxTokens: 200 });
    const result = this.parseJson(responseText);
    if (!result) {
      return {
        recommendedAgent: availableAgents[0] ? `${availableAgents[0].firstName || ''} ${availableAgents[0].lastName || ''}`.trim() : null,
        reason: 'Unable to compute suggestion, using first available agent.'
      };
    }

    return {
      recommendedAgent: result.recommendedAgent || null,
      reason: result.reason || null
    };
  }

  async previewReply({ messageText, contact, lead }) {
    return this.generateAutoReply({ messageText, contact, lead, sentiment: null });
  }
}

module.exports = new AIService();
