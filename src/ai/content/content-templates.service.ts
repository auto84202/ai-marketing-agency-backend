import { Injectable, Logger } from '@nestjs/common';

export interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  type: string;
  industry?: string;
  template: {
    prompt: string;
    variables: string[];
    systemPrompt?: string;
    options?: {
      tone?: string;
      length?: string;
      style?: string;
    };
  };
  examples?: string[];
  tags: string[];
}

export interface IndustryPreset {
  id: string;
  name: string;
  description: string;
  templates: string[];
  defaultOptions: {
    tone: string;
    style: string;
    targetAudience?: string;
  };
}

@Injectable()
export class ContentTemplatesService {
  private readonly logger = new Logger(ContentTemplatesService.name);

  private readonly templates: ContentTemplate[] = [
    // Blog Templates
    {
      id: 'blog-how-to',
      name: 'How-To Guide',
      description: 'Step-by-step instructional blog post',
      type: 'blog',
      industry: 'general',
      template: {
        prompt: 'Write a comprehensive how-to guide about {topic}. Include step-by-step instructions, tips, and best practices.',
        variables: ['topic'],
        systemPrompt: 'You are an expert content writer creating detailed how-to guides. Focus on clarity, actionable steps, and practical value.',
        options: {
          tone: 'professional',
          length: 'long',
          style: 'educational',
        },
      },
      examples: ['How to Start a Digital Marketing Campaign', 'How to Optimize Your Website for SEO'],
      tags: ['tutorial', 'guide', 'educational'],
    },
    {
      id: 'blog-list-post',
      name: 'List Post',
      description: 'Numbered or bulleted list article',
      type: 'blog',
      industry: 'general',
      template: {
        prompt: 'Create a list post about {topic} with {count} items. Each item should be detailed and actionable.',
        variables: ['topic', 'count'],
        systemPrompt: 'You are a content writer creating engaging list posts. Make each point valuable and easy to scan.',
        options: {
          tone: 'friendly',
          length: 'medium',
          style: 'informative',
        },
      },
      examples: ['10 Ways to Improve Your Social Media Presence', '5 Essential Tools for Content Creators'],
      tags: ['list', 'tips', 'actionable'],
    },
    {
      id: 'blog-case-study',
      name: 'Case Study',
      description: 'Detailed analysis of a real-world example',
      type: 'blog',
      industry: 'general',
      template: {
        prompt: 'Write a detailed case study about {company} and their {challenge}. Include the problem, solution, and results.',
        variables: ['company', 'challenge'],
        systemPrompt: 'You are a business analyst writing compelling case studies. Focus on data, results, and lessons learned.',
        options: {
          tone: 'professional',
          length: 'long',
          style: 'informative',
        },
      },
      examples: ['How Company X Increased Sales by 300%', 'Case Study: Digital Transformation Success'],
      tags: ['case-study', 'business', 'results'],
    },

    // Ad Copy Templates
    {
      id: 'ad-urgency',
      name: 'Urgency Ad Copy',
      description: 'Creates urgency and drives immediate action',
      type: 'ad_copy',
      industry: 'ecommerce',
      template: {
        prompt: 'Create urgent ad copy for {product} that creates scarcity and drives immediate action. Target audience: {audience}',
        variables: ['product', 'audience'],
        systemPrompt: 'You are a conversion-focused copywriter. Use urgency, scarcity, and emotional triggers to drive action.',
        options: {
          tone: 'persuasive',
          length: 'short',
          style: 'persuasive',
        },
      },
      examples: ['Limited Time: 50% Off Premium Course', 'Only 24 Hours Left - Don\'t Miss Out!'],
      tags: ['urgency', 'scarcity', 'conversion'],
    },
    {
      id: 'ad-benefit-focused',
      name: 'Benefit-Focused Ad',
      description: 'Highlights key benefits and value proposition',
      type: 'ad_copy',
      industry: 'general',
      template: {
        prompt: 'Create benefit-focused ad copy for {product} that highlights the main value proposition for {audience}',
        variables: ['product', 'audience'],
        systemPrompt: 'You are a marketing copywriter focused on benefits over features. Show how the product solves problems.',
        options: {
          tone: 'professional',
          length: 'medium',
          style: 'persuasive',
        },
      },
      examples: ['Save 10 Hours Per Week with Our Automation Tool', 'Transform Your Business in 30 Days'],
      tags: ['benefits', 'value', 'solution'],
    },

    // Email Templates
    {
      id: 'email-welcome',
      name: 'Welcome Email',
      description: 'Welcomes new subscribers or customers',
      type: 'email',
      industry: 'general',
      template: {
        prompt: 'Write a warm welcome email for {recipient} who just {action}. Include next steps and value proposition.',
        variables: ['recipient', 'action'],
        systemPrompt: 'You are writing a welcoming email that builds relationships and sets expectations.',
        options: {
          tone: 'friendly',
          length: 'medium',
          style: 'informative',
        },
      },
      examples: ['Welcome to Our Newsletter', 'Thanks for Your Purchase!'],
      tags: ['welcome', 'onboarding', 'relationship'],
    },
    {
      id: 'email-nurture',
      name: 'Nurture Email',
      description: 'Educational content to build relationships',
      type: 'email',
      industry: 'general',
      template: {
        prompt: 'Write a nurturing email about {topic} that provides value to {audience} and builds trust.',
        variables: ['topic', 'audience'],
        systemPrompt: 'You are writing educational emails that provide value and build long-term relationships.',
        options: {
          tone: 'professional',
          length: 'medium',
          style: 'educational',
        },
      },
      examples: ['Weekly Marketing Tips', 'Industry Insights and Trends'],
      tags: ['nurture', 'education', 'value'],
    },

    // Product Description Templates
    {
      id: 'product-tech',
      name: 'Tech Product Description',
      description: 'Technical product description with specifications',
      type: 'product_description',
      industry: 'technology',
      template: {
        prompt: 'Write a technical product description for {product} with features: {features}. Target audience: {audience}',
        variables: ['product', 'features', 'audience'],
        systemPrompt: 'You are a technical writer creating detailed product descriptions. Balance technical accuracy with accessibility.',
        options: {
          tone: 'professional',
          length: 'medium',
          style: 'informative',
        },
      },
      examples: ['Smartphone Specifications', 'Software Platform Features'],
      tags: ['technical', 'specifications', 'features'],
    },
    {
      id: 'product-lifestyle',
      name: 'Lifestyle Product Description',
      description: 'Emotional and lifestyle-focused product description',
      type: 'product_description',
      industry: 'lifestyle',
      template: {
        prompt: 'Write a lifestyle-focused product description for {product} that appeals to {audience} and highlights the lifestyle benefits.',
        variables: ['product', 'audience'],
        systemPrompt: 'You are a lifestyle copywriter creating emotional connections with products. Focus on how it improves life.',
        options: {
          tone: 'friendly',
          length: 'medium',
          style: 'persuasive',
        },
      },
      examples: ['Fashion Accessories', 'Home Decor Items'],
      tags: ['lifestyle', 'emotional', 'benefits'],
    },

    // Social Media Templates
    {
      id: 'social-engagement',
      name: 'Engagement Post',
      description: 'Social media post designed to drive engagement',
      type: 'caption',
      industry: 'general',
      template: {
        prompt: 'Create an engaging {platform} post about {topic} that encourages comments and shares. Include relevant hashtags.',
        variables: ['platform', 'topic'],
        systemPrompt: 'You are a social media expert creating posts that drive engagement and build community.',
        options: {
          tone: 'casual',
          length: 'short',
          style: 'entertaining',
        },
      },
      examples: ['Instagram Story Question', 'LinkedIn Discussion Starter'],
      tags: ['engagement', 'community', 'interaction'],
    },
    {
      id: 'social-educational',
      name: 'Educational Post',
      description: 'Informative social media content',
      type: 'caption',
      industry: 'general',
      template: {
        prompt: 'Create an educational {platform} post about {topic} that provides value to {audience}. Include key takeaways.',
        variables: ['platform', 'topic', 'audience'],
        systemPrompt: 'You are creating educational social media content that provides value and positions you as an expert.',
        options: {
          tone: 'professional',
          length: 'medium',
          style: 'educational',
        },
      },
      examples: ['LinkedIn Industry Tips', 'Instagram Educational Carousel'],
      tags: ['education', 'value', 'expertise'],
    },
  ];

