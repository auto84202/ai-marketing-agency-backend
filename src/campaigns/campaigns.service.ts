import { Injectable, Logger, Inject, forwardRef, NotFoundException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { UpdateCampaignDto } from "./dto/update-campaign.dto";
import { WorkflowsService } from "../workflows/workflows.service";
import { ChatbotService } from "../ai/chatbot/chatbot.service";
import { WorkflowRunStatus } from "@prisma/client";


@Injectable()
export class CampaignsService {
    private readonly logger = new Logger(CampaignsService.name);

    constructor(
        private prisma: PrismaService,
        private readonly workflows: WorkflowsService,
        @Inject(forwardRef(() => ChatbotService))
        private readonly chatbotService?: ChatbotService,
    ) { }


    list(userId: string, isAdmin: boolean = false) {
        // If user is admin, show all campaigns. Otherwise, filter by authenticated userId
        // SECURITY: Always filter by userId unless admin - never trust query parameters
        const whereClause = isAdmin ? {} : { userId };
        
        if (!isAdmin && !userId) {
            throw new BadRequestException('User ID is required for non-admin users');
        }
        
        return this.prisma.campaign.findMany({
            where: whereClause,
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        company: true
                    }
                }
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async findOne(id: string, authenticatedUserId: string, isAdmin: boolean = false) {
        // SECURITY: Always verify campaign belongs to user (unless admin)
        const campaign = await this.prisma.campaign.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        company: true
                    }
                }
            }
        });

        if (!campaign) {
            throw new NotFoundException('Campaign not found');
        }

        // Verify ownership: Only admin or the owner can access the campaign
        if (!isAdmin && campaign.userId !== authenticatedUserId) {
            throw new ForbiddenException('Access denied: You do not have permission to access this campaign');
        }

        return campaign;
    }

    async create(dto: CreateCampaignDto, authenticatedUserId?: string) {
        // SECURITY: Always use authenticated user ID - never trust userId from DTO
        if (!authenticatedUserId) {
            throw new BadRequestException('Authenticated user ID is required to create a campaign');
        }
        const userId = authenticatedUserId;
        
        try {
            // Verify user exists
            await this.prisma.user.findFirstOrThrow({ where: { id: userId } });
            const campaignSettings: Record<string, any> = {};
            if (dto.businessProfile) {
                campaignSettings.businessProfile = dto.businessProfile;
            }
            if (dto.audienceProfile) {
                campaignSettings.audienceProfile = dto.audienceProfile;
            }
            if (dto.goals?.length) {
                campaignSettings.goals = dto.goals;
            }
            if (dto.focusKeywords?.length) {
                campaignSettings.focusKeywords = dto.focusKeywords;
            }
            if (dto.autoStart !== undefined) {
                campaignSettings.autoStart = dto.autoStart;
            }

            // Create campaign
            const campaign = await this.prisma.campaign.create({
                data: {
                    userId: userId,
                    name: dto.name,
                    type: dto.type as any,
                    status: dto.status ?? "draft",
                    plan: dto.plan ?? "standard",
                    description: dto.description,
                    startDate: dto.startDate ? new Date(dto.startDate) : undefined,
                    endDate: dto.endDate ? new Date(dto.endDate) : undefined,
                    budget: dto.budget,
                    settings: Object.keys(campaignSettings).length > 0 ? campaignSettings : undefined,
                },
            });

            if (dto.autoStart !== false) {
                try {
                    await this.workflows.startCampaignAutomation({
                        campaignId: campaign.id,
                        userId: userId,
                        plan: campaign.plan ?? 'standard',
                        campaignType: campaign.type,
                        businessProfile: dto.businessProfile,
                        audienceProfile: dto.audienceProfile,
                        goals: dto.goals,
                        focusKeywords: dto.focusKeywords,
                    });
                } catch (workflowError) {
                    this.logger.error(
                        `Failed to start automation for campaign ${campaign.id}: ${
                            workflowError instanceof Error ? workflowError.message : 'Unknown error'
                        }`,
                    );
                }
            }

            return campaign;
        } catch (error) {
            console.error('Error creating campaign:', error);
            throw error;
        }
    }


    async update(authenticatedUserId: string, id: string, dto: UpdateCampaignDto, isAdmin: boolean = false) {
        // SECURITY: Verify campaign exists and belongs to user (unless admin)
        const previousCampaign = await this.prisma.campaign.findUnique({
            where: { id },
            include: {
                chatbots: true,
            },
        });

        if (!previousCampaign) {
            throw new NotFoundException('Campaign not found');
        }

        // Verify ownership: Only admin or the owner can update the campaign
        if (!isAdmin && previousCampaign.userId !== authenticatedUserId) {
            throw new ForbiddenException('Access denied: You do not have permission to update this campaign');
        }

        const updatedCampaign = await this.prisma.campaign.update({ 
            where: { id }, 
            data: { 
                ...dto, 
                startDate: dto.startDate ? new Date(dto.startDate) : undefined, 
                endDate: dto.endDate ? new Date(dto.endDate) : undefined 
            },
            include: {
                chatbots: true,
            },
        });

        // If campaign status changed, sync workflow runs status
        const previousStatus = previousCampaign?.status || 'draft';
        const newStatus = updatedCampaign.status;

        // Only update workflow runs if status actually changed
        if (previousStatus !== newStatus) {
            // Map campaign status to workflow run status
            let workflowRunStatus: WorkflowRunStatus | null = null;
            
            if (newStatus === 'active' || newStatus === 'running') {
                workflowRunStatus = WorkflowRunStatus.ACTIVE;
            } else if (newStatus === 'completed') {
                workflowRunStatus = WorkflowRunStatus.COMPLETED;
            } else if (newStatus === 'pending' || newStatus === 'draft') {
                workflowRunStatus = WorkflowRunStatus.PENDING;
            } else if (newStatus === 'paused') {
                workflowRunStatus = WorkflowRunStatus.PAUSED;
            }

            // Update all associated workflow runs if status mapping exists
            if (workflowRunStatus) {
                try {
                    const updateData: any = {
                        status: workflowRunStatus,
                        updatedAt: new Date(),
                    };

                    // Set startedAt when activating, completedAt when completing
                    if (workflowRunStatus === WorkflowRunStatus.ACTIVE) {
                        updateData.startedAt = new Date();
                    } else if (workflowRunStatus === WorkflowRunStatus.COMPLETED) {
                        updateData.completedAt = new Date();
                        updateData.progress = 1;
                    }

                    // Update all workflow runs associated with this campaign
                    const updateResult = await this.prisma.workflowRun.updateMany({
                        where: {
                            campaignId: id,
                            // Only update runs that are not already in a terminal state (COMPLETED, FAILED, CANCELLED)
                            status: {
                                notIn: [WorkflowRunStatus.COMPLETED, WorkflowRunStatus.FAILED, WorkflowRunStatus.CANCELLED],
                            },
                        },
                        data: updateData,
                    });

                    if (updateResult.count > 0) {
                        this.logger.log(
                            `Updated ${updateResult.count} workflow run(s) for campaign ${id} to status ${workflowRunStatus}`
                        );
                    }
                } catch (workflowError) {
                    this.logger.error(
                        `Failed to update workflow runs for campaign ${id}: ${
                            workflowError instanceof Error ? workflowError.message : 'Unknown error'
                        }`
                    );
                    // Don't fail the campaign update if workflow update fails
                }
            }

            // If campaign status changed to 'active' or 'running', and there's an active chatbot, generate content
            if ((newStatus === 'active' || newStatus === 'running') && 
                (previousStatus !== 'active' && previousStatus !== 'running')) {
                // Campaign was just activated - check if there's an active chatbot
                const activeChatbot = updatedCampaign.chatbots.find(
                    (chatbot) => chatbot.status === 'ACTIVE'
                );

                if (activeChatbot && this.chatbotService) {
                    this.logger.log(`Campaign ${id} activated with active chatbot ${activeChatbot.id}. Triggering AI content generation...`);
                    // Trigger content generation in background
                    this.chatbotService.generateCampaignContent(
                        updatedCampaign.userId,
                        updatedCampaign.id,
                        updatedCampaign
                    ).catch((error) => {
                        this.logger.error(`Failed to generate campaign content: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    });
                } else if (!activeChatbot) {
                    this.logger.log(`Campaign ${id} activated but no active chatbot found. Create and activate a chatbot to generate AI content.`);
                }
            }
        }

        return updatedCampaign;
    }

    async delete(id: string, authenticatedUserId: string, isAdmin: boolean = false) {
        // SECURITY: Verify campaign exists and belongs to user (unless admin)
        const campaign = await this.prisma.campaign.findUnique({
            where: { id },
        });

        if (!campaign) {
            throw new NotFoundException('Campaign not found');
        }

        // Verify ownership: Only admin or the owner can delete the campaign
        if (!isAdmin && campaign.userId !== authenticatedUserId) {
            throw new ForbiddenException('Access denied: You do not have permission to delete this campaign');
        }

        return this.prisma.campaign.delete({ where: { id } });
    }

    /**
     * Get Instagram posts with comments for dashboard
     */
    async getInstagramPostsForDashboard(userId: string, refresh: boolean = false) {
        try {
            // First, clean up posts from ended campaigns
            await this.cleanupEndedCampaignPosts(userId, 'INSTAGRAM');

            // Get active campaigns to ensure we only show relevant posts
            const activeCampaigns = await this.prisma.campaign.findMany({
                where: {
                    userId,
                    status: {
                        in: ['active', 'running'],
                    },
                },
                select: {
                    id: true,
                    name: true,
                    description: true,
                    settings: true,
                },
            });

            const activeCampaignIds = activeCampaigns.map(c => c.id);

            // If no active campaigns, return empty result
            if (activeCampaignIds.length === 0) {
                return {
                    posts: [],
                    hashtags: [],
                };
            }

            // If refresh is true, trigger live fetch for active campaigns
            if (refresh && activeCampaigns.length > 0) {
                // Trigger background refresh of posts for active campaigns
                this.refreshSocialMediaPosts(userId, activeCampaigns, 'INSTAGRAM').catch((error) => {
                    this.logger.error(`Background refresh failed for Instagram: ${error instanceof Error ? error.message : 'Unknown error'}`);
                });
            }

            // Get Instagram posts only from active campaigns
            const posts = await this.prisma.socialPost.findMany({
                where: {
                    userId,
                    platform: 'INSTAGRAM',
                    campaignId: {
                        in: activeCampaignIds,
                    },
                },
                include: {
                    comments: {
                        orderBy: { createdAt: 'desc' },
                        take: 10, // Limit to 10 most recent comments per post
                    },
                    campaign: {
                        select: {
                            id: true,
                            name: true,
                            status: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                take: 20, // Limit to 20 most recent posts
            });

            // Get trending hashtags for Instagram
            const hashtags = await this.prisma.trendingTopic.findMany({
                where: {
                    platform: 'INSTAGRAM',
                },
                orderBy: [
                    { volume: 'desc' },
                    { updatedAt: 'desc' },
                ],
                take: 20,
            });

            // Extract unique hashtags from campaign settings
            const campaigns = await this.prisma.campaign.findMany({
                where: { userId },
                select: { settings: true },
            });

            const campaignHashtags = new Set<string>();
            campaigns.forEach(campaign => {
                const settings = campaign.settings as any;
                if (settings?.trendTags && Array.isArray(settings.trendTags)) {
                    settings.trendTags.forEach((tag: string) => campaignHashtags.add(tag));
                }
            });

            return {
                posts: posts.map(post => {
                    // Extract permalink from metrics if available
                    const metrics = post.metrics as any;
                    const permalink = metrics?.permalink || (post.platformPostId 
                        ? `https://www.instagram.com/p/${post.platformPostId}/`
                        : null);
                    
                    return {
                        id: post.id,
                        content: post.content,
                        hashtags: post.hashtags,
                        platform: post.platform,
                        metrics: post.metrics,
                        postedAt: post.postedAt,
                        createdAt: post.createdAt,
                        platformPostId: post.platformPostId,
                        permalink: permalink,
                        mediaUrls: post.mediaUrls,
                        campaign: post.campaign,
                        comments: post.comments.map(comment => ({
                            id: comment.id,
                            content: comment.content,
                            authorName: comment.authorName,
                            authorAvatar: comment.authorAvatar,
                            createdAt: comment.createdAt,
                            sentiment: comment.sentiment,
                        })),
                        commentCount: post.comments.length,
                    };
                }),
                hashtags: [
                    ...hashtags.map(h => ({
                        tag: h.hashtag || `#${h.topic}`,
                        volume: h.volume || 0,
                        relevanceScore: h.relevanceScore || 0,
                    })),
                    ...Array.from(campaignHashtags).slice(0, 10).map(tag => ({
                        tag: tag.startsWith('#') ? tag : `#${tag}`,
                        volume: 0,
                        relevanceScore: 0.5,
                    })),
                ],
            };
        } catch (error) {
            this.logger.error(`Failed to fetch Instagram posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    /**
     * Get Facebook posts with comments for dashboard
     */
    async getFacebookPostsForDashboard(userId: string, refresh: boolean = false) {
        try {
            // First, clean up posts from ended campaigns
            await this.cleanupEndedCampaignPosts(userId, 'FACEBOOK');

            // Get active campaigns to ensure we only show relevant posts
            const activeCampaigns = await this.prisma.campaign.findMany({
                where: {
                    userId,
                    status: {
                        in: ['active', 'running'],
                    },
                },
                select: {
                    id: true,
                    name: true,
                    description: true,
                    settings: true,
                },
            });

            const activeCampaignIds = activeCampaigns.map(c => c.id);

            // If refresh is true, trigger live fetch for active campaigns
            if (refresh && activeCampaigns.length > 0) {
                // Trigger background refresh of posts for active campaigns
                this.refreshSocialMediaPosts(userId, activeCampaigns, 'FACEBOOK').catch((error) => {
                    this.logger.error(`Background refresh failed for Facebook: ${error instanceof Error ? error.message : 'Unknown error'}`);
                });
            }

            // If no active campaigns, return empty result
            if (activeCampaignIds.length === 0) {
                return {
                    posts: [],
                    hashtags: [],
                };
            }

            // Get Facebook posts only from active campaigns
            const posts = await this.prisma.socialPost.findMany({
                where: {
                    userId,
                    platform: 'FACEBOOK',
                    campaignId: {
                        in: activeCampaignIds,
                    },
                },
                include: {
                    comments: {
                        orderBy: { createdAt: 'desc' },
                        take: 10, // Limit to 10 most recent comments per post
                    },
                    campaign: {
                        select: {
                            id: true,
                            name: true,
                            status: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                take: 20, // Limit to 20 most recent posts
            });

            // Get trending hashtags
            const hashtags = await this.prisma.trendingTopic.findMany({
                where: {
                    platform: 'FACEBOOK',
                },
                orderBy: [
                    { volume: 'desc' },
                    { updatedAt: 'desc' },
                ],
                take: 20,
            });

            // Extract unique hashtags from campaign settings
            const campaigns = await this.prisma.campaign.findMany({
                where: { userId },
                select: { settings: true },
            });

            const campaignHashtags = new Set<string>();
            campaigns.forEach(campaign => {
                const settings = campaign.settings as any;
                if (settings?.trendTags && Array.isArray(settings.trendTags)) {
                    settings.trendTags.forEach((tag: string) => campaignHashtags.add(tag));
                }
            });

            return {
                posts: posts.map(post => {
                    // Extract permalink from metrics if available, or construct from platformPostId
                    const metrics = post.metrics as any;
                    const permalink = metrics?.permalink || (post.platformPostId 
                        ? `https://www.facebook.com/${post.platformPostId}`
                        : null);
                    
                    return {
                        id: post.id,
                        content: post.content,
                        hashtags: post.hashtags,
                        platform: post.platform,
                        metrics: post.metrics,
                        postedAt: post.postedAt,
                        createdAt: post.createdAt,
                        platformPostId: post.platformPostId,
                        permalink: permalink,
                        campaign: post.campaign,
                        comments: post.comments.map(comment => ({
                            id: comment.id,
                            content: comment.content,
                            authorName: comment.authorName,
                            authorAvatar: comment.authorAvatar,
                            createdAt: comment.createdAt,
                            sentiment: comment.sentiment,
                        })),
                        commentCount: post.comments.length,
                    };
                }),
                hashtags: [
                    ...hashtags.map(h => ({
                        tag: h.hashtag || `#${h.topic}`,
                        volume: h.volume || 0,
                        relevanceScore: h.relevanceScore || 0,
                    })),
                    ...Array.from(campaignHashtags).slice(0, 10).map(tag => ({
                        tag: tag.startsWith('#') ? tag : `#${tag}`,
                        volume: 0,
                        relevanceScore: 0.5,
                    })),
                ],
            };
        } catch (error) {
            this.logger.error(`Failed to fetch Facebook posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    /**
     * Clean up posts from ended campaigns
     */
    private async cleanupEndedCampaignPosts(userId: string, platform: 'FACEBOOK' | 'INSTAGRAM'): Promise<void> {
        try {
            // Get ended campaigns
            const endedCampaigns = await this.prisma.campaign.findMany({
                where: {
                    userId,
                    status: {
                        in: ['ended', 'completed', 'paused'],
                    },
                },
                select: {
                    id: true,
                },
            });

            const endedCampaignIds = endedCampaigns.map(c => c.id);

            if (endedCampaignIds.length === 0) {
                return;
            }

            // Delete posts and comments from ended campaigns
            const deleteResult = await this.prisma.socialPost.deleteMany({
                where: {
                    userId,
                    platform,
                    campaignId: {
                        in: endedCampaignIds,
                    },
                },
            });

            if (deleteResult.count > 0) {
                this.logger.log(`Cleaned up ${deleteResult.count} ${platform} posts from ended campaigns for user ${userId}`);
            }
        } catch (error) {
            this.logger.error(`Failed to cleanup ended campaign posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Refresh social media posts for active campaigns
     */
    private async refreshSocialMediaPosts(
        userId: string,
        activeCampaigns: Array<{ id: string; name: string; description: string | null; settings: any }>,
        platform: 'FACEBOOK' | 'INSTAGRAM'
    ): Promise<void> {
        try {
            if (!this.chatbotService) {
                this.logger.warn('ChatbotService not available for refreshing social media posts');
                return;
            }

            this.logger.log(`Refreshing ${platform} posts for ${activeCampaigns.length} active campaigns`);

            // For each active campaign, trigger fresh post fetch
            for (const campaign of activeCampaigns) {
                try {
                    if (!campaign.description) {
                        continue;
                    }

                    const campaignFull = await this.prisma.campaign.findUnique({
                        where: { id: campaign.id },
                    });

                    if (campaignFull) {
                        // Use chatbot service to fetch fresh posts
                        await this.chatbotService.generateCampaignContent(userId, campaign.id, campaignFull);
                        this.logger.log(`Triggered refresh for ${platform} posts for campaign ${campaign.id}`);
                    }
                } catch (error) {
                    this.logger.error(`Failed to refresh posts for campaign ${campaign.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        } catch (error) {
            this.logger.error(`Failed to refresh social media posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}