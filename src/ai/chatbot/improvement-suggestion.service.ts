import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenAIService } from '../../integrations/openai/openai.service';

export interface ImprovementSuggestion {
  type: 'response_quality' | 'response_time' | 'conversation_flow' | 'knowledge_gap' | 'user_satisfaction' | 'proactive_engagement';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommendation: string;
  impact: string;
  metadata?: any;
}

@Injectable()
export class ImprovementSuggestionService {
  private readonly logger = new Logger(ImprovementSuggestionService.name);

  constructor(
    private prisma: PrismaService,
    private openaiService: OpenAIService,
  ) {}

  /**
   * Analyze conversations and generate improvement suggestions
   */
  async analyzeAndSuggestImprovements(chatbotId: string, days: number = 7): Promise<ImprovementSuggestion[]> {
    try {
      this.logger.log(`Analyzing conversations for chatbot ${chatbotId} over the last ${days} days`);

      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - days);

      // Get recent conversations
      const conversations = await this.prisma.conversation.findMany({
        where: {
          chatbotId,
          createdAt: { gte: dateThreshold },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000, // Analyze up to 1000 recent conversations
      });

      if (conversations.length === 0) {
        return this.getDefaultSuggestions();
      }

      const suggestions: ImprovementSuggestion[] = [];

      // 1. Analyze response quality
      suggestions.push(...this.analyzeResponseQuality(conversations));

      // 2. Analyze conversation flow
      suggestions.push(...this.analyzeConversationFlow(conversations));

      // 3. Identify knowledge gaps
      suggestions.push(...this.identifyKnowledgeGaps(conversations));

      // 4. Analyze user satisfaction indicators
      suggestions.push(...this.analyzeUserSatisfaction(conversations));

      // 5. Get AI-powered suggestions
      const aiSuggestions = await this.getAIPoweredSuggestions(conversations);
      suggestions.push(...aiSuggestions);

      // Sort by priority
      return this.sortSuggestionsByPriority(suggestions);
    } catch (error) {
      this.logger.error(`Failed to analyze conversations: ${error}`);
      return this.getDefaultSuggestions();
    }
  }

  /**
   * Analyze response quality metrics
   */
  private analyzeResponseQuality(conversations: any[]): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    // Calculate average confidence
    const avgConfidence = conversations.reduce((sum, conv) => sum + (conv.confidence || 0), 0) / conversations.length;

    if (avgConfidence < 0.7) {
      suggestions.push({
        type: 'response_quality',
        priority: 'high',
        title: 'Low Response Confidence Detected',
        description: `Average response confidence is ${(avgConfidence * 100).toFixed(1)}%, indicating the chatbot may need better training data or FAQ content.`,
        recommendation: 'Review and expand FAQ database, add more training examples, and improve intent detection patterns.',
        impact: 'Improving response confidence will increase user satisfaction and reduce the need for human intervention.',
      });
    }

    // Check for common "I don't know" patterns
    const unclearResponses = conversations.filter(conv => 
      conv.botResponse && (
        conv.botResponse.toLowerCase().includes("i don't know") ||
        conv.botResponse.toLowerCase().includes("i'm not sure") ||
        conv.botResponse.toLowerCase().includes("i cannot")
      )
    ).length;

    if (unclearResponses > conversations.length * 0.1) {
      suggestions.push({
        type: 'knowledge_gap',
        priority: 'high',
        title: 'Frequent Knowledge Gaps',
        description: `${unclearResponses} out of ${conversations.length} conversations contain unclear responses (${((unclearResponses / conversations.length) * 100).toFixed(1)}%).`,
        recommendation: 'Identify common topics where the chatbot struggles and add them to the knowledge base. Review conversation history to find patterns.',
        impact: 'Filling knowledge gaps will significantly improve user experience and reduce frustration.',
        metadata: { unclearResponseCount: unclearResponses, totalConversations: conversations.length },
      });
    }

