import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PythonScraperService } from './python-scraper.service';
import { CreateScraperJobDto } from './dto/create-scraper-job.dto';
import { ScraperStatus, ReplyStatus, ScrapedComment } from '@prisma/client';

@Injectable()
export class SocialScraperService {
    private readonly logger = new Logger(SocialScraperService.name);

    constructor(
        private prisma: PrismaService,
        private pythonScraper: PythonScraperService,
    ) { }

    async createJob(userId: string, dto: CreateScraperJobDto) {
        this.logger.log(`Creating scraper job for user ${userId} on ${dto.platform}`);

        const job = await this.prisma.scraperJob.create({
            data: {
                userId,
                platform: dto.platform,
                keyword: dto.keyword,
                googlePages: dto.googlePages,
                replyLimit: dto.replyLimit,
                status: ScraperStatus.PENDING,
            },
            include: {
                comments: true,
                replies: true,
            },
        });

        // Start the scraping job asynchronously
        this.startScrapingJob(job.id, dto).catch(err => {
            this.logger.error(`Failed to start scraper job ${job.id}:`, err);
        });

        return job;
    }

    async getJob(jobId: string, userId: string) {
        return this.prisma.scraperJob.findFirst({
            where: { id: jobId, userId },
            include: {
                comments: {
                    include: {
                        reply: true,
                    },
                },
                replies: true,
            },
        });
    }

    async getUserJobs(userId: string, limit = 50) {
        return this.prisma.scraperJob.findMany({
            where: { userId },
            include: {
                _count: {
                    select: {
                        comments: true,
                        replies: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    async cancelJob(jobId: string, userId: string) {
        const job = await this.prisma.scraperJob.findFirst({
            where: { id: jobId, userId },
        });

        if (!job) {
            throw new Error('Job not found');
        }

        if (job.status === ScraperStatus.COMPLETED || job.status === ScraperStatus.FAILED) {
            throw new Error('Cannot cancel completed or failed job');
        }

        return this.prisma.scraperJob.update({
            where: { id: jobId },
            data: { status: ScraperStatus.CANCELLED },
        });
    }

    async deleteJob(jobId: string, userId: string) {
        const job = await this.prisma.scraperJob.findFirst({
            where: { id: jobId, userId },
        });

        if (!job) {
            throw new Error('Job not found');
        }

        return this.prisma.scraperJob.delete({
            where: { id: jobId },
        });
    }

    private async startScrapingJob(jobId: string, dto: CreateScraperJobDto) {
        try {
            await this.prisma.scraperJob.update({
                where: { id: jobId },
                data: {
                    status: ScraperStatus.RUNNING,
                    startedAt: new Date(),
                },
            });

            this.logger.log(`Starting scraper job ${jobId} for ${dto.platform}`);

            // Get Groq API key from environment or use provided one
            const groqApiKey = dto.groqApiKey || process.env.GROQ_API_KEY;

            if (!groqApiKey) {
                throw new Error('Groq API key not provided');
            }

            // Run Python scraper
            const result = await this.pythonScraper.runScraper(
                {
                    platform: dto.platform,
                    keyword: dto.keyword,
                    googlePages: dto.googlePages,
                    replyLimit: dto.replyLimit,
                    groqApiKey,
                    jobId,
                },
                async (progress) => {
                    // Update job progress
                    await this.prisma.scraperJob.update({
                        where: { id: jobId },
                        data: {
                            progress: progress.progress,
                            totalComments: progress.totalComments,
                            totalReplies: progress.totalReplies,
                        },
                    });
                }
            );

            // Save scraped comments to database in batches to avoid connection pool exhaustion
            if (result.comments && result.comments.length > 0) {
                this.logger.log(`Saving ${result.comments.length} comments to database in batches...`);
                const createdComments: ScrapedComment[] = [];
                const batchSize = 10; // Process 10 comments at a time

                for (let i = 0; i < result.comments.length; i += batchSize) {
                    const batch = result.comments.slice(i, i + batchSize);
                    const batchResults = await Promise.all(
                        batch.map(async (comment: any) => {
                            return this.prisma.scrapedComment.create({
                                data: {
                                    jobId,
                                    postUrl: comment.post_url,
                                    username: comment.username,
                                    comment: comment.comment,
                                    timePosted: comment.time,
                                    platform: dto.platform,
                                },
                            });
                        })
                    );
                    createdComments.push(...batchResults);
                    this.logger.log(`Saved batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(result.comments.length / batchSize)}`);
                }

                // Save replies if available
                if (result.replies && result.replies.length > 0) {
                    await Promise.all(
                        result.replies.map(async (reply: any) => {
                            // Find the comment this reply belongs to
                            const comment = createdComments.find(
                                c => c.username === reply.username
                            );

                            if (comment) {
                                await this.prisma.scraperReply.create({
                                    data: {
                                        jobId,
                                        commentId: comment.id,
                                        username: reply.username,
                                        replyText: reply.reply_text,
                                        status: reply.success ? ReplyStatus.SENT : ReplyStatus.FAILED,
                                        repliedAt: reply.success ? new Date() : null,
                                    },
                                });

                            }
                        })
                    );
                }
            }

            await this.prisma.scraperJob.update({
                where: { id: jobId },
                data: {
                    status: ScraperStatus.COMPLETED,
                    completedAt: new Date(),
                    progress: 100,
                    totalComments: result.totalComments || 0,
                    totalReplies: result.totalReplies || 0,
                },
            });

        } catch (error) {
            this.logger.error(`Scraper job ${jobId} failed:`, error);
            await this.prisma.scraperJob.update({
                where: { id: jobId },
                data: {
                    status: ScraperStatus.FAILED,
                    errorMessage: error instanceof Error ? error.message : String(error),
                    completedAt: new Date(),
                },
            });
        }
    }

    async getJobStats(userId: string) {
        const [total, pending, running, completed, failed] = await Promise.all([
            this.prisma.scraperJob.count({ where: { userId } }),
            this.prisma.scraperJob.count({ where: { userId, status: ScraperStatus.PENDING } }),
            this.prisma.scraperJob.count({ where: { userId, status: ScraperStatus.RUNNING } }),
            this.prisma.scraperJob.count({ where: { userId, status: ScraperStatus.COMPLETED } }),
            this.prisma.scraperJob.count({ where: { userId, status: ScraperStatus.FAILED } }),
        ]);

        const totalComments = await this.prisma.scrapedComment.count({
            where: { job: { userId } },
        });

        const totalReplies = await this.prisma.scraperReply.count({
            where: { job: { userId } },
        });

        return {
            total,
            pending,
            running,
            completed,
            failed,
            totalComments,
            totalReplies,
        };
    }

    async setupChromeProfile(userId: string) {
        this.logger.log(`User ${userId} is setting up Chrome profile`);

        try {
            const result = await this.pythonScraper.setupChromeProfile();
            return {
                success: true,
                message: 'Chrome profile setup initiated. A Chrome window will open with login pages for all social media platforms. Log in to each account and close the browser when done.',
                ...result
            };
        } catch (error: any) {
            this.logger.error('Failed to setup Chrome profile:', error);
            return {
                success: false,
                message: 'Failed to open Chrome profile setup',
                error: error?.message || 'Unknown error'
            };
        }
    }
}
