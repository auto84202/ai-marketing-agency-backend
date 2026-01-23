import { Module } from '@nestjs/common';
import { HashtagSearchController } from './hashtag-search.controller';
import { HashtagSearchService } from './hashtag-search.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { TwitterService } from '../../integrations/social/twitter.service';
import { InstagramService } from '../../integrations/social/instagram.service';
import { FacebookService } from '../../integrations/social/facebook.service';
import { LinkedInService } from '../../integrations/social/linkedin.service';
import { TikTokService } from '../../integrations/social/tiktok.service';

@Module({
  imports: [PrismaModule],
  controllers: [HashtagSearchController],
  providers: [
    HashtagSearchService,
    TwitterService,
    InstagramService,
    FacebookService,
    LinkedInService,
    TikTokService,
  ],
  exports: [HashtagSearchService],
})
export class HashtagSearchModule {}

