import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SocialAutomationController } from './social-automation.controller';
import { SocialAutomationService } from './social-automation.service';
import { TrendAnalysisService } from './trend-analysis.service';
import { ContentRecommendationService } from './content-recommendation.service';
import { CommentMonitoringService } from './comment-monitoring.service';
import { KeywordMonitoringController } from './keyword-monitoring.controller';
import { KeywordMonitoringService } from './keyword-monitoring.service';
import { AutomatedEngagementService } from './automated-engagement.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { LinkedInService } from '../../integrations/social/linkedin.service';
import { InstagramService } from '../../integrations/social/instagram.service';
import { TwitterService } from '../../integrations/social/twitter.service';
import { FacebookService } from '../../integrations/social/facebook.service';

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService): Promise<JwtModuleOptions> => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-super-secret-jwt-key-here-make-this-very-long-and-secure',
        signOptions: { expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '7d') as any },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SocialAutomationController, KeywordMonitoringController],
  providers: [
    SocialAutomationService,
    TrendAnalysisService,
    ContentRecommendationService,
    CommentMonitoringService,
    KeywordMonitoringService,
    AutomatedEngagementService,
    LinkedInService,
    InstagramService,
    TwitterService,
    FacebookService,
  ],
  exports: [
    SocialAutomationService,
    TrendAnalysisService,
    ContentRecommendationService,
    CommentMonitoringService,
    KeywordMonitoringService,
    AutomatedEngagementService,
    LinkedInService,
    InstagramService,
    TwitterService,
    FacebookService,
  ],
})
export class SocialAutomationModule {}