    return suggestions;
  }

  /**
   * Analyze conversation flow
   */
  private analyzeConversationFlow(conversations: any[]): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    // Group by session to analyze conversation length
    const sessionMap = new Map<string, any[]>();
    conversations.forEach(conv => {
      if (!sessionMap.has(conv.sessionId)) {
        sessionMap.set(conv.sessionId, []);
      }
      sessionMap.get(conv.sessionId)!.push(conv);
    });

    const avgConversationLength = Array.from(sessionMap.values())
      .reduce((sum, session) => sum + session.length, 0) / sessionMap.size;

    // Very short conversations might indicate the chatbot isn't engaging
    if (avgConversationLength < 2) {
      suggestions.push({
        type: 'conversation_flow',
        priority: 'medium',
        title: 'Short Conversation Sessions',
        description: `Average conversation length is ${avgConversationLength.toFixed(1)} messages, suggesting users may not be finding the chatbot helpful enough.`,
        recommendation: 'Enhance the welcome message, add proactive suggestions, and improve the chatbot\'s ability to ask follow-up questions.',
        impact: 'Longer, more engaging conversations lead to better user satisfaction and higher conversion rates.',
      });
    }

    // Very long conversations might indicate confusion
    if (avgConversationLength > 10) {
      suggestions.push({
        type: 'conversation_flow',
        priority: 'medium',
        title: 'Overly Long Conversations',
        description: `Average conversation length is ${avgConversationLength.toFixed(1)} messages, which may indicate users are struggling to find answers.`,
        recommendation: 'Improve FAQ matching, add quick action buttons, and streamline the conversation flow to help users find answers faster.',
        impact: 'Reducing conversation length while maintaining quality will improve user experience and reduce support costs.',
      });
    }

    return suggestions;
  }

  /**
   * Identify knowledge gaps
   */
  private identifyKnowledgeGaps(conversations: any[]): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    // Find common intents with low confidence
    const intentMap = new Map<string, { count: number; totalConfidence: number }>();
    conversations.forEach(conv => {
      if (conv.intent) {
        const existing = intentMap.get(conv.intent) || { count: 0, totalConfidence: 0 };
        existing.count++;
        existing.totalConfidence += conv.confidence || 0;
        intentMap.set(conv.intent, existing);
      }
    });

    // Find intents with low average confidence
    intentMap.forEach((stats, intent) => {
      const avgConfidence = stats.totalConfidence / stats.count;
      if (avgConfidence < 0.6 && stats.count >= 3) {
        suggestions.push({
          type: 'knowledge_gap',
          priority: 'medium',
          title: `Weak Handling of "${intent}" Intent`,
          description: `The "${intent}" intent has an average confidence of ${(avgConfidence * 100).toFixed(1)}% across ${stats.count} conversations.`,
          recommendation: `Add more training examples and FAQ entries related to "${intent}". Improve intent detection patterns for this category.`,
          impact: 'Improving handling of this intent will reduce user frustration and improve overall chatbot effectiveness.',
          metadata: { intent, count: stats.count, avgConfidence },
        });
      }
    });

    return suggestions;
  }

  /**
   * Analyze user satisfaction indicators
   */
  private analyzeUserSatisfaction(conversations: any[]): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    // Check for negative sentiment indicators in bot responses (indicating user frustration)
    const negativeKeywords = ['sorry', 'apologize', 'unfortunately', 'cannot help', 'unable'];
    const frustratedResponses = conversations.filter(conv => 
      conv.botResponse && negativeKeywords.some(keyword => 
        conv.botResponse.toLowerCase().includes(keyword)
      )
    ).length;

    if (frustratedResponses > conversations.length * 0.15) {
      suggestions.push({
        type: 'user_satisfaction',
        priority: 'high',
        title: 'High Frequency of Apologetic Responses',
        description: `${frustratedResponses} out of ${conversations.length} conversations contain apologetic responses, suggesting users are not getting the help they need.`,
        recommendation: 'Review common failure points, expand knowledge base, and implement better fallback strategies. Consider adding human handoff for complex issues.',
        impact: 'Reducing apologetic responses will significantly improve user satisfaction and brand perception.',
        metadata: { frustratedResponseCount: frustratedResponses, totalConversations: conversations.length },
      });
    }

    return suggestions;
  }

  /**
   * Get AI-powered suggestions using OpenAI
   */
  private async getAIPoweredSuggestions(conversations: any[]): Promise<ImprovementSuggestion[]> {
    try {
      // Sample conversations for analysis (to avoid token limits)
      const sampleSize = Math.min(50, conversations.length);
      const sampleConversations = conversations.slice(0, sampleSize);

      const conversationSummary = sampleConversations.map(conv => ({
        userMessage: conv.userMessage?.substring(0, 200),
        botResponse: conv.botResponse?.substring(0, 200),
        intent: conv.intent,
        confidence: conv.confidence,
      }));

      const prompt = `Analyze these chatbot conversations and provide 3-5 specific, actionable improvement suggestions. Focus on:
1. Response quality and helpfulness
2. Conversation flow and engagement
3. Knowledge gaps or unclear responses
4. User experience improvements

Conversations:
${JSON.stringify(conversationSummary, null, 2)}

Provide suggestions in JSON format:
[
  {
    "type": "response_quality|conversation_flow|knowledge_gap|user_satisfaction",
    "priority": "high|medium|low",
    "title": "Short title",
    "description": "What was observed",
    "recommendation": "Specific actionable recommendation",
    "impact": "Expected impact of implementing this"
  }
]`;

      const response = await this.openaiService.generateText(prompt, {
        model: 'gpt-4',
        maxTokens: 1000,
        temperature: 0.7,
      });

      // Try to parse JSON from response
      try {
        const jsonMatch = response.content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return parsed.map((s: any) => ({
            ...s,
            type: s.type || 'response_quality',
            priority: s.priority || 'medium',
          })) as ImprovementSuggestion[];
        }
      } catch (parseError) {
        this.logger.warn('Failed to parse AI suggestions, using fallback');
      }

      return [];
    } catch (error) {
      this.logger.error(`Failed to get AI-powered suggestions: ${error}`);
      return [];
    }
  }

  /**
   * Get default suggestions for new chatbots
   */
  private getDefaultSuggestions(): ImprovementSuggestion[] {
    return [
      {
        type: 'proactive_engagement',
        priority: 'medium',
        title: 'Add Welcome Message',
        description: 'A friendly welcome message helps set the tone and guide users on how to interact with the chatbot.',
        recommendation: 'Configure a personalized welcome message that introduces the chatbot and highlights its capabilities.',
        impact: 'Improves first impression and user engagement from the start of the conversation.',
      },
      {
        type: 'knowledge_gap',
        priority: 'medium',
        title: 'Build FAQ Database',
        description: 'A comprehensive FAQ database is essential for handling common questions effectively.',
        recommendation: 'Add frequently asked questions with relevant keywords to help the chatbot provide accurate answers.',
        impact: 'Reduces response time and improves answer accuracy for common queries.',
      },
      {
        type: 'response_quality',
        priority: 'low',
        title: 'Enable Analytics',
        description: 'Analytics help track chatbot performance and identify areas for improvement.',
        recommendation: 'Enable analytics tracking to monitor conversation patterns and user satisfaction.',
        impact: 'Data-driven insights will help optimize the chatbot over time.',
      },
    ];
  }

  /**
   * Sort suggestions by priority
   */
  private sortSuggestionsByPriority(suggestions: ImprovementSuggestion[]): ImprovementSuggestion[] {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return suggestions.sort((a, b) => 
      priorityOrder[a.priority] - priorityOrder[b.priority]
    );
  }

  /**
   * Get proactive suggestions based on conversation patterns
   */
  async getProactiveSuggestions(
    chatbotId: string,
    currentMessage: string,
    conversationHistory: any[]
  ): Promise<string[]> {
    try {
      const suggestions: string[] = [];

      // Analyze message intent
      const lowerMessage = currentMessage.toLowerCase();

      // Suggest relevant topics based on keywords
      if (lowerMessage.includes('price') || lowerMessage.includes('cost')) {
        suggestions.push('Would you like to see our pricing plans?');
        suggestions.push('I can help you compare our service options.');
      }

      if (lowerMessage.includes('feature') || lowerMessage.includes('capability')) {
        suggestions.push('Would you like to learn about our key features?');
        suggestions.push('I can walk you through what we offer.');
      }

      if (lowerMessage.includes('support') || lowerMessage.includes('help')) {
        suggestions.push('I can help you with common questions or connect you with our support team.');
      }

      if (lowerMessage.includes('demo') || lowerMessage.includes('trial')) {
        suggestions.push('Would you like to schedule a demo?');
        suggestions.push('I can help you set up a free trial.');
      }

      // If conversation is long, suggest human handoff
      if (conversationHistory.length > 8) {
        suggestions.push('Would you like me to connect you with a human agent for more personalized assistance?');
      }

      return suggestions;
    } catch (error) {
      this.logger.error(`Failed to get proactive suggestions: ${error}`);
      return [];
    }
  }
}