  private readonly industryPresets: IndustryPreset[] = [
    {
      id: 'technology',
      name: 'Technology',
      description: 'Templates optimized for tech companies and products',
      templates: ['blog-how-to', 'product-tech', 'ad-benefit-focused', 'email-nurture'],
      defaultOptions: {
        tone: 'professional',
        style: 'informative',
        targetAudience: 'tech-savvy professionals',
      },
    },
    {
      id: 'ecommerce',
      name: 'E-commerce',
      description: 'Templates for online retail and product sales',
      templates: ['ad-urgency', 'product-lifestyle', 'email-welcome', 'social-engagement'],
      defaultOptions: {
        tone: 'friendly',
        style: 'persuasive',
        targetAudience: 'online shoppers',
      },
    },
    {
      id: 'saas',
      name: 'SaaS',
      description: 'Templates for software-as-a-service companies',
      templates: ['blog-case-study', 'ad-benefit-focused', 'email-nurture', 'social-educational'],
      defaultOptions: {
        tone: 'professional',
        style: 'informative',
        targetAudience: 'business decision makers',
      },
    },
    {
      id: 'healthcare',
      name: 'Healthcare',
      description: 'Templates for healthcare and wellness industries',
      templates: ['blog-how-to', 'email-nurture', 'social-educational'],
      defaultOptions: {
        tone: 'professional',
        style: 'educational',
        targetAudience: 'health-conscious individuals',
      },
    },
    {
      id: 'finance',
      name: 'Finance',
      description: 'Templates for financial services and fintech',
      templates: ['blog-case-study', 'email-nurture', 'social-educational'],
      defaultOptions: {
        tone: 'authoritative',
        style: 'informative',
        targetAudience: 'financially aware consumers',
      },
    },
  ];

