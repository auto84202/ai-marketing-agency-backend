import { Module } from '@nestjs/common';
import { SocialScraperController } from './social-scraper.controller';
import { SocialScraperService } from './social-scraper.service';
import { PythonScraperService } from './python-scraper.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [SocialScraperController],
    providers: [SocialScraperService, PythonScraperService],
    exports: [SocialScraperService],
})
export class SocialScraperModule {}
