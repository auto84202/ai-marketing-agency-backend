import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

export interface OpenAIResponse {
  content: string;
  tokensUsed: number;
  cost: number;
  model: string;
  finishReason: string;
}

export interface ImageGenerationResponse {
  imageUrl: string;
  revisedPrompt?: string;
  tokensUsed: number;
  cost: number;
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private openai?: OpenAI;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.initializeOpenAI();
  }

  /**
   * Initialize OpenAI client from .env file
   */
  private initializeOpenAI(): void {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const organizationId = this.configService.get<string>('OPENAI_ORGANIZATION_ID');
    
    // Check if API key is provided and valid
    if (apiKey && apiKey !== 'your-openai-api-key-here' && apiKey.trim() !== '' && apiKey.startsWith('sk-')) {
      try {
        this.openai = new OpenAI({ 
          apiKey: apiKey.trim(),
          organization: organizationId && organizationId.trim() !== '' ? organizationId.trim() : undefined,
        });
        this.isConfigured = true;
        this.logger.log('✅ OpenAI service initialized successfully with API key from .env');
        this.logger.debug(`Using OpenAI model: ${this.configService.get<string>('OPENAI_CHATBOT_MODEL') || 'gpt-4'}`);
      } catch (error) {
        this.logger.error(`Failed to initialize OpenAI client: ${error}`);
        this.isConfigured = false;
      }
    } else {
      this.isConfigured = false;
      if (!apiKey || apiKey.trim() === '' || apiKey === 'your-openai-api-key-here') {
        this.logger.warn('⚠️  OPENAI_API_KEY not found in .env file. Chatbot will use mock responses.');
        this.logger.warn('⚠️  To enable real AI responses, add OPENAI_API_KEY=sk-... to your backend/.env file');
      } else if (!apiKey.startsWith('sk-')) {
        this.logger.warn('⚠️  OPENAI_API_KEY appears to be invalid (should start with "sk-"). Chatbot will use mock responses.');
      }
    }
  }

  /**
   * Generate text content using OpenAI
   */
  async generateText(
    prompt: string,
    options: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
    } = {},
  ): Promise<OpenAIResponse> {
    try {
      if (!this.isConfigured) {
        return this.generateMockTextResponse(prompt, options);
      }

      this.logger.log(`Generating text with model: ${options.model || 'gpt-4'}`);

      const messages: Array<{ role: string; content: string }> = [];
      
      // Add system prompt if provided
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      
      // Add conversation history if provided
      if (options.conversationHistory && Array.isArray(options.conversationHistory)) {
        // Filter and format conversation history (only include user and assistant messages)
        const formattedHistory = options.conversationHistory
          .filter(msg => msg && (msg.role === 'user' || msg.role === 'assistant'))
          .map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content || ''
          }));
        messages.push(...formattedHistory);
      }
      
      // Add current user message
      messages.push({ role: 'user', content: prompt });

      let completion;
      try {
        completion = await this.openai!.chat.completions.create({
          model: options.model || 'gpt-4',
          messages: messages as any,
          max_tokens: options.maxTokens || 1500,
          temperature: options.temperature || 0.7,
        });
      } catch (apiError: any) {
        // Handle OpenAI API errors with better error information
        const errorStatus = apiError?.status || apiError?.response?.status;
        const errorMessage = apiError?.message || String(apiError);
        
        // Re-throw with status code for better error handling
        const enhancedError = new Error(errorMessage);
        (enhancedError as any).status = errorStatus;
        throw enhancedError;
      }

      const choice = completion.choices[0];
      const content = choice?.message?.content || '';
      const tokensUsed = completion.usage?.total_tokens || 0;
      const cost = this.calculateCost(tokensUsed, options.model || 'gpt-4');

      this.logger.log(`OpenAI response generated: ${tokensUsed} tokens, cost: $${cost.toFixed(4)}`);

      return {
        content,
        tokensUsed,
        cost,
        model: options.model || 'gpt-4',
        finishReason: choice?.finish_reason || 'stop',
      };
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate text: ${msg}`, error);
      
      // If OpenAI is configured but request failed, check error type
      if (this.isConfigured) {
        // Check for quota/billing errors (429)
        if (error?.status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('billing')) {
          this.logger.error('OpenAI API quota exceeded. Please check your billing and plan details.');
          throw new Error('QUOTA_EXCEEDED: Your OpenAI account has exceeded its quota or billing limit. Please check your OpenAI account billing and upgrade your plan at https://platform.openai.com/account/billing');
        }
        
        // Check for authentication errors (401)
        if (error?.status === 401 || msg.includes('401') || msg.includes('Invalid API key') || msg.includes('authentication')) {
          this.logger.error('OpenAI API authentication failed. Please check your API key.');
          throw new Error('AUTH_ERROR: Invalid OpenAI API key. Please verify your OPENAI_API_KEY in .env file is correct.');
        }
        
        // Other API errors
        this.logger.error('OpenAI API request failed.');
        throw new Error(`OpenAI API error: ${msg}`);
      }
      
      // Only use mock if OpenAI is not configured
      this.logger.warn('Using mock response because OpenAI is not configured. Set OPENAI_API_KEY in .env file.');
      return this.generateMockTextResponse(prompt, options);
    }
  }

  /**
   * Generate images using DALL-E
   * TODO: Implement when API key is provided
   */
  async generateImage(
    prompt: string,
    options: {
      size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
      quality?: 'standard' | 'hd';
      style?: 'vivid' | 'natural';
      n?: number;
    } = {},
  ): Promise<ImageGenerationResponse[]> {
    try {
      if (!this.isConfigured) {
        return [this.generateMockImageResponse(prompt, options)];
      }

      this.logger.log(`Generating image with prompt: ${prompt.substring(0, 50)}...`);

      const response = await this.openai!.images.generate({
        model: 'dall-e-3',
        prompt,
        size: options.size || '1024x1024',
        quality: options.quality || 'standard',
        style: options.style || 'vivid',
        n: options.n || 1,
      });

      const imagesData = response.data || [];
      const images = imagesData.map((image: any) => ({
        imageUrl: image.url || '',
        revisedPrompt: image.revised_prompt,
        tokensUsed: 0, // DALL-E doesn't use tokens in the same way
        cost: this.calculateImageCost(options.size || '1024x1024', options.quality || 'standard'),
      }));

      return images;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate image: ${msg}`);
      // Fallback to mock response
      return [this.generateMockImageResponse(prompt, options)];
    }
  }

  /**
   * Create embeddings using OpenAI
   * TODO: Implement when API key is provided
   */
  async createEmbeddings(
    text: string,
    options: {
      model?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
    } = {},
  ): Promise<{
    embeddings: number[];
    tokensUsed: number;
    cost: number;
  }> {
    try {
      if (!this.isConfigured) {
        return this.generateMockEmbeddings(text, options);
      }

      this.logger.log(`Creating embeddings for text of length: ${text.length}`);

      const response = await this.openai!.embeddings.create({
        model: options.model || 'text-embedding-3-small',
        input: text,
      });

      const embeddings = response.data[0]?.embedding || [];
      const tokensUsed = response.usage?.total_tokens || 0;
      const cost = this.calculateEmbeddingCost(tokensUsed, options.model || 'text-embedding-3-small');

      return {
        embeddings,
        tokensUsed,
        cost,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create embeddings: ${msg}`);
      // Fallback to mock response
      return this.generateMockEmbeddings(text, options);
    }
  }

  /**
   * Fine-tune a model
   * TODO: Implement when API key is provided
   */
  async fineTuneModel(
    trainingData: any[],
    options: {
      model?: string;
      suffix?: string;
    } = {},
  ): Promise<{
    fineTunedModel: string;
    status: string;
    trainingCost: number;
  }> {
    try {
      if (!this.isConfigured) {
        return this.generateMockFineTuneResponse(trainingData, options);
      }

      this.logger.log(`Fine-tuning model with ${trainingData.length} training examples`);

      // Create training file
      const trainingFile = await this.openai!.files.create({
        file: new File([JSON.stringify(trainingData)], 'training.jsonl', {
          type: 'application/json',
        }),
        purpose: 'fine-tune',
      });

      // Start fine-tuning job
      const fineTuneJob = await this.openai!.fineTuning.jobs.create({
        training_file: trainingFile.id,
        model: options.model || 'gpt-3.5-turbo',
        suffix: options.suffix,
      });

      return {
        fineTunedModel: fineTuneJob.id,
        status: fineTuneJob.status,
        trainingCost: this.calculateFineTuningCost(trainingData.length),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fine-tune model: ${msg}`);
      throw error;
    }
  }

  /**
   * Get model information
   */
  async getModels(): Promise<any[]> {
    try {
      if (!this.isConfigured) {
        return this.getMockModels();
      }

      const models = await this.openai!.models.list();
      return models.data.map(model => ({
        id: model.id,
        object: model.object,
        created: model.created,
        owned_by: model.owned_by,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get models: ${msg}`);
      return this.getMockModels();
    }
  }

  /**
   * Calculate cost for text generation
   */
  private calculateCost(tokens: number, model: string): number {
    const pricing: Record<string, number> = {
      'gpt-4': 0.03,
      'gpt-4-turbo': 0.01,
      'gpt-3.5-turbo': 0.002,
      'gpt-3.5-turbo-16k': 0.004,
    };
    const pricePer1K = pricing[model as string] || 0.002;
    return (tokens / 1000) * pricePer1K;
  }

  /**
   * Calculate cost for image generation
   */
  private calculateImageCost(size: string, quality: string): number {
    const pricing: Record<string, number> = {
      '256x256': 0.016,
      '512x512': 0.018,
      '1024x1024': 0.02,
      '1792x1024': 0.04,
      '1024x1792': 0.04,
    };
    
    const basePrice = pricing[size] || 0.02;
    return quality === 'hd' ? basePrice * 2 : basePrice;
  }

  /**
   * Calculate cost for embeddings
   */
  private calculateEmbeddingCost(tokens: number, model: string): number {
    const pricing: Record<string, number> = {
      'text-embedding-3-small': 0.00002,
      'text-embedding-3-large': 0.00013,
      'text-embedding-ada-002': 0.0001,
    };
    const pricePer1K = pricing[model as string] || 0.00002;
    return (tokens / 1000) * pricePer1K;
  }

  /**
   * Calculate fine-tuning cost
   */
  private calculateFineTuningCost(trainingExamples: number): number {
    // Simplified calculation - actual cost depends on tokens and model
    return trainingExamples * 0.008;
  }

  /**
   * Generate mock text response
   */
  private generateMockTextResponse(prompt: string, options: any): OpenAIResponse {
    return {
      content: `This is a mock response for: "${prompt.substring(0, 100)}...". In production, this would be generated by OpenAI's ${options.model || 'gpt-4'} model.`,
      tokensUsed: Math.floor(Math.random() * 500) + 100,
      cost: Math.random() * 0.02 + 0.001,
      model: options.model || 'gpt-4',
      finishReason: 'stop',
    };
  }

  /**
   * Generate mock image response
   */
  private generateMockImageResponse(prompt: string, options: any): ImageGenerationResponse {
    return {
      imageUrl: `https://via.placeholder.com/${options.size || '1024x1024'}/0000FF/FFFFFF?text=Mock+Image+for+${encodeURIComponent(prompt.substring(0, 20))}`,
      revisedPrompt: `Revised: ${prompt}`,
      tokensUsed: 0,
      cost: this.calculateImageCost(options.size || '1024x1024', options.quality || 'standard'),
    };
  }

  /**
   * Generate mock embeddings
   */
  private generateMockEmbeddings(text: string, options: any): any {
    return {
      embeddings: Array.from({ length: 1536 }, () => Math.random() * 2 - 1), // 1536 dimensions for text-embedding-3-small
      tokensUsed: Math.ceil(text.length / 4), // Rough token estimation
      cost: Math.random() * 0.001 + 0.0001,
    };
  }

  /**
   * Generate mock fine-tune response
   */
  private generateMockFineTuneResponse(trainingData: any[], options: any): any {
    return {
      fineTunedModel: `ft:${options.model || 'gpt-3.5-turbo'}:${Date.now()}`,
      status: 'succeeded',
      trainingCost: this.calculateFineTuningCost(trainingData.length),
    };
  }

  /**
   * Get mock models
   */
  private getMockModels(): any[] {
    return [
      { id: 'gpt-4', object: 'model', created: 1640995200, owned_by: 'openai' },
      { id: 'gpt-4-turbo', object: 'model', created: 1699123200, owned_by: 'openai' },
      { id: 'gpt-3.5-turbo', object: 'model', created: 1677619200, owned_by: 'openai' },
      { id: 'dall-e-3', object: 'model', created: 1699123200, owned_by: 'openai' },
      { id: 'text-embedding-3-small', object: 'model', created: 1677619200, owned_by: 'openai' },
    ];
  }
}