import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIService } from '../openai/openai.service';

export interface ImageGenerationOptions {
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
}

export interface ImageGenerationResult {
  imageUrl: string;
  revisedPrompt?: string;
  tokensUsed: number;
  cost: number;
  metadata: any;
}

@Injectable()
export class DalleService {
  private readonly logger = new Logger(DalleService.name);

  constructor(
    private configService: ConfigService,
    private openaiService: OpenAIService,
  ) {}

  /**
   * Generate images using DALL-E
   * TODO: Implement when OpenAI API key is provided
   */
  async generateImages(
    prompt: string,
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult[]> {
    try {
      this.logger.log(`Generating images with prompt: ${prompt.substring(0, 50)}...`);

      // Use the OpenAI service to generate images
      const images = await this.openaiService.generateImage(prompt, options);

      return images.map(image => ({
        imageUrl: image.imageUrl,
        revisedPrompt: image.revisedPrompt,
        tokensUsed: image.tokensUsed,
        cost: image.cost,
        metadata: {
          prompt,
          options,
          generatedAt: new Date(),
          model: 'dall-e-3',
        },
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate images: ${msg}`);
      throw error;
    }
  }

  /**
   * Generate marketing-specific images
   */
  async generateMarketingImages(
    productName: string,
    style: 'modern' | 'classic' | 'minimalist' | 'vibrant' = 'modern',
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult[]> {
    const stylePrompts = {
      modern: `Modern, sleek, professional marketing image for ${productName}, clean design, contemporary style, high-quality product photography`,
      classic: `Classic, elegant marketing image for ${productName}, timeless design, sophisticated style, premium product photography`,
      minimalist: `Minimalist marketing image for ${productName}, clean lines, simple composition, white background, modern typography`,
      vibrant: `Vibrant, colorful marketing image for ${productName}, bold colors, energetic style, eye-catching design`,
    };

    const prompt = stylePrompts[style];
    return this.generateImages(prompt, options);
  }

  /**
   * Generate social media images
   */
  async generateSocialMediaImages(
    platform: 'instagram' | 'twitter' | 'linkedin',
    content: string,
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult[]> {
    const platformPrompts = {
      instagram: `Instagram post image: ${content}, square format, vibrant colors, trendy design, social media optimized`,
      twitter: `Twitter post image: ${content}, horizontal format, clean design, social media optimized`,
      linkedin: `LinkedIn post image: ${content}, professional design, business-oriented, clean and modern`,
    };

    const prompt = platformPrompts[platform];
    
    // Set appropriate size based on platform
    const platformSizes = {
      instagram: '1024x1024',
      twitter: '1200x675',
      linkedin: '1200x627',
    };

    const finalOptions = {
      ...options,
      size: (options.size || platformSizes[platform]) as any,
    };

    return this.generateImages(prompt, finalOptions);
  }

  /**
   * Generate product mockups
   */
  async generateProductMockups(
    productDescription: string,
    mockupType: 'lifestyle' | 'studio' | 'packaging' = 'lifestyle',
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult[]> {
    const mockupPrompts = {
      lifestyle: `Lifestyle product mockup: ${productDescription}, natural setting, real-world usage, high-quality photography`,
      studio: `Studio product mockup: ${productDescription}, clean white background, professional lighting, product photography`,
      packaging: `Product packaging mockup: ${productDescription}, branded packaging design, retail display, marketing materials`,
    };

    const prompt = mockupPrompts[mockupType];
    return this.generateImages(prompt, options);
  }

  /**
   * Generate ad banner images
   */
  async generateAdBanners(
    adCopy: string,
    bannerSize: '728x90' | '300x250' | '320x50' | '160x600' | 'custom',
    customSize?: string,
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult[]> {
    let size = '1024x1024';
    
    if (bannerSize === 'custom' && customSize) {
      size = customSize;
    } else if (bannerSize !== 'custom') {
      size = bannerSize;
    }

    const prompt = `Advertisement banner: ${adCopy}, banner format, eye-catching design, call-to-action elements, marketing optimized, ${size} dimensions`;

    const finalOptions = {
      ...options,
      size: size as any,
    };

    return this.generateImages(prompt, finalOptions);
  }

  /**
   * Generate logo designs
   */
  async generateLogos(
    companyName: string,
    industry: string,
    style: 'minimalist' | 'modern' | 'classic' | 'creative' = 'modern',
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult[]> {
    const stylePrompts = {
      minimalist: `Minimalist logo design for ${companyName}, ${industry} company, clean lines, simple typography, monochrome`,
      modern: `Modern logo design for ${companyName}, ${industry} company, contemporary style, sleek typography, professional`,
      classic: `Classic logo design for ${companyName}, ${industry} company, timeless design, traditional typography, elegant`,
      creative: `Creative logo design for ${companyName}, ${industry} company, unique concept, innovative design, memorable`,
    };

    const prompt = stylePrompts[style];
    
    // Logos are typically square
    const finalOptions = {
      ...options,
      size: options.size || '1024x1024',
    };

    return this.generateImages(prompt, finalOptions);
  }

  /**
   * Generate mock images for testing (when API is not available)
   */
  private generateMockImages(prompt: string, options: ImageGenerationOptions): ImageGenerationResult[] {
    const count = options.n || 1;
    const images = [];

    for (let i = 0; i < count; i++) {
      images.push({
        imageUrl: `https://via.placeholder.com/${options.size || '1024x1024'}/0066CC/FFFFFF?text=Mock+Image+${i + 1}`,
        revisedPrompt: `Revised: ${prompt}`,
        tokensUsed: 0,
        cost: 0.02,
        metadata: {
          prompt,
          options,
          generatedAt: new Date(),
          model: 'mock-dall-e',
          note: 'This is a mock image. Real images will be generated when OpenAI API key is provided.',
        },
      });
    }

    return images;
  }
}