  /**
   * Get all available templates
   */
  getAllTemplates(): ContentTemplate[] {
    return this.templates;
  }

  /**
   * Get templates by type
   */
  getTemplatesByType(type: string): ContentTemplate[] {
    return this.templates.filter(template => template.type === type);
  }

  /**
   * Get templates by industry
   */
  getTemplatesByIndustry(industry: string): ContentTemplate[] {
    return this.templates.filter(template => template.industry === industry || template.industry === 'general');
  }

  /**
   * Get specific template by ID
   */
  getTemplateById(id: string): ContentTemplate | undefined {
    return this.templates.find(template => template.id === id);
  }

  /**
   * Get all industry presets
   */
  getAllIndustryPresets(): IndustryPreset[] {
    return this.industryPresets;
  }

  /**
   * Get specific industry preset by ID
   */
  getIndustryPresetById(id: string): IndustryPreset | undefined {
    return this.industryPresets.find(preset => preset.id === id);
  }

  /**
   * Generate content using a template
   */
  generateFromTemplate(
    templateId: string,
    variables: Record<string, string>,
    customOptions?: any
  ): { prompt: string; options: any } {
    const template = this.getTemplateById(templateId);
    if (!template) {
      throw new Error(`Template with ID ${templateId} not found`);
    }

    // Replace variables in the prompt
    let prompt = template.template.prompt;
    template.template.variables.forEach(variable => {
      const value = variables[variable];
      if (!value) {
        throw new Error(`Variable ${variable} is required but not provided`);
      }
      prompt = prompt.replace(`{${variable}}`, value);
    });

    // Merge template options with custom options
    const options = {
      ...template.template.options,
      ...customOptions,
    };

    return {
      prompt,
      options: {
        ...options,
        systemPrompt: template.template.systemPrompt,
        templateId: template.id,
        templateName: template.name,
      },
    };
  }

  /**
   * Get recommended templates for a specific use case
   */
  getRecommendedTemplates(
    type: string,
    industry?: string,
    tags?: string[]
  ): ContentTemplate[] {
    let filtered = this.templates.filter(template => template.type === type);

    if (industry) {
      filtered = filtered.filter(template => 
        template.industry === industry || template.industry === 'general'
      );
    }

    if (tags && tags.length > 0) {
      filtered = filtered.filter(template =>
        tags.some(tag => template.tags.includes(tag))
      );
    }

    return filtered;
  }

  /**
   * Search templates by name or description
   */
  searchTemplates(query: string): ContentTemplate[] {
    const lowercaseQuery = query.toLowerCase();
    return this.templates.filter(template =>
      template.name.toLowerCase().includes(lowercaseQuery) ||
      template.description.toLowerCase().includes(lowercaseQuery) ||
      template.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))
    );
  }
}
