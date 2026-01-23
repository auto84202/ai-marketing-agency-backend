import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';
import { ContentService } from './content/content.service';
import { ContentTemplatesService } from './content/content-templates.service';
import { SEOService } from './seo/seo.service';
import { SocialService } from './social/social.service';
import { ChatbotService } from './chatbot/chatbot.service';
import { AnalyticsService } from './analytics/analytics.service';
import { OpenAIService } from '../integrations/openai/openai.service';
import { ChatbotModule } from './chatbot/chatbot.module';
import { ImageGenerationModule } from './images/image-generation.module';
import { SEOAdsOptimizationModule } from './seo/seo-ads-optimization.module';
import { PredictiveAnalyticsModule } from './analytics/predictive-analytics.module';
import { ABTestingModule } from './ab-testing/ab-testing.module';
import { BudgetOptimizationModule } from './budget-optimization/budget-optimization.module';
import { SocialAutomationModule } from './social-media/social-automation.module';
import { HashtagSearchModule } from './hashtag-search/hashtag-search.module';

@Module({
  imports: [
    PrismaModule, 
    AuthModule, 
    ChatbotModule, 
    ImageGenerationModule,
    SEOAdsOptimizationModule,
    PredictiveAnalyticsModule,
    ABTestingModule,
    BudgetOptimizationModule,
    SocialAutomationModule,
    HashtagSearchModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService): Promise<JwtModuleOptions> => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-super-secret-jwt-key-here-make-this-very-long-and-secure',
        signOptions: { 
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '7d') as any
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AIController],
  providers: [
    AIService,
    ContentService,
    ContentTemplatesService,
    SEOService,
    SocialService,
    ChatbotService,
    AnalyticsService,
    OpenAIService,
  ],
  exports: [
    AIService,
    ChatbotService,
    SEOService,
    SocialService,
    AnalyticsService,
    ContentService,
  ],
})
export class AiModule {}
