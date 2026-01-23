import { Module } from '@nestjs/common';
import { KeywordScannerController } from './keyword-scanner.controller';
import { KeywordScannerService } from './keyword-scanner.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OpenAIService } from '../integrations/openai/openai.service';
import { FacebookService } from '../integrations/social/facebook.service';
import { InstagramService } from '../integrations/social/instagram.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [KeywordScannerController],
  providers: [
    KeywordScannerService,
    OpenAIService,
    FacebookService,
    InstagramService,
  ],
  exports: [KeywordScannerService],
})
export class KeywordScannerModule {}

