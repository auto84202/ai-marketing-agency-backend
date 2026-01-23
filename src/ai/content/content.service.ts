import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

export interface ContentGenerationOptions {
  tone?: 'professional' | 'casual' | 'friendly' | 'authoritative';
  length?: 'short' | 'medium' | 'long';
  style?: 'informative' | 'persuasive' | 'entertaining' | 'educational';
  targetAudience?: string;
  language?: string;
  model?: string;
  keywords?: string[];
}

export interface ContentResult {
  content: string;
  tokensUsed: number;
  cost: number;
  metadata: any;
}

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);
  private openai?: OpenAI;

  constructor(private configService: ConfigService) {
    // Initialize OpenAI client - will be configured when API keys are provided
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  /**
   * Generate content based on type and prompt
   * TODO: Implement when OpenAI API key is provided
   */
  async generateContent(
    type: string,
    prompt: string,
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    try {
      this.logger.log(`Generating ${type} content`);

      // TODO: Replace with actual OpenAI API call when API key is provided
      if (!this.openai) {
        return await this.generateMockContent(type, prompt, options);
      }

      const systemPrompt = this.getSystemPrompt(type, options);
      const completion = await this.openai.chat.completions.create({
        model: options.model || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: this.getMaxTokens(options.length ?? 'medium'),
        temperature: 0.7,
      });

      let content = completion.choices[0]?.message?.content || '';
      const tokensUsed = completion.usage?.total_tokens || 0;
      const cost = this.calculateCost(tokensUsed, options.model || 'gpt-4');

      // For blog posts, append hashtags for social media platforms
      if (type === 'blog') {
        try {
          // Generate hashtags based on the actual blog post content (not just the topic)
          this.logger.log(`Generating hashtags based on blog post content (length: ${content.length} characters)`);
          const hashtags = await this.generateBlogHashtagsFromContent(content, options.keywords || []);
          const hashtagsSection = this.formatHashtagsSection(hashtags);
          
          if (hashtagsSection && hashtagsSection.trim().length > 0) {
            content = `${content}\n\n${hashtagsSection}`;
            this.logger.log(`Successfully appended hashtags to blog post. Hashtag section length: ${hashtagsSection.length}`);
          } else {
            this.logger.warn('Hashtag section is empty, not appending to blog post');
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to generate hashtags for blog post: ${msg}. Blog post will be saved without hashtags.`);
          // Continue without hashtags rather than failing completely
        }
      }

      return {
        content,
        tokensUsed,
        cost,
        metadata: {
          model: options.model || 'gpt-4',
          temperature: 0.7,
          finishReason: completion.choices[0]?.finish_reason,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate content: ${msg}`);
      // Fallback to mock content if API fails
      return await this.generateMockContent(type, prompt, options);
    }
  }

  /**
   * Generate blog post content
   */
  async generateBlogPost(
    topic: string,
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    const prompt = `Write a comprehensive blog post about: ${topic}`;
    // Generate content - hashtags will be automatically appended by generateContent when type is 'blog'
    const result = await this.generateContent('blog', prompt, { ...options, length: 'long' });
    
    // Ensure hashtags are present (they should already be added by generateContent for type='blog')
    // But check if they're missing and add them if needed
    if (!result.content.includes('## Social Media Hashtags') && !result.content.includes('#Facebook') && !result.content.includes('#Instagram')) {
      this.logger.warn('Hashtags missing from blog post, adding them manually based on content');
      try {
        // Generate hashtags based on the actual blog post content
        const hashtags = await this.generateBlogHashtagsFromContent(result.content, options.keywords || []);
        const hashtagsSection = this.formatHashtagsSection(hashtags);
        if (hashtagsSection && hashtagsSection.trim().length > 0) {
          result.content = `${result.content}\n\n${hashtagsSection}`;
          this.logger.log(`Successfully added hashtags to blog post manually based on content`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to add hashtags manually: ${msg}`);
      }
    } else {
      this.logger.log('Hashtags already present in blog post content');
    }
    
    return result;
  }

  /**
   * Extract topic from various prompt formats
   */
  private extractTopicFromPrompt(prompt: string): string {
    // Try to extract topic from common prompt patterns
    const patterns = [
      /Write a comprehensive blog post about:?\s*(.+?)(?:\n|$)/i,
      /Write a comprehensive, engaging blog post based on this campaign description:\s*\n\n(.+?)(?:\n\nMake it|$)/is,
      /blog post about:?\s*(.+?)(?:\n|$)/i,
      /topic:?\s*(.+?)(?:\n|$)/i,
    ];

    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        // Extract first sentence or first 200 characters as topic
        const extracted = match[1].trim();
        const firstSentence = extracted.split(/[.!?]/)[0].trim();
        return firstSentence.length > 0 && firstSentence.length < 200 
          ? firstSentence 
          : extracted.substring(0, 200).trim();
      }
    }

    // Fallback: use first part of prompt as topic
    return prompt.split(/\n/)[0].substring(0, 200).trim() || 'content';
  }

  /**
   * Generate hashtags for blog posts based on the actual content (not just topic)
   * This uses GPT to analyze the blog post and generate relevant hashtags
   */
  private async generateBlogHashtagsFromContent(
    blogContent: string,
    keywords: string[] = [],
  ): Promise<Record<string, string[]>> {
    if (!this.openai) {
      // If no OpenAI, extract topic from content and generate basic hashtags
      const topic = this.extractMainTopicFromContent(blogContent);
      return this.generateIntelligentMockHashtags(blogContent, topic, keywords);
    }

    try {
      // Use the actual blog post content to generate hashtags
      // Truncate content if too long to avoid token limits (use first 2000 characters)
      const contentPreview = blogContent.substring(0, 2000);
      const contentSummary = blogContent.length > 2000 
        ? `${contentPreview}...\n\n[Content continues but summary captured above]`
        : blogContent;

      const prompt = `
        Analyze this blog post content and generate relevant, platform-specific hashtags based on the actual content themes, topics, and key points discussed.
        
        Blog Post Content:
        ${contentSummary}
        
        ${keywords.length > 0 ? `Additional Keywords to Consider: ${keywords.join(', ')}` : ''}
        
        Based on the actual content of this blog post, generate appropriate hashtags for each social media platform:
        
        1. Facebook (5-8 hashtags): Generate hashtags based on the main themes and topics in the content. Use popular and relevant hashtags that match the content.
        2. Instagram (10-15 hashtags): Generate a mix of popular and niche hashtags that accurately reflect the content themes, topics, and style.
        3. TikTok (5-10 hashtags): Generate trending and viral-relevant hashtags that match the content's subject matter and appeal.
        4. Twitter/X (3-5 hashtags): Generate concise, trending hashtags relevant to the content's main points.
        5. LinkedIn (5-8 hashtags): Generate professional and industry-specific hashtags based on the content's business/professional themes.
        6. Pinterest (5-8 hashtags): Generate descriptive and discoverable hashtags that match the content's visual/conceptual themes.
        
        IMPORTANT:
        - Analyze the actual blog post content above, NOT just the topic
        - Extract key themes, topics, industries, and concepts from the content
        - Generate hashtags that accurately represent what the blog post is about
        - Make hashtags relevant to the specific content, not generic
        - Use hashtags without the # symbol (we'll add it)
        - Ensure hashtags are platform-appropriate (e.g., LinkedIn = professional, TikTok = trendy)
        - Avoid generic hashtags that don't relate to the actual content
        
        Return as JSON in this exact format:
        {
          "facebook": ["hashtag1", "hashtag2", ...],
          "instagram": ["hashtag1", "hashtag2", ...],
          "tiktok": ["hashtag1", "hashtag2", ...],
          "twitter": ["hashtag1", "hashtag2", ...],
          "linkedin": ["hashtag1", "hashtag2", ...],
          "pinterest": ["hashtag1", "hashtag2", ...]
        }
      `;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 1000,
      });

      const responseContent = response.choices[0]?.message?.content;
      if (!responseContent) throw new Error('No hashtags generated');

      // Try to extract JSON from the response
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Invalid JSON format');

      const hashtags = JSON.parse(jsonMatch[0]);
      
      // Ensure all platforms are present and validate
      const validatedHashtags = {
        facebook: Array.isArray(hashtags.facebook) ? hashtags.facebook.filter((h: any) => h && typeof h === 'string' && h.trim().length > 0) : [],
        instagram: Array.isArray(hashtags.instagram) ? hashtags.instagram.filter((h: any) => h && typeof h === 'string' && h.trim().length > 0) : [],
        tiktok: Array.isArray(hashtags.tiktok) ? hashtags.tiktok.filter((h: any) => h && typeof h === 'string' && h.trim().length > 0) : [],
        twitter: Array.isArray(hashtags.twitter) ? hashtags.twitter.filter((h: any) => h && typeof h === 'string' && h.trim().length > 0) : [],
        linkedin: Array.isArray(hashtags.linkedin) ? hashtags.linkedin.filter((h: any) => h && typeof h === 'string' && h.trim().length > 0) : [],
        pinterest: Array.isArray(hashtags.pinterest) ? hashtags.pinterest.filter((h: any) => h && typeof h === 'string' && h.trim().length > 0) : [],
      };

      this.logger.log(`Successfully generated hashtags from blog content: ${Object.values(validatedHashtags).flat().length} total hashtags`);
      
      return validatedHashtags;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI blog hashtag generation failed, using intelligent fallback: ${msg}`);
      // Fallback: extract topic from content and generate intelligent hashtags
      const topic = this.extractMainTopicFromContent(blogContent);
      return this.generateIntelligentMockHashtags(blogContent, topic, keywords);
    }
  }

  /**
   * Extract main topic from blog content
   */
  private extractMainTopicFromContent(content: string): string {
    // Try to extract from first few sentences or title
    const firstParagraph = content.split('\n\n')[0] || content.split('.')[0] || content;
    // Get first 200 characters as topic
    return firstParagraph.substring(0, 200).trim() || 'content';
  }

  /**
   * Generate intelligent mock hashtags when API is not available
   * Uses content analysis to create relevant hashtags
   */
  private generateIntelligentMockHashtags(
    blogContent: string,
    topic: string,
    keywords: string[] = [],
  ): Record<string, string[]> {
    const lowerContent = blogContent.toLowerCase();
    const lowerTopic = topic.toLowerCase();
    
    // Analyze content for key themes
    let contentThemes: string[] = [];
    
    // Extract meaningful words from content (3+ characters, exclude common words)
    const commonWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'way', 'use', 'did', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'way', 'use']);
    
    const words = blogContent.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !commonWords.has(w))
      .slice(0, 20);
    
    // Generate hashtags based on content analysis
    if (lowerContent.includes('car') || lowerContent.includes('showroom') || lowerContent.includes('automotive') || lowerContent.includes('vehicle')) {
      contentThemes = ['carshowroom', 'automotive', 'cardealer', 'luxurycars', 'vehicles', 'automotiveindustry', 'carsales'];
    } else if (lowerContent.includes('marketing') || lowerContent.includes('advert')) {
      contentThemes = ['marketing', 'digitalmarketing', 'business', 'entrepreneurship', 'growth', 'strategy', 'branding'];
    } else if (lowerContent.includes('business') || lowerContent.includes('company')) {
      contentThemes = ['business', 'entrepreneurship', 'startup', 'success', 'leadership', 'innovation'];
    } else {
      // Use extracted words as themes
      contentThemes = [...new Set(words.slice(0, 5))];
    }
    
    // Combine with keywords
    const allThemes = [...new Set([...contentThemes, ...keywords.map(k => k.toLowerCase().replace(/\s+/g, ''))])].slice(0, 8);

    return {
      facebook: allThemes.slice(0, 6),
      instagram: allThemes.slice(0, 8),
      tiktok: allThemes.slice(0, 6),
      twitter: allThemes.slice(0, 4),
      linkedin: allThemes.slice(0, 6),
      pinterest: allThemes.slice(0, 6),
    };
  }

  /**
   * Format hashtags section for blog post
   */
  private formatHashtagsSection(hashtags: Record<string, string[]>): string {
    let section = '\n\n---\n\n## Social Media Hashtags\n\n';
    
    const platformNames: Record<string, string> = {
      facebook: 'Facebook',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      twitter: 'Twitter/X',
      linkedin: 'LinkedIn',
      pinterest: 'Pinterest',
    };

    let hasAnyTags = false;
    for (const [platform, tags] of Object.entries(hashtags)) {
      if (tags && Array.isArray(tags) && tags.length > 0) {
        const validTags = tags
          .filter(tag => tag && typeof tag === 'string' && tag.trim().length > 0)
          .map(tag => `#${tag.trim().replace(/^#/, '')}`)
          .filter(t => t.length > 1);
        
        if (validTags.length > 0) {
          hasAnyTags = true;
          const platformName = platformNames[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
          const formattedTags = validTags.join(' ');
          section += `**${platformName}:** ${formattedTags}\n\n`;
        }
      }
    }

    // Return empty string if no tags were found
    if (!hasAnyTags) {
      this.logger.warn('No valid hashtags generated, returning empty hashtag section');
      return '';
    }

    return section.trim();
  }


  /**
   * Generate ad copy
   */
  async generateAdCopy(
    product: string,
    targetAudience: string,
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    const prompt = `Create compelling ad copy for ${product} targeting ${targetAudience}`;
    return this.generateContent('ad_copy', prompt, { ...options, style: 'persuasive' });
  }

  /**
   * Generate email campaign content
   */
  async generateEmailContent(
    purpose: string,
    recipient: string,
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    const prompt = `Write an email for ${purpose} to ${recipient}`;
    return this.generateContent('email', prompt, options);
  }

  /**
   * Generate product description
   */
  async generateProductDescription(
    productName: string,
    features: string[],
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    const prompt = `Create a product description for ${productName} with features: ${features.join(', ')}`;
    return this.generateContent('product_description', prompt, options);
  }

  /**
   * Generate video script
   */
  async generateVideoScript(
    topic: string,
    duration: number,
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    const prompt = `Create a ${duration}-minute video script about: ${topic}`;
    return this.generateContent('video_script', prompt, { ...options, style: 'entertaining' });
  }

  /**
   * Generate social media captions
   */
  async generateCaptions(
    platform: string,
    content: string,
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    const prompt = `Create engaging ${platform} captions for: ${content}`;
    return this.generateContent('caption', prompt, options);
  }

  /**
   * Generate headlines
   */
  async generateHeadlines(
    topic: string,
    count: number = 5,
    options: ContentGenerationOptions = {},
  ): Promise<ContentResult> {
    const prompt = `Generate ${count} compelling headlines for: ${topic}`;
    return this.generateContent('headline', prompt, { ...options, length: 'short' });
  }

  /**
   * Get system prompt based on content type
   */
  private getSystemPrompt(type: string, options: ContentGenerationOptions): string {
    // Get language name from code
    const languageMap: Record<string, string> = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'nl': 'Dutch',
      'ru': 'Russian',
      'ja': 'Japanese',
      'zh': 'Chinese',
      'ko': 'Korean',
      'ar': 'Arabic',
    };
    
    const language = options.language || 'en';
    const languageName = languageMap[language] || language;
    const basePrompts = {
      blog: 'You are a professional content writer. Write engaging, informative blog posts that provide value to readers.',
      ad_copy: 'You are a marketing copywriter. Create persuasive, compelling ad copy that drives action.',
      email: 'You are an email marketing specialist. Write clear, engaging emails that achieve their purpose.',
      product_description: 'You are a product marketing expert. Write compelling product descriptions that highlight benefits.',
      video_script: 'You are a video content creator. Write engaging scripts that keep viewers watching.',
      caption: 'You are a social media expert. Write engaging captions that drive engagement.',
      headline: 'You are a headline specialist. Write attention-grabbing headlines that increase click-through rates.',
    };

  const key = type as keyof typeof basePrompts;
  let prompt = basePrompts[key] || 'You are a professional content creator.';
    
    if (options.tone) {
      prompt += ` Use a ${options.tone} tone.`;
    }
    
    if (options.style) {
      prompt += ` Write in a ${options.style} style.`;
    }
    
    if (options.targetAudience) {
      prompt += ` Target audience: ${options.targetAudience}.`;
    }

    // Add language instruction if not English
    if (language && language !== 'en') {
      prompt += ` CRITICAL LANGUAGE REQUIREMENT: Write ALL content EXCLUSIVELY in ${languageName} (${language}). Every single word, sentence, paragraph, title, heading, and any text must be in ${languageName}. Do NOT use English or mix languages. The entire content must be written completely in ${languageName}.`;
    }

    return prompt;
  }

  /**
   * Get max tokens based on content length
   */
  private getMaxTokens(length: string): number {
    const tokenLimits: Record<string, number> = {
      short: 500,
      medium: 1500,
      long: 4000,
    };
    const lenKey = length as string;
    return tokenLimits[lenKey] || 1500;
  }

  /**
   * Calculate cost based on tokens used and model
   */
  private calculateCost(tokens: number, model: string): number {
    // Pricing per 1K tokens (as of 2024)
    const pricing: Record<string, number> = {
      'gpt-4': 0.03,
      'gpt-3.5-turbo': 0.002,
    };
    const pricePer1K = pricing[model as string] || 0.002;
    return (tokens / 1000) * pricePer1K;
  }

  /**
   * Generate mock content when API is not available
   */
  private async generateMockContent(
    type: string,
    prompt: string,
    options: ContentGenerationOptions,
  ): Promise<ContentResult> {
    const mockContent = {
      blog: `This is a mock blog post about: ${prompt}. In a real implementation, this would be generated by OpenAI's GPT model with proper research, structure, and engaging content tailored to your audience.`,
      ad_copy: `🔥 Don't miss out! ${prompt} - Limited time offer! Get yours now and experience the difference. Click here to learn more!`,
      email: `Subject: ${prompt}\n\nDear [Name],\n\nThis is a mock email about: ${prompt}. In production, this would be a personalized, engaging email with proper formatting and call-to-action.`,
      product_description: `${prompt} - The perfect solution for your needs. Features include advanced technology, user-friendly design, and exceptional quality. Order now and experience the difference!`,
      video_script: `[SCENE 1]\nWelcome to this video about ${prompt}.\n\n[SCENE 2]\nLet me explain why this matters...\n\n[SCENE 3]\nIn conclusion...`,
      caption: `Check out this amazing ${prompt}! 🚀 #amazing #content #viral`,
      headline: `5 Ways ${prompt} Will Change Your Life Forever`,
    };

    const mockKey = type as keyof typeof mockContent;
    let content = mockContent[mockKey] || `Mock content for: ${prompt}`;
    
    // For blog posts, append mock hashtags based on content
    if (type === 'blog') {
      const topic = this.extractMainTopicFromContent(content);
      const hashtags = this.generateIntelligentMockHashtags(content, topic, options.keywords || []);
      const hashtagsSection = this.formatHashtagsSection(hashtags);
      if (hashtagsSection && hashtagsSection.trim().length > 0) {
        content = `${content}\n\n${hashtagsSection}`;
      }
    }

    return {
      content,
      tokensUsed: 150,
      cost: 0.001,
      metadata: {
        model: 'mock',
        note: 'This is mock content. Real content will be generated when API keys are provided.',
      },
    };
  }
}