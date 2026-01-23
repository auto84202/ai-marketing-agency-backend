import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';

export interface ImageGenerationOptions {
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number; // Number of images to generate (1-10)
  response_format?: 'url' | 'b64_json';
  user?: string;
}

export interface ImageGenerationResult {
  images: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  tokensUsed: number;
  cost: number;
  metadata: {
    model: string;
    size: string;
    quality: string;
    style: string;
    prompt: string;
    generatedAt: Date;
    count?: number;
    requestedCount?: number;
  };
}

export interface ImageVariationOptions {
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  n?: number;
  response_format?: 'url' | 'b64_json';
  user?: string;
}

export interface ImageEditOptions {
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  n?: number;
  response_format?: 'url' | 'b64_json';
  user?: string;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);
  private openai?: OpenAI;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.initializeOpenAI();
  }

  /**
   * Initialize OpenAI client
   */
  private initializeOpenAI() {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.isConfigured = true;
      this.logger.log('OpenAI client initialized for image generation');
    } else {
      this.logger.warn('OpenAI API key not found. Image generation will use mock responses.');
    }
  }

  /**
   * Generate images using DALL·E
   */
  async generateImages(
    prompt: string,
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult> {
    try {
      this.logger.log(`Generating images with prompt: ${prompt.substring(0, 50)}...`);

      if (!this.isConfigured || !this.openai) {
        this.logger.warn('OpenAI not configured - returning mock images. Set OPENAI_API_KEY in environment variables to generate real images.');
        return this.generateMockImages(prompt, options);
      }

      const {
        size = '1024x1024',
        quality = 'standard',
        style = 'vivid',
        n = 1,
        response_format = 'url',
        user,
      } = options;

      // DALL-E 3 only supports n=1 per request, so we need to make multiple requests
      const requestedCount = Math.min(Math.max(n, 1), 10); // Limit to 1-10 images
      const images: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> = [];
      let totalTokensUsed = 0;
      let totalCost = 0;

      // Generate images one by one (DALL-E 3 limitation)
      for (let i = 0; i < requestedCount; i++) {
        try {
          this.logger.log(`Generating image ${i + 1} of ${requestedCount}...`);
          
          // Enhance prompt for better accuracy and specificity
          const enhancedPrompt = this.enhanceImagePrompt(prompt);
          
          const response = await this.openai.images.generate({
            model: 'dall-e-3',
            prompt: enhancedPrompt,
            size: size as any,
            quality: quality as any,
            style: style as any,
            n: 1, // DALL-E 3 only supports n=1 per request
            response_format: response_format as any,
            user,
          });

          if (response.data && response.data.length > 0) {
            const image = response.data[0];
            images.push({
              url: image.url,
              b64_json: (image as any).b64_json,
              revised_prompt: (image as any).revised_prompt,
            });

            // Calculate cost per image
            const tokensUsed = this.estimateTokens(prompt);
            const cost = this.calculateImageCost(size, quality, 1);
            totalTokensUsed += tokensUsed;
            totalCost += cost;

            // Add a small delay between requests to avoid rate limiting
            if (i < requestedCount - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
            }
          }
        } catch (error) {
          this.logger.error(`Failed to generate image ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue with other images even if one fails
        }
      }

      const tokensUsed = totalTokensUsed;
      const cost = totalCost;

      return {
        images: images,
        tokensUsed,
        cost,
        metadata: {
          model: 'dall-e-3',
          size,
          quality,
          style,
          prompt,
          generatedAt: new Date(),
          count: images.length,
          requestedCount,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      this.logger.error(`Failed to generate images: ${msg}`, stack);
      
      // Check if it's an API key issue
      if (msg.includes('API key') || msg.includes('authentication') || msg.includes('401') || msg.includes('403')) {
        this.logger.error('OpenAI API authentication failed. Please check your OPENAI_API_KEY environment variable.');
      }
      
      // Fallback to mock images if API fails
      this.logger.warn('Falling back to mock images due to API error');
      return this.generateMockImages(prompt, options);
    }
  }

  /**
   * Create image variations
   */
  async createImageVariations(
    imageUrl: string,
    options: ImageVariationOptions = {},
  ): Promise<ImageGenerationResult> {
    try {
      this.logger.log('Creating image variations');

      if (!this.isConfigured || !this.openai) {
        return this.generateMockVariations(imageUrl, options);
      }

      const {
        size = '1024x1024',
        n = 1,
        response_format = 'url',
        user,
      } = options;

      const response = await this.openai.images.createVariation({
        image: imageUrl as any, // Type assertion for URL string
        size: size as any,
        n: Math.min(n, 4), // DALL-E 2 supports up to 4 variations
        response_format: response_format as any,
        user,
      });

      const images = response.data?.map(img => ({
        url: img.url,
        b64_json: (img as any).b64_json,
      })) || [];

      const tokensUsed = 0; // Variations don't use prompt tokens
      const cost = this.calculateVariationCost(size, n);

      return {
        images,
        tokensUsed,
        cost,
        metadata: {
          model: 'dall-e-2',
          size,
          quality: 'standard',
          style: 'natural',
          prompt: 'Image variation',
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create image variations: ${msg}`);
      return this.generateMockVariations(imageUrl, options);
    }
  }

  /**
   * Edit images using mask
   */
  async editImage(
    imageUrl: string,
    maskUrl: string,
    prompt: string,
    options: ImageEditOptions = {},
  ): Promise<ImageGenerationResult> {
    try {
      this.logger.log(`Editing image with prompt: ${prompt.substring(0, 50)}...`);

      if (!this.isConfigured || !this.openai) {
        return this.generateMockEdit(imageUrl, prompt, options);
      }

      const {
        size = '1024x1024',
        n = 1,
        response_format = 'url',
        user,
      } = options;

      const response = await this.openai.images.edit({
        image: imageUrl as any, // Type assertion for URL string
        mask: maskUrl as any, // Type assertion for URL string
        prompt,
        size: size as any,
        n: Math.min(n, 4),
        response_format: response_format as any,
        user,
      });

      const images = response.data?.map(img => ({
        url: img.url,
        b64_json: (img as any).b64_json,
      })) || [];

      const tokensUsed = this.estimateTokens(prompt);
      const cost = this.calculateEditCost(size, n);

      return {
        images,
        tokensUsed,
        cost,
        metadata: {
          model: 'dall-e-2',
          size,
          quality: 'standard',
          style: 'natural',
          prompt,
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to edit image: ${msg}`);
      return this.generateMockEdit(imageUrl, prompt, options);
    }
  }

  /**
   * Generate images for specific marketing use cases
   */
  async generateMarketingImages(
    useCase: 'social_media' | 'ad_banner' | 'product_mockup' | 'blog_header' | 'email_banner',
    description: string,
    brandStyle?: string,
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult> {
    const prompts = {
      social_media: `Create an engaging social media post image for: ${description}. ${brandStyle ? `Brand style: ${brandStyle}` : ''} High quality, modern design, eye-catching colors, suitable for Instagram/Facebook.`,
      ad_banner: `Design a professional advertisement banner for: ${description}. ${brandStyle ? `Brand style: ${brandStyle}` : ''} Clean layout, compelling visuals, call-to-action ready, banner format.`,
      product_mockup: `Create a product mockup image for: ${description}. ${brandStyle ? `Brand style: ${brandStyle}` : ''} Professional product photography style, clean background, high quality.`,
      blog_header: `Design a blog header image for: ${description}. ${brandStyle ? `Brand style: ${brandStyle}` : ''} Modern, clean design, suitable for blog post header, professional look.`,
      email_banner: `Create an email banner image for: ${description}. ${brandStyle ? `Brand style: ${brandStyle}` : ''} Email-friendly design, clear and readable, professional appearance.`,
    };

    const prompt = prompts[useCase];
    return this.generateImages(prompt, options);
  }

  /**
   * Generate images with specific styles
   */
  async generateStyledImages(
    prompt: string,
    style: 'minimalist' | 'vintage' | 'modern' | 'corporate' | 'creative' | 'photorealistic',
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult> {
    const stylePrompts = {
      minimalist: `${prompt}. Minimalist design, clean lines, simple composition, muted colors.`,
      vintage: `${prompt}. Vintage style, retro aesthetic, aged look, classic design elements.`,
      modern: `${prompt}. Modern design, contemporary style, sleek and clean, current trends.`,
      corporate: `${prompt}. Corporate style, professional appearance, business-appropriate, clean and formal.`,
      creative: `${prompt}. Creative and artistic style, unique composition, bold colors, innovative design.`,
      photorealistic: `${prompt}. Photorealistic style, high detail, realistic lighting, professional photography quality.`,
    };

    const styledPrompt = stylePrompts[style];
    return this.generateImages(styledPrompt, options);
  }

  /**
   * Enhance image prompt for better accuracy and specificity
   * This helps DALL-E generate more accurate images based on the topic
   */
  private enhanceImagePrompt(prompt: string): string {
    // Convert to lowercase for easier matching
    const lowerPrompt = prompt.toLowerCase().trim();
    
    // Check for specific business/topic types and enhance the prompt
    if (lowerPrompt.includes('car') && lowerPrompt.includes('showroom') || 
        lowerPrompt.includes('showroom') && (lowerPrompt.includes('car') || lowerPrompt.includes('automotive') || lowerPrompt.includes('vehicle')) ||
        lowerPrompt.includes('automotive') && lowerPrompt.includes('showroom') ||
        lowerPrompt.includes('car dealership')) {
      // For car showroom - be VERY specific to avoid generating people or animals
      return `Professional automotive car showroom interior showcasing luxury vehicles. Empty showroom floor with multiple cars on display, polished concrete or tile floors, bright modern lighting, glass windows, car showroom environment. Absolutely no people, no humans, no animals, no deer, no dogs, no cats, no living creatures. Only cars, vehicles, and showroom interior architecture. Professional automotive photography, photorealistic, high quality, commercial car dealership style.`;
    }
    
    if ((lowerPrompt.includes('car') || lowerPrompt.includes('automotive') || lowerPrompt.includes('vehicle')) && !lowerPrompt.includes('showroom')) {
      // For general car topics - focus on vehicles only
      return `Professional automotive photography of cars and vehicles. Modern cars, luxury vehicles, automotive design. No people, no animals, no living creatures. Only vehicles and automotive elements. High quality, photorealistic style.`;
    }
    
    if (lowerPrompt.includes('restaurant') || lowerPrompt.includes('food') || lowerPrompt.includes('cafe') || lowerPrompt.includes('dining')) {
      return `Professional interior/exterior of a restaurant or dining establishment. Beautiful food presentation, clean environment, professional photography. ${prompt}`;
    }
    
    if (lowerPrompt.includes('retail') || lowerPrompt.includes('store') || lowerPrompt.includes('shop') || lowerPrompt.includes('boutique')) {
      return `Modern retail store interior or exterior. Clean, organized product displays, professional lighting, modern store design. ${prompt}`;
    }
    
    if (lowerPrompt.includes('office') || lowerPrompt.includes('workspace') || lowerPrompt.includes('business')) {
      return `Professional modern office or workspace interior. Clean, organized, professional environment, business setting. ${prompt}`;
    }
    
    if (lowerPrompt.includes('hotel') || lowerPrompt.includes('hospitality') || lowerPrompt.includes('resort')) {
      return `Luxury hotel or hospitality establishment interior or exterior. Elegant design, professional photography, hospitality environment. ${prompt}`;
    }
    
    // Generic enhancement for better specificity
    // Add instructions to avoid common mistakes
    const enhanced = `${prompt}. Professional, high-quality, accurate representation. Clear and specific subject matter with no ambiguity. Photorealistic style with proper lighting and composition.`;
    
    return enhanced;
  }

  /**
   * Calculate cost for image generation
   */
  private calculateImageCost(size: string, quality: string, n: number): number {
    // DALL-E 3 pricing (as of 2024)
    const pricing: Record<string, number> = {
      '1024x1024': quality === 'hd' ? 0.08 : 0.04,
      '1792x1024': quality === 'hd' ? 0.12 : 0.08,
      '1024x1792': quality === 'hd' ? 0.12 : 0.08,
    };

    const pricePerImage = pricing[size] || 0.04;
    return pricePerImage * n;
  }

  /**
   * Calculate cost for image variations
   */
  private calculateVariationCost(size: string, n: number): number {
    // DALL-E 2 pricing for variations
    const pricing: Record<string, number> = {
      '1024x1024': 0.02,
      '512x512': 0.018,
      '256x256': 0.016,
    };

    const pricePerImage = pricing[size] || 0.02;
    return pricePerImage * n;
  }

  /**
   * Calculate cost for image editing
   */
  private calculateEditCost(size: string, n: number): number {
    // DALL-E 2 pricing for edits
    const pricing: Record<string, number> = {
      '1024x1024': 0.02,
      '512x512': 0.018,
      '256x256': 0.016,
    };

    const pricePerImage = pricing[size] || 0.02;
    return pricePerImage * n;
  }

  /**
   * Estimate tokens for prompt
   */
  private estimateTokens(prompt: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(prompt.length / 4);
  }

  /**
   * Generate mock images when API is not available
   */
  private generateMockImages(prompt: string, options: ImageGenerationOptions): ImageGenerationResult {
    const { size = '1024x1024', quality = 'standard', style = 'vivid', n = 1 } = options;
    
    const mockImages = Array.from({ length: n }, (_, i) => ({
      url: `https://picsum.photos/1024/1024?random=${Date.now() + i}`,
      revised_prompt: `Mock image ${i + 1} for: ${prompt}`,
    }));

    return {
      images: mockImages,
      tokensUsed: this.estimateTokens(prompt),
      cost: this.calculateImageCost(size, quality, n),
      metadata: {
        model: 'dall-e-3-mock',
        size,
        quality,
        style,
        prompt,
        generatedAt: new Date(),
      },
    };
  }

  /**
   * Generate mock variations
   */
  private generateMockVariations(imageUrl: string, options: ImageVariationOptions): ImageGenerationResult {
    const { size = '1024x1024', n = 1 } = options;
    
    const mockImages = Array.from({ length: n }, (_, i) => ({
      url: `https://picsum.photos/1024/1024?random=${Date.now() + i + 100}`,
    }));

    return {
      images: mockImages,
      tokensUsed: 0,
      cost: this.calculateVariationCost(size, n),
      metadata: {
        model: 'dall-e-2-mock',
        size,
        quality: 'standard',
        style: 'natural',
        prompt: 'Image variation',
        generatedAt: new Date(),
      },
    };
  }

  /**
   * Generate mock edit
   */
  private generateMockEdit(imageUrl: string, prompt: string, options: ImageEditOptions): ImageGenerationResult {
    const { size = '1024x1024', n = 1 } = options;
    
    const mockImages = Array.from({ length: n }, (_, i) => ({
      url: `https://picsum.photos/1024/1024?random=${Date.now() + i + 200}`,
    }));

    return {
      images: mockImages,
      tokensUsed: this.estimateTokens(prompt),
      cost: this.calculateEditCost(size, n),
      metadata: {
        model: 'dall-e-2-mock',
        size,
        quality: 'standard',
        style: 'natural',
        prompt,
        generatedAt: new Date(),
      },
    };
  }
}
