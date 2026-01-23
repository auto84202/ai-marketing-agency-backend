import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../../auth/auth.module';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { CostMonitoringService } from './cost-monitoring.service';
import { ImprovementSuggestionService } from './improvement-suggestion.service';
import { OpenAIService } from '../../integrations/openai/openai.service';
import chatbotConfig from '../../config/chatbot.config';
import { ContentService } from '../content/content.service';
import { SEOService } from '../seo/seo.service';
import { ImageGenerationService } from '../images/image-generation.service';
import { ImageGenerationModule } from '../images/image-generation.module';
import { FacebookService } from '../../integrations/social/facebook.service';
import { InstagramService } from '../../integrations/social/instagram.service';

@Module({
  imports: [
    PrismaModule, 
    AuthModule,
    ImageGenerationModule,
    ConfigModule.forFeature(chatbotConfig),
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
  controllers: [ChatbotController],
  providers: [ChatbotService, CostMonitoringService, ImprovementSuggestionService, OpenAIService, ContentService, SEOService, ImageGenerationService, FacebookService, InstagramService],
  exports: [ChatbotService, CostMonitoringService, ImprovementSuggestionService],
})
export class ChatbotModule {}
