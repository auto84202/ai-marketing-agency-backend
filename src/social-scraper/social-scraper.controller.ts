import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { SocialScraperService } from './social-scraper.service';
import { CreateScraperJobDto } from './dto/create-scraper-job.dto';
import { ScraperJobResponseDto } from './dto/scraper-job-response.dto';
import { AuthGuard } from '../auth/auth.guard';

interface AuthRequest extends Request {
    user: { id: string };
}

@UseGuards(AuthGuard)
@Controller('social-scraper')
export class SocialScraperController {
    constructor(private readonly scraperService: SocialScraperService) {}

    @Post('jobs')
    async createJob(@Request() req: AuthRequest, @Body() dto: CreateScraperJobDto) {
        return this.scraperService.createJob(req.user.id, dto);
    }

    @Get('jobs')
    async getJobs(@Request() req: AuthRequest, @Query('limit') limit?: string) {
        const limitNum = limit ? parseInt(limit, 10) : 50;
        return this.scraperService.getUserJobs(req.user.id, limitNum);
    }

    @Get('jobs/:id')
    async getJob(@Request() req: AuthRequest, @Param('id') id: string) {
        return this.scraperService.getJob(id, req.user.id);
    }

    @Post('jobs/:id/cancel')
    async cancelJob(@Request() req: AuthRequest, @Param('id') id: string) {
        return this.scraperService.cancelJob(id, req.user.id);
    }

    @Delete('jobs/:id')
    async deleteJob(@Request() req: AuthRequest, @Param('id') id: string) {
        return this.scraperService.deleteJob(id, req.user.id);
    }

    @Get('stats')
    async getStats(@Request() req: AuthRequest) {
        return this.scraperService.getJobStats(req.user.id);
    }

    @Post('setup-profile')
    async setupChromeProfile(@Request() req: AuthRequest) {
        return this.scraperService.setupChromeProfile(req.user.id);
    }
}
