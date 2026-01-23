import { Controller, Post, Get, Body, Param, Query, UseGuards, Request, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ImageGenerationService } from './image-generation.service';
import { AuthGuard } from '../../auth/auth.guard';
import { 
  GenerateImageDto, 
  GenerateMarketingImageDto, 
  GenerateStyledImageDto,
  CreateImageVariationDto,
  EditImageDto 
} from './dto/generate-image.dto';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    role: string;
  };
}

@Controller('ai/images')
@UseGuards(AuthGuard)
export class ImageGenerationController {
  constructor(private readonly imageGenerationService: ImageGenerationService) {}

  /**
   * Generate images using DALL·E
   */
  @Post('generate')
  async generateImages(
    @Request() req: AuthenticatedRequest,
    @Body() body: GenerateImageDto
  ) {
    return this.imageGenerationService.generateImages(body.prompt, {
      size: body.size,
      quality: body.quality,
      style: body.style,
      n: body.n,
      user: req.user.id,
    });
  }

  /**
   * Generate marketing-specific images
   */
  @Post('generate/marketing')
  async generateMarketingImages(
    @Request() req: AuthenticatedRequest,
    @Body() body: GenerateMarketingImageDto
  ) {
    return this.imageGenerationService.generateMarketingImages(
      body.useCase,
      body.description,
      body.brandStyle,
      {
        size: body.size,
        quality: body.quality,
        style: body.style,
        n: body.n,
        user: req.user.id,
      }
    );
  }

  /**
   * Generate images with specific styles
   */
  @Post('generate/styled')
  async generateStyledImages(
    @Request() req: AuthenticatedRequest,
    @Body() body: GenerateStyledImageDto
  ) {
    return this.imageGenerationService.generateStyledImages(
      body.prompt,
      body.style,
      {
        size: body.size,
        quality: body.quality,
        style: body.styleType,
        n: body.n,
        user: req.user.id,
      }
    );
  }

  /**
   * Create image variations
   */
  @Post('variations')
  async createImageVariations(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateImageVariationDto
  ) {
    return this.imageGenerationService.createImageVariations(body.imageUrl, {
      size: body.size,
      n: body.n,
      user: req.user.id,
    });
  }

  /**
   * Edit images using mask
   */
  @Post('edit')
  async editImage(
    @Request() req: AuthenticatedRequest,
    @Body() body: EditImageDto
  ) {
    return this.imageGenerationService.editImage(
      body.imageUrl,
      body.maskUrl,
      body.prompt,
      {
        size: body.size,
        n: body.n,
        user: req.user.id,
      }
    );
  }

  /**
   * Get image generation templates/presets
   */
  @Get('templates')
  async getImageTemplates() {
    return {
      success: true,
      data: {
        useCases: [
          {
            id: 'social_media',
            name: 'Social Media Post',
            description: 'Engaging images for Instagram, Facebook, Twitter',
            recommendedSize: '1024x1024',
            examplePrompt: 'Create an engaging social media post about [topic] with modern design and vibrant colors',
          },
          {
            id: 'ad_banner',
            name: 'Advertisement Banner',
            description: 'Professional banners for online advertising',
            recommendedSize: '1792x1024',
            examplePrompt: 'Design a professional ad banner for [product] with clean layout and compelling visuals',
          },
          {
            id: 'product_mockup',
            name: 'Product Mockup',
            description: 'High-quality product presentation images',
            recommendedSize: '1024x1024',
            examplePrompt: 'Create a product mockup for [product] with professional photography style',
          },
          {
            id: 'blog_header',
            name: 'Blog Header',
            description: 'Eye-catching headers for blog posts',
            recommendedSize: '1792x1024',
            examplePrompt: 'Design a blog header image for [topic] with modern, clean design',
          },
          {
            id: 'email_banner',
            name: 'Email Banner',
            description: 'Professional banners for email campaigns',
            recommendedSize: '1024x1024',
            examplePrompt: 'Create an email banner for [campaign] with clear, readable design',
          },
        ],
        styles: [
          {
            id: 'minimalist',
            name: 'Minimalist',
            description: 'Clean, simple design with minimal elements',
            examplePrompt: 'Minimalist design, clean lines, simple composition, muted colors',
          },
          {
            id: 'vintage',
            name: 'Vintage',
            description: 'Retro aesthetic with classic design elements',
            examplePrompt: 'Vintage style, retro aesthetic, aged look, classic design elements',
          },
          {
            id: 'modern',
            name: 'Modern',
            description: 'Contemporary style with current trends',
            examplePrompt: 'Modern design, contemporary style, sleek and clean, current trends',
          },
          {
            id: 'corporate',
            name: 'Corporate',
            description: 'Professional, business-appropriate design',
            examplePrompt: 'Corporate style, professional appearance, business-appropriate, clean and formal',
          },
          {
            id: 'creative',
            name: 'Creative',
            description: 'Artistic and innovative design approach',
            examplePrompt: 'Creative and artistic style, unique composition, bold colors, innovative design',
          },
          {
            id: 'photorealistic',
            name: 'Photorealistic',
            description: 'High-detail, realistic photography style',
            examplePrompt: 'Photorealistic style, high detail, realistic lighting, professional photography quality',
          },
        ],
        sizes: [
          { id: '256x256', name: 'Small (256x256)', description: 'Thumbnails, icons' },
          { id: '512x512', name: 'Medium (512x512)', description: 'Profile pictures, small banners' },
          { id: '1024x1024', name: 'Large (1024x1024)', description: 'Social media posts, general use' },
          { id: '1792x1024', name: 'Landscape (1792x1024)', description: 'Banners, headers, wide formats' },
          { id: '1024x1792', name: 'Portrait (1024x1792)', description: 'Mobile banners, tall formats' },
        ],
      },
    };
  }

  /**
   * Get image generation pricing information
   */
  @Get('pricing')
  async getImagePricing() {
    return {
      success: true,
      data: {
        dallE3: {
          '1024x1024': {
            standard: 0.04,
            hd: 0.08,
          },
          '1792x1024': {
            standard: 0.08,
            hd: 0.12,
          },
          '1024x1792': {
            standard: 0.08,
            hd: 0.12,
          },
        },
        dallE2: {
          variations: {
            '1024x1024': 0.02,
            '512x512': 0.018,
            '256x256': 0.016,
          },
          edits: {
            '1024x1024': 0.02,
            '512x512': 0.018,
            '256x256': 0.016,
          },
        },
        currency: 'USD',
        note: 'Prices are per image generated',
      },
    };
  }

}
