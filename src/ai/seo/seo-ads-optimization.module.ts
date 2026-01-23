import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SEOAdsOptimizationController } from './seo-ads-optimization.controller';
import { SEOAdsOptimizationService } from './seo-ads-optimization.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { GoogleAdsService } from '../../integrations/google-ads/google-ads.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService): Promise<JwtModuleOptions> => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-super-secret-jwt-key-here-make-this-very-long-and-secure',
        signOptions: { expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '7d') as any },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SEOAdsOptimizationController],
  providers: [SEOAdsOptimizationService, GoogleAdsService],
  exports: [SEOAdsOptimizationService],
})
export class SEOAdsOptimizationModule {}
