import { Injectable, Logger, OnModuleInit, ForbiddenException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import {
  Prisma,
  CampaignAssetStatus,
  CampaignAssetType,
  CampaignKeywordStatus,
  CampaignWorkflowTemplate,
  WorkflowJob,
  WorkflowJobStatus,
  WorkflowRun,
  WorkflowRunStatus,
  PostStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QueueName } from '../queue/queue.constants';
import { WORKFLOW_JOB_NAMES, AUTOMATION_TEMPLATE_SLUGS } from './workflows.constants';
import {
  StartCampaignAutomationInput,
  WorkflowDispatchJob,
  WorkflowQueueJobPayload,
  WorkflowStepDefinition,
  WorkflowContext,
  SocialPublishJobPayload,
} from './workflows.interfaces';
import { DEFAULT_WORKFLOW_TEMPLATES } from './templates/default-templates';
import { AIService } from '../ai/ai.service';
import { SEOService } from '../ai/seo/seo.service';
import { ImageGenerationService } from '../ai/images/image-generation.service';
import { SocialAutomationService } from '../ai/social-media/social-automation.service';
import { LinkedInService } from '../integrations/social/linkedin.service';
import { InstagramService } from '../integrations/social/instagram.service';
import { TwitterService } from '../integrations/social/twitter.service';
import { FacebookService } from '../integrations/social/facebook.service';
import { NotificationsService } from '../notifications/notifications.service';

interface AuthenticatedUser {
  sub: string;
  role: string;
  email?: string;
}

@Injectable()
export class WorkflowsService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly aiService: AIService,
    private readonly seoService: SEOService,
    private readonly imageService: ImageGenerationService,
    private readonly socialAutomation: SocialAutomationService,
    private readonly linkedinService: LinkedInService,
    private readonly instagramService: InstagramService,
    private readonly twitterService: TwitterService,
    private readonly facebookService: FacebookService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    try {
      await this.syncTemplates();
    } catch (error: any) {
      this.logger.error(`Failed to sync workflow templates: ${error?.message}`, error?.stack);
      // Don't throw - allow app to start even if templates can't be synced
      // This is usually due to missing database tables that will be created by migrations
    }
  }

  /**
   * Start automation for a campaign based on plan/template.
   */
  async startCampaignAutomation(input: StartCampaignAutomationInput): Promise<WorkflowRun | null> {
    try {
      const template = await this.resolveTemplate(input.plan);
      if (!template) {
        this.logger.warn(
          `No workflow template found for plan "${input.plan}". Skipping automation for campaign ${input.campaignId}`,
        );
        return null;
      }

      const existingRun = await this.prisma.workflowRun.findFirst({
        where: {
          campaignId: input.campaignId,
          status: {
            in: [WorkflowRunStatus.PENDING, WorkflowRunStatus.ACTIVE, WorkflowRunStatus.PAUSED],
          },
        },
      });

      if (existingRun) {
        this.logger.log(
          `Existing workflow run ${existingRun.id} found for campaign ${input.campaignId}. Reusing run.`,
        );
        return existingRun;
      }

      const metadata = {
        plan: input.plan,
        goals: input.goals ?? [],
        focusKeywords: input.focusKeywords ?? [],
        businessProfile: input.businessProfile ?? null,
        audienceProfile: input.audienceProfile ?? null,
      };

      const run = await this.prisma.workflowRun.create({
        data: {
          campaignId: input.campaignId,
          userId: input.userId,
          templateId: template.id,
          status: WorkflowRunStatus.PENDING,
          progress: 0,
          metadata: this.ensureJsonInput(metadata),
        },
      });

      const steps = (template.steps as unknown as WorkflowStepDefinition[]) ?? [];
      if (!steps.length) {
        this.logger.warn(
          `Template "${template.slug}" has no steps defined. Marking workflow ${run.id} as completed.`,
        );
        await this.prisma.workflowRun.update({
          where: { id: run.id },
          data: {
            status: WorkflowRunStatus.COMPLETED,
            progress: 1,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });
        return run;
      }

      await this.prisma.$transaction(
        steps.map((step) =>
          this.prisma.workflowJob.create({
            data: {
              runId: run.id,
              stepId: step.id,
              queueName: step.queue,
              jobName: step.jobName,
              status: WorkflowJobStatus.PENDING,
              maxAttempts: step.payload?.maxAttempts ?? null,
              payload: step.payload ?? {},
              metadata: {
                stepId: step.id,
                name: step.name,
                description: step.description,
                dependsOn: step.dependsOn ?? [],
                continueOnFail: step.continueOnFail ?? false,
              },
            },
          }),
        ),
      );

      await this.queue.addJob(QueueName.WORKFLOW, WORKFLOW_JOB_NAMES.DISPATCH, {
        runId: run.id,
        reason: 'initial',
      } satisfies WorkflowDispatchJob);

      this.logger.log(
        `Started automation workflow ${run.id} for campaign ${input.campaignId} using template "${template.slug}".`,
      );

      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to start automation for campaign ${input.campaignId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  /**
   * Dispatch workflow jobs whose dependencies are satisfied.
   */
  async dispatchWorkflow(payload: WorkflowDispatchJob) {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: payload.runId },
      include: { jobs: true },
    });

    if (!run) {
      this.logger.warn(`Workflow run ${payload.runId} not found. Skipping dispatch.`);
      return;
    }

    if (run.status === WorkflowRunStatus.PAUSED) {
      this.logger.debug(`Workflow run ${run.id} is paused. Dispatch deferred until resume.`);
      return;
    }

    const completedStatuses = new Set<WorkflowRunStatus>([
      WorkflowRunStatus.CANCELLED,
      WorkflowRunStatus.COMPLETED,
      WorkflowRunStatus.FAILED,
    ]);

    if (completedStatuses.has(run.status)) {
      this.logger.debug(`Workflow run ${run.id} is ${run.status}. No dispatch required.`);
      return;
    }

    if (run.status === WorkflowRunStatus.PENDING) {
      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: WorkflowRunStatus.ACTIVE,
          startedAt: run.startedAt ?? new Date(),
        },
      });
    }

    const jobByStepId = new Map<string, WorkflowJob>();
    run.jobs.forEach((job) => {
      const meta = (job.metadata ?? {}) as Record<string, any>;
      const stepId = (meta.stepId as string) ?? job.id;
      jobByStepId.set(stepId, job);
    });

    const readyJobs = run.jobs.filter((job) => {
      if (job.status !== WorkflowJobStatus.PENDING) {
        return false;
      }

      const meta = (job.metadata ?? {}) as Record<string, any>;
      const dependsOn: string[] = Array.isArray(meta.dependsOn) ? meta.dependsOn : [];
      return dependsOn.every((dependencyId) => {
        const dependencyJob = jobByStepId.get(dependencyId);
        return dependencyJob?.status === WorkflowJobStatus.COMPLETED;
      });
    });

    if (!readyJobs.length) {
      await this.finalizeRunIfComplete(run.id);
      return;
    }

    const now = new Date();

    await this.prisma.$transaction(
      readyJobs.map((job) =>
        this.prisma.workflowJob.update({
          where: { id: job.id },
          data: {
            status: WorkflowJobStatus.QUEUED,
            scheduledFor: now,
          },
        }),
      ),
    );

    for (const job of readyJobs) {
      const meta = (job.metadata ?? {}) as Record<string, any>;
      const queuePayload: WorkflowQueueJobPayload = {
        runId: run.id,
        jobId: job.id,
        stepId: (meta.stepId as string) ?? job.id,
        queue: (job.queueName as QueueName) ?? QueueName.KEYWORDS,
        jobName: job.jobName ?? 'unknown',
        payload: (job.payload ?? {}) as Record<string, any>,
        continueOnFail: Boolean(meta.continueOnFail),
      };

      if (!job.queueName || !job.jobName) {
        throw new Error(`Job ${job.id} is missing required queueName or jobName`);
      }

      await this.queue.addJob(job.queueName, job.jobName, queuePayload);
      this.logger.debug(
        `Queued job ${job.jobName} (${job.id}) in queue "${job.queueName}" for workflow ${run.id}.`,
      );
    }
  }

  /**
   * Execute keyword research job.
   */
  async processKeywordJob(payload: WorkflowQueueJobPayload) {
    await this.markJobRunning(payload);

    try {
      const context = await this.getWorkflowContext(payload.runId);
      if (!context.campaign) {
        throw new Error('Campaign is required for keyword research workflow');
      }
      const campaign = context.campaign; // Extract for type narrowing
      const topic =
        campaign.description ||
        context.businessProfile?.primaryProductOrService ||
        campaign.name;

      const keywordResults = await this.seoService.researchKeywords(topic);
      const keywords = keywordResults.map((item) => item.keyword);

      await Promise.all(
        keywordResults.map((item) =>
          this.prisma.campaignKeyword.upsert({
            where: {
              campaignId_keyword: {
                campaignId: campaign.id,
                keyword: item.keyword,
              },
            },
            update: {
              score: item.difficulty,
              searchVolume: item.volume,
              competition: this.parseCompetitionScore(item.competition),
              costPerClick: item.cpc,
              metadata: this.ensureJsonInput({ trends: item.trends }),
              status: CampaignKeywordStatus.COMPLETED,
            },
            create: {
              campaignId: campaign.id,
              keyword: item.keyword,
              score: item.difficulty,
              searchVolume: item.volume,
              competition: this.parseCompetitionScore(item.competition),
              costPerClick: item.cpc,
              metadata: this.ensureJsonInput({ trends: item.trends }),
              status: CampaignKeywordStatus.COMPLETED,
            },
          }),
        ),
      );

      await this.mergeRunMetadata(context.runId, {
        focusKeywords: this.mergeUniqueStrings(context.focusKeywords, keywords, 15),
      });

      await this.markJobCompleted(payload, {
        keywordsGenerated: keywords.length,
        keywords,
      });
    } catch (error) {
      await this.handleJobFailure(payload, error);
    }
  }

  /**
   * Execute long-form content generation job.
   */
  async processContentJob(payload: WorkflowQueueJobPayload) {
    await this.markJobRunning(payload);

    try {
      const context = await this.getWorkflowContext(payload.runId);
      if (!context.campaign) {
        throw new Error('Campaign is required for content generation workflow');
      }
      const campaign = context.campaign; // Extract for type narrowing
      const focusKeywords =
        context.focusKeywords.length > 0
          ? context.focusKeywords
          : await this.getTopKeywords(campaign.id);
      const topic =
        campaign.description || focusKeywords[0] || `${campaign.name} campaign`;

      const result = await this.aiService.generateBlogPost(context.user.id, topic, {
        keywords: focusKeywords,
        tone: context.businessProfile?.brandVoice ?? 'professional',
        campaignId: campaign.id,
      });

      const contentId = result.data?.id;

      if (contentId) {
        await this.prisma.campaignAsset.create({
          data: {
            campaignId: campaign.id,
            userId: context.user.id,
            assetType: CampaignAssetType.CONTENT,
            sourceType: 'AI_CONTENT',
            sourceId: contentId,
            title: result.data?.title ?? `${campaign.name} long-form content`,
            status: CampaignAssetStatus.READY,
            metadata: this.ensureJsonInput({
              keywords: focusKeywords,
              prompt: result.data?.prompt,
              tokensUsed: result.usage?.tokensUsed ?? 0,
              cost: result.usage?.cost ?? 0,
            }),
          },
        });
      }

      await this.markJobCompleted(payload, {
        contentId,
        tokensUsed: result.usage?.tokensUsed,
        cost: result.usage?.cost,
      });
    } catch (error) {
      await this.handleJobFailure(payload, error);
    }
  }

  /**
   * Execute creative (image) generation job.
   */
  async processImageJob(payload: WorkflowQueueJobPayload) {
    await this.markJobRunning(payload);

    try {
      const context = await this.getWorkflowContext(payload.runId);
      if (!context.campaign) {
        throw new Error('Campaign is required for image generation workflow');
      }
      const campaign = context.campaign; // Extract for type narrowing
      const focusKeywords =
        context.focusKeywords.length > 0
          ? context.focusKeywords
          : await this.getTopKeywords(campaign.id);

      const promptParts: string[] = [
        `Marketing campaign visuals for ${context.businessProfile?.companyName ?? campaign.name}`,
      ];

      if (context.businessProfile?.industry) {
        promptParts.push(`Industry: ${context.businessProfile.industry}`);
      }
      if (context.audienceProfile?.description) {
        promptParts.push(`Target audience: ${context.audienceProfile.description}`);
      }
      if (focusKeywords.length) {
        promptParts.push(`Highlight concepts: ${focusKeywords.slice(0, 5).join(', ')}`);
      }
      if (context.businessProfile?.brandVoice) {
        promptParts.push(`Brand tone: ${context.businessProfile.brandVoice}`);
      }

      const prompt = promptParts.join('. ');

      const imageResult = await this.imageService.generateImages(prompt, {
        n: 3,
        size: '1024x1024',
      });

      const assets = await Promise.all(
        (imageResult.images ?? []).map((image, index) =>
          this.prisma.campaignAsset.create({
            data: {
              campaignId: campaign.id,
              userId: context.user.id,
              assetType: CampaignAssetType.IMAGE,
              sourceType: 'AI_IMAGE',
              sourceId: image.url ?? image.b64_json ?? undefined,
              title: `${campaign.name} creative ${index + 1}`,
              url: image.url,
              status: CampaignAssetStatus.READY,
              metadata: this.ensureJsonInput({
                prompt,
                revisedPrompt: image.revised_prompt,
                tokensUsed: imageResult.tokensUsed,
                cost: imageResult.cost,
              }),
            },
          }),
        ),
      );

      await this.markJobCompleted(payload, {
        prompt,
        generatedImages: assets.length,
      });
    } catch (error) {
      await this.handleJobFailure(payload, error);
    }
  }

  /**
   * Execute social calendar generation job.
   */
  async processSocialJob(payload: WorkflowQueueJobPayload) {
    await this.markJobRunning(payload);

    try {
      const context = await this.getWorkflowContext(payload.runId);
      if (!context.campaign) {
        throw new Error('Campaign is required for social media workflow');
      }
      const campaign = context.campaign; // Extract for type narrowing
      const focusKeywords =
        context.focusKeywords.length > 0
          ? context.focusKeywords
          : await this.getTopKeywords(campaign.id);

      const platforms: string[] = Array.isArray(payload.payload?.platforms)
        ? payload.payload.platforms
        : ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN'];

      const generated: string[] = [];
      const scheduledPosts: Array<{ platform: string; postId: string }> = [];

      for (const platform of platforms) {
        const response = await this.aiService.generateSocialContent(
          context.user.id,
          platform,
          campaign.id,
          {
            campaignId: campaign.id,
            keywords: focusKeywords,
            goals: context.goals,
            tone: context.businessProfile?.brandVoice ?? 'engaging',
            scheduledAt: null,
          },
        );

        if (response.success && response.data) {
          generated.push(platform);
          scheduledPosts.push({ platform, postId: response.data.id });
          await this.prisma.campaignAsset.create({
            data: {
              campaignId: campaign.id,
              userId: context.user.id,
              assetType: CampaignAssetType.SOCIAL_POST,
              sourceType: 'SOCIAL_POST',
              sourceId: response.data.id,
              title: `${platform} post`,
              status: CampaignAssetStatus.READY,
              metadata: this.ensureJsonInput({
                platform,
                keywords: focusKeywords,
                engagement: response.engagement,
              }),
            },
          });
        }
      }

      const scheduledResults = await this.scheduleSocialPublications(context, scheduledPosts);

      await this.markJobCompleted(payload, {
        platformsGenerated: generated,
        scheduled: scheduledResults,
      });
    } catch (error) {
      await this.handleJobFailure(payload, error);
    }
  }

  private async scheduleSocialPublications(
    context: WorkflowContext,
    posts: Array<{ platform: string; postId: string }>,
  ) {
    if (!posts.length) {
      return [];
    }

    const summaries: Array<{
      platform: string;
      accountsScheduled: number;
      postId: string;
      scheduledAt: string | null;
    }> = [];

    for (const { platform, postId } of posts) {
      const post = await this.prisma.socialPost.findUnique({
        where: { id: postId },
        include: { campaign: true },
      });

      if (!post) {
        summaries.push({
          platform,
          accountsScheduled: 0,
          postId,
          scheduledAt: null,
        });
        continue;
      }

      const accounts = await this.prisma.socialMediaAccount.findMany({
        where: {
          userId: context.user.id,
          platform: platform as any,
          isActive: true,
        },
      });

      if (accounts.length === 0) {
        this.logger.warn(
          `No connected ${platform} accounts for user ${context.user.id}. Post ${postId} remains in draft.`,
        );
        summaries.push({
          platform,
          accountsScheduled: 0,
          postId,
          scheduledAt: null,
        });
        continue;
      }

      const optimal = await this.socialAutomation.getOptimalPostingTime(
        context.user.id,
        platform,
      );
      const scheduledDate = optimal?.datetime ?? new Date();
      const delay = Math.max(scheduledDate.getTime() - Date.now(), 0);

      await this.prisma.socialPost.update({
        where: { id: postId },
        data: {
          scheduledAt: scheduledDate,
          autoScheduled: true,
          status: PostStatus.SCHEDULED,
          performanceData: this.ensureJsonInput({
            ...(post.performanceData as Record<string, any> | undefined),
            scheduledByWorkflow: context.runId,
            scheduledReasoning: optimal?.reasoning,
          }),
        },
      });

      for (const account of accounts) {
        const stepId = `publish.${platform.toLowerCase()}.${account.id}.${postId}`;
        const job = await this.prisma.workflowJob.create({
          data: {
            runId: context.runId,
            stepId: stepId,
            queueName: QueueName.SOCIAL,
            jobName: 'social.publish',
            status: WorkflowJobStatus.QUEUED,
            scheduledFor: scheduledDate,
            metadata: this.ensureJsonInput({
              stepId,
              platform,
              accountId: account.id,
              accountUsername: account.username,
              continueOnFail: true,
            }),
            payload: this.ensureJsonInput({
              platform,
              postId,
              accountId: account.id,
            }),
          },
        });

        await this.queue.addJob(
          QueueName.SOCIAL,
          'social.publish',
          {
            runId: context.runId,
            jobId: job.id,
            stepId,
            queue: QueueName.SOCIAL,
            jobName: 'social.publish',
            payload: {
              platform,
              postId,
              accountId: account.id,
            },
            continueOnFail: true,
            postId,
            accountId: account.id,
            scheduledAt: scheduledDate.toISOString(),
          } satisfies SocialPublishJobPayload,
          {
            delay,
          },
        );
      }

      summaries.push({
        platform,
        accountsScheduled: accounts.length,
        postId,
        scheduledAt: scheduledDate.toISOString(),
      });

      await this.updateRunProgress(context.runId);
    }

    return summaries;
  }

  async processSocialPublishJob(payload: SocialPublishJobPayload) {
    await this.markJobRunning(payload);

    try {
      const [post, account, run] = await Promise.all([
        this.prisma.socialPost.findUnique({
          where: { id: payload.postId },
          include: {
            user: true,
            campaign: true,
          },
        }),
        this.prisma.socialMediaAccount.findUnique({
          where: { id: payload.accountId },
        }),
        this.prisma.workflowRun.findUnique({
          where: { id: payload.runId },
          include: { campaign: true, user: true, jobs: true },
        }),
      ]);

      if (!post) {
        throw new Error(`Social post ${payload.postId} not found`);
      }
      if (!account) {
        throw new Error(`Social media account ${payload.accountId} not found`);
      }
      if (!account.accessToken) {
        throw new Error(`No access token stored for account ${payload.accountId}`);
      }
    if (!account.platformUserId) {
      throw new Error(`Account ${payload.accountId} is missing platform user identifier`);
    }

      const platform = account.platform;
      const postText = this.buildSocialPostText(post);
      const mediaUrls = this.parseMediaUrls(post.mediaUrls);

      let publishResponse: any;

      switch (platform) {
        case 'LINKEDIN': {
          const authorUrn = this.buildLinkedInAuthorUrn(account.platformUserId);
          publishResponse = await this.linkedinService.publishPost(account.accessToken, {
            authorUrn,
            text: postText,
            media:
              mediaUrls.length > 0
                ? mediaUrls.map((url) => ({
                    media: url,
                    status: 'READY',
                    description: post.caption ?? undefined,
                    title: post.campaignId ? post.campaignId : undefined,
                  }))
                : undefined,
            visibility: 'PUBLIC',
          });
          break;
        }
        case 'FACEBOOK': {
          publishResponse = await this.facebookService.publishPagePost(account.accessToken, account.platformUserId, {
            message: postText,
            imageUrl: mediaUrls[0],
            scheduledPublishTime: payload.scheduledAt ? new Date(payload.scheduledAt) : undefined,
          });
          break;
        }
        case 'INSTAGRAM': {
          if (mediaUrls.length === 0) {
            throw new Error('Instagram posts require at least one media asset');
          }
          publishResponse = await this.instagramService.publishPost(
            account.accessToken,
            account.platformUserId,
            {
              caption: postText,
              imageUrl: mediaUrls[0],
              scheduledPublishTime: payload.scheduledAt ? new Date(payload.scheduledAt) : undefined,
            },
          );
          break;
        }
        case 'TWITTER': {
          publishResponse = await this.twitterService.postTweet(postText, {});
          break;
        }
        default:
          throw new Error(`Unsupported platform ${platform} for automated publishing`);
      }

      const platformPostId =
        publishResponse?.id ||
        publishResponse?.post_id ||
        publishResponse?.postId ||
        publishResponse?.updateUrl ||
        publishResponse?.tweetId ||
        null;

      await this.prisma.socialPost.update({
        where: { id: post.id },
        data: {
          status: PostStatus.PUBLISHED,
          postedAt: new Date(),
          platformPostId,
          performanceData: this.ensureJsonInput({
            ...(post.performanceData as Record<string, any> | undefined),
            publishedAt: new Date().toISOString(),
            publishedViaAccount: account.username,
            publishResponse,
          }),
        },
      });

      await this.markJobCompleted(payload, {
        platform,
        accountId: account.id,
        postId: post.id,
        platformPostId,
      });

      if (run) {
        await this.notifications.notifyWorkflowUpdate({
          runId: payload.runId,
          jobId: payload.jobId,
          campaignName: run.campaign?.name,
          userEmail: run.user?.email,
          message: `Published ${platform} post for campaign ${run.campaign?.name ?? ''}`,
          severity: 'info',
        });
      }
    } catch (error) {
      await this.handleJobFailure(payload, error);
    }
  }

  private buildSocialPostText(post: any): string {
    const sections: string[] = [];
    if (post.content) {
      sections.push(post.content.trim());
    }
    if (post.caption && post.caption.trim().length > 0) {
      sections.push(post.caption.trim());
    }
    if (post.hashtags) {
      const tags = post.hashtags
        .split(/\s+/)
        .map((tag: string) => tag.trim())
        .filter(Boolean)
        .map((tag: string) => (tag.startsWith('#') ? tag : `#${tag}`));
      if (tags.length > 0) {
        sections.push(tags.join(' '));
      }
    }
    return sections.join('\n\n').trim();
  }

  private parseMediaUrls(mediaUrls?: string | null): string[] {
    if (!mediaUrls) {
      return [];
    }

    return mediaUrls
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url.length > 0);
  }

  private buildLinkedInAuthorUrn(platformUserId?: string | null): string {
    if (!platformUserId) {
      throw new Error('LinkedIn account is missing platform user identifier');
    }

    const trimmed = platformUserId.trim();
    if (trimmed.startsWith('urn:')) {
      return trimmed;
    }

    // Default to organization URN unless explicitly prefixed
    if (/^\d+$/.test(trimmed)) {
      return `urn:li:organization:${trimmed}`;
    }

    return `urn:li:organization:${trimmed}`;
  }

  /**
   * Execute outreach content generation job.
   */
  async processOutreachJob(payload: WorkflowQueueJobPayload) {
    await this.markJobRunning(payload);

    try {
      const context = await this.getWorkflowContext(payload.runId);
      if (!context.campaign) {
        throw new Error('Campaign is required for outreach workflow');
      }
      const campaign = context.campaign; // Extract for type narrowing
      const focusKeywords =
        context.focusKeywords.length > 0
          ? context.focusKeywords
          : await this.getTopKeywords(campaign.id);

      const prospectMessage = await this.aiService.generateEmailContent(
        context.user.id,
        'prospecting outreach',
        'qualified lead',
        {
          campaignId: campaign.id,
          keywords: focusKeywords,
          tone: context.businessProfile?.brandVoice ?? 'consultative',
          offers: context.goals,
        },
      );

      const asset = await this.prisma.campaignAsset.create({
        data: {
          campaignId: campaign.id,
          userId: context.user.id,
          assetType: CampaignAssetType.DOCUMENT,
          sourceType: 'AI_EMAIL',
          sourceId: prospectMessage.data?.id,
          title: `${campaign.name} outreach sequence`,
          status: CampaignAssetStatus.READY,
          metadata: this.ensureJsonInput({
            purpose: 'outreach',
            keywords: focusKeywords,
            tokensUsed: prospectMessage.usage?.tokensUsed,
            cost: prospectMessage.usage?.cost,
            rawContent: prospectMessage.data?.content,
          }),
        },
      });

      await this.markJobCompleted(payload, {
        outreachAssetId: asset.id,
      });
    } catch (error) {
      await this.handleJobFailure(payload, error);
    }
  }

  /**
   * Execute analytics configuration job.
   */
  async processAnalyticsJob(payload: WorkflowQueueJobPayload) {
    await this.markJobRunning(payload);

    try {
      const context = await this.getWorkflowContext(payload.runId);
      if (!context.campaign) {
        throw new Error('Campaign is required for analytics workflow');
      }
      const campaign = context.campaign; // Extract for type narrowing
      const analytics = await this.aiService.getAnalytics(context.user.id, campaign.id);

      const asset = await this.prisma.campaignAsset.create({
        data: {
          campaignId: campaign.id,
          userId: context.user.id,
          assetType: CampaignAssetType.DATASET,
          sourceType: 'AI_ANALYTICS',
          title: `${campaign.name} analytics setup`,
          status: CampaignAssetStatus.READY,
          metadata: this.ensureJsonInput({
            analytics,
            configuredAt: new Date().toISOString(),
          }),
        },
      });

      await this.markJobCompleted(payload, {
        analyticsAssetId: asset.id,
      });
    } catch (error) {
      await this.handleJobFailure(payload, error);
    }
  }

  async listRuns(user: AuthenticatedUser, status?: WorkflowRunStatus) {
    const where: Prisma.WorkflowRunWhereInput = {};

    if (!this.isAdmin(user)) {
      where.userId = user.sub;
    }

    if (status) {
      where.status = status;
    }

    const runs = await this.prisma.workflowRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        campaign: { select: { id: true, name: true } },
        jobs: {
          select: {
            id: true,
            status: true,
            jobName: true,
            queueName: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return runs.map((run) => {
      const totalJobs = run.jobs.length;
      const failedJobs = run.jobs.filter((job) => job.status === WorkflowJobStatus.FAILED).length;
      const queuedJobs = run.jobs.filter((job) => job.status === WorkflowJobStatus.QUEUED).length;

      return {
        id: run.id,
        status: run.status,
        progress: run.progress ?? 0,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        pausedAt: run.pausedAt,
        campaign: run.campaign,
        templateId: run.templateId,
        totalJobs,
        failedJobs,
        queuedJobs,
        metadata: run.metadata,
        createdAt: run.createdAt,
      };
    });
  }

  async getRunById(runId: string, user: AuthenticatedUser) {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      include: {
        campaign: { select: { id: true, name: true } },
        user: { select: { id: true, email: true } },
        jobs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    this.ensureRunAccess(run, user);

    return run;
  }

  async pauseRun(runId: string, user: AuthenticatedUser) {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    this.ensureRunAccess(run, user);

    if (
      run.status === WorkflowRunStatus.COMPLETED ||
      run.status === WorkflowRunStatus.CANCELLED ||
      run.status === WorkflowRunStatus.FAILED
    ) {
      throw new ForbiddenException('Cannot pause a terminal workflow run');
    }

    return this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: WorkflowRunStatus.PAUSED,
        pausedAt: new Date(),
      },
    });
  }

  async resumeRun(runId: string, user: AuthenticatedUser) {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException(`Workflow run ${runId} not found`);
    }

    this.ensureRunAccess(run, user);

    if (run.status !== WorkflowRunStatus.PAUSED) {
      throw new ForbiddenException('Only paused workflows can be resumed');
    }

    const updated = await this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: WorkflowRunStatus.ACTIVE,
        pausedAt: null,
        startedAt: run.startedAt ?? new Date(),
      },
    });

    try {
      await this.queue.addJob(QueueName.WORKFLOW, WORKFLOW_JOB_NAMES.DISPATCH, {
        runId,
        reason: 'manual',
      } satisfies WorkflowDispatchJob);
      this.logger.log(`Successfully queued dispatch job for workflow run ${runId}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue dispatch job for workflow run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Still return the updated run even if queueing fails
      // The workflow can be manually triggered later if needed
    }

    return updated;
  }

  async retryJob(jobId: string, user: AuthenticatedUser) {
    const job = await this.prisma.workflowJob.findUnique({
      where: { id: jobId },
      include: {
        run: true,
      },
    });

    if (!job || !job.run) {
      throw new NotFoundException(`Workflow job ${jobId} not found`);
    }

    this.ensureRunAccess(job.run, user);

    if (
      job.status !== WorkflowJobStatus.FAILED &&
      job.status !== WorkflowJobStatus.CANCELLED &&
      job.status !== WorkflowJobStatus.SKIPPED
    ) {
      throw new ForbiddenException('Only failed, cancelled, or skipped jobs can be retried');
    }

    const metadata = (job.metadata ?? {}) as Record<string, any>;
    const payloadData =
      job.payload && typeof job.payload === 'object'
        ? (job.payload as Record<string, any>)
        : {};
    const stepId = metadata.stepId ?? job.id;
    const continueOnFail = Boolean(metadata.continueOnFail);

    const updatedJob = await this.prisma.workflowJob.update({
      where: { id: job.id },
      data: {
        status: WorkflowJobStatus.QUEUED,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        scheduledFor: new Date(),
        attempts: 0,
      },
    });

    if (!job.queueName || !job.jobName) {
      throw new Error(`Job ${job.id} is missing required queueName or jobName for retry`);
    }

    try {
      await this.queue.addJob(
        job.queueName,
        job.jobName,
        {
          runId: job.runId,
          jobId: job.id,
          stepId,
          queue: job.queueName as QueueName,
          jobName: job.jobName,
          payload: payloadData,
          continueOnFail,
        },
        {
          delay: 0,
        },
      );
      this.logger.log(`Successfully queued retry job ${job.id} for workflow run ${job.runId}`);
    } catch (error) {
      this.logger.error(
        `Failed to queue retry job ${job.id} for workflow run ${job.runId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Revert the job status back to failed if queueing fails
      await this.prisma.workflowJob.update({
        where: { id: job.id },
        data: {
          status: WorkflowJobStatus.FAILED,
          errorMessage: `Failed to queue job: ${error instanceof Error ? error.message : String(error)}`,
          failedAt: new Date(),
        },
      });
      throw new InternalServerErrorException(`Failed to queue retry job: ${error instanceof Error ? error.message : String(error)}`);
    }

    await this.updateRunProgress(job.runId);

    return updatedJob;
  }

  private ensureRunAccess(run: { userId: string }, user: AuthenticatedUser) {
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (this.isAdmin(user)) {
      return;
    }

    if (run.userId !== user.sub) {
      throw new ForbiddenException('You do not have access to this workflow');
    }
  }

  private isAdmin(user?: AuthenticatedUser) {
    return user?.role === 'ADMIN';
  }

  /**
   * Synchronize default templates with database.
   */
  private async syncTemplates() {
    await Promise.all(
      DEFAULT_WORKFLOW_TEMPLATES.map((template) =>
        this.prisma.campaignWorkflowTemplate.upsert({
          where: { slug: template.slug },
          update: {
            name: template.name,
            description: template.description,
            plan: template.plan,
            isActive: true,
            steps: this.ensureJsonInput(template.steps),
            metadata: this.ensureJsonInput(template.metadata),
          },
          create: {
            slug: template.slug,
            name: template.name,
            description: template.description,
            plan: template.plan,
            steps: this.ensureJsonInput(template.steps),
            metadata: this.ensureJsonInput(template.metadata),
          },
        }),
      ),
    );
  }

  private async resolveTemplate(plan: string): Promise<CampaignWorkflowTemplate | null> {
    if (!plan) {
      return this.prisma.campaignWorkflowTemplate.findFirst({
        where: { slug: AUTOMATION_TEMPLATE_SLUGS.PRO, isActive: true },
      });
    }

    const template = await this.prisma.campaignWorkflowTemplate.findFirst({
      where: {
        isActive: true,
        OR: [{ plan: plan.toLowerCase() }, { slug: plan.toLowerCase() }],
      },
    });

    if (template) {
      return template;
    }

    return this.prisma.campaignWorkflowTemplate.findFirst({
      where: { slug: AUTOMATION_TEMPLATE_SLUGS.PRO, isActive: true },
    });
  }

  private async getWorkflowContext(runId: string): Promise<WorkflowContext> {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      include: {
        campaign: true,
        user: true,
        jobs: true,
      },
    });

    if (!run) {
      throw new Error(`Workflow run ${runId} not found`);
    }

    const metadata = ((run.metadata ?? {}) as Record<string, any>) || {};

    return {
      runId,
      campaign: run.campaign ? {
        id: run.campaign.id,
        name: run.campaign.name,
        type: run.campaign.type,
        plan: run.campaign.plan ?? null,
        description: run.campaign.description,
        settings: run.campaign.settings as Record<string, any> | null,
      } : null,
      user: {
        id: run.user.id,
        email: run.user.email,
        name: run.user.name,
        company: run.user.company,
      },
      goals: Array.isArray(metadata.goals) ? metadata.goals : [],
      focusKeywords: Array.isArray(metadata.focusKeywords) ? metadata.focusKeywords : [],
      businessProfile: metadata.businessProfile ?? undefined,
      audienceProfile: metadata.audienceProfile ?? undefined,
    };
  }

  private async mergeRunMetadata(runId: string, updates: Record<string, any>) {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      select: { metadata: true },
    });

    const existing = ((run?.metadata ?? {}) as Record<string, any>) || {};
    const merged = {
      ...existing,
      ...updates,
    };

    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        metadata: this.ensureJsonInput(merged),
      },
    });
  }

  private mergeUniqueStrings(base: string[], additions: string[], limit?: number) {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const value of [...base, ...additions]) {
      const normalized = value.trim();
      if (!normalized) continue;
      if (seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      merged.push(normalized);
      if (limit && merged.length >= limit) break;
    }

    return merged;
  }

  private parseCompetitionScore(value: unknown): number | null {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      if (normalized.includes('high')) return 0.85;
      if (normalized.includes('medium')) return 0.6;
      if (normalized.includes('low')) return 0.3;
      const parsed = Number.parseFloat(normalized);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private ensureJsonInput(
    value: any,
  ): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
    if (value === undefined || value === null) {
      return Prisma.JsonNull;
    }

    if (value instanceof Date) {
      return value.toISOString() as Prisma.InputJsonValue;
    }

    if (Array.isArray(value)) {
      return value.map((item) =>
        item instanceof Date ? item.toISOString() : item,
      ) as Prisma.InputJsonValue;
    }

    if (typeof value === 'object') {
      const transformed: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        if (val instanceof Date) {
          transformed[key] = val.toISOString();
        } else if (Array.isArray(val)) {
          transformed[key] = val.map((entry) =>
            entry instanceof Date ? entry.toISOString() : entry,
          );
        } else {
          transformed[key] = val;
        }
      }
      return transformed as Prisma.InputJsonValue;
    }

    return value as Prisma.InputJsonValue;
  }

  private async markJobRunning(payload: WorkflowQueueJobPayload) {
    await this.prisma.workflowJob.update({
      where: { id: payload.jobId },
      data: {
        status: WorkflowJobStatus.RUNNING,
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  }

  private async markJobCompleted(payload: WorkflowQueueJobPayload, result?: Record<string, any>) {
    await this.prisma.workflowJob.update({
      where: { id: payload.jobId },
      data: {
        status: WorkflowJobStatus.COMPLETED,
        completedAt: new Date(),
        result: this.ensureJsonInput(result ?? {}),
      },
    });

    await this.updateRunProgress(payload.runId);

    await this.queue.addJob(QueueName.WORKFLOW, WORKFLOW_JOB_NAMES.DISPATCH, {
      runId: payload.runId,
      reason: 'job-completed',
    } satisfies WorkflowDispatchJob);
  }

  private async handleJobFailure(payload: WorkflowQueueJobPayload, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    await this.prisma.workflowJob.update({
      where: { id: payload.jobId },
      data: {
        status: WorkflowJobStatus.FAILED,
        failedAt: new Date(),
        errorMessage: message,
        error: stack,
      },
    });

    await this.updateRunProgress(payload.runId);

    const run = await this.prisma.workflowRun.findUnique({
      where: { id: payload.runId },
      include: { campaign: true, user: true },
    });

    if (run) {
      await this.notifications.notifyWorkflowFailure({
        runId: payload.runId,
        jobId: payload.jobId,
        campaignName: run.campaign?.name,
        userEmail: run.user?.email,
        message: message,
        errorStack: stack,
        severity: payload.continueOnFail ? 'warning' : 'critical',
      });
    }

    if (payload.continueOnFail) {
      this.logger.warn(
        `Job ${payload.jobName} (${payload.jobId}) failed but is marked continueOnFail. Dispatching next steps.`,
      );
      await this.queue.addJob(QueueName.WORKFLOW, WORKFLOW_JOB_NAMES.DISPATCH, {
        runId: payload.runId,
        reason: 'job-completed',
      } satisfies WorkflowDispatchJob);
    } else {
      await this.prisma.workflowRun.update({
        where: { id: payload.runId },
        data: {
          status: WorkflowRunStatus.FAILED,
          completedAt: new Date(),
        },
      });
      this.logger.error(
        `Job ${payload.jobName} (${payload.jobId}) failed. Marked workflow ${payload.runId} as FAILED. Error: ${message}`,
        stack,
      );
    }

    throw error;
  }

  private async updateRunProgress(runId: string) {
    const [jobs, run] = await Promise.all([
      this.prisma.workflowJob.findMany({
        where: { runId },
        select: { status: true },
      }),
      this.prisma.workflowRun.findUnique({
        where: { id: runId },
        select: { metadata: true },
      }),
    ]);

    if (!jobs.length) {
      return;
    }

    const total = jobs.length;
    const completed = jobs.filter((job) => job.status === WorkflowJobStatus.COMPLETED).length;
    const failed = jobs.filter((job) => job.status === WorkflowJobStatus.FAILED).length;

    const progress = completed / total;

    const metadata = {
      ...(((run?.metadata ?? {}) as Record<string, any>) || {}),
      totalJobs: total,
      completedJobs: completed,
      failedJobs: failed,
    };

    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        progress,
        metadata: this.ensureJsonInput(metadata),
      },
    });

    if (completed === total) {
      await this.prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: WorkflowRunStatus.COMPLETED,
          completedAt: new Date(),
          progress: 1,
        },
      });
    }
  }

  private async finalizeRunIfComplete(runId: string) {
    const jobs = await this.prisma.workflowJob.findMany({
      where: { runId },
      select: { status: true },
    });

    if (!jobs.length) {
      return;
    }

    const allCompleted = jobs.every((job) => job.status === WorkflowJobStatus.COMPLETED);
    const anyFailed = jobs.some((job) => job.status === WorkflowJobStatus.FAILED);

    if (allCompleted) {
      await this.prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: WorkflowRunStatus.COMPLETED,
          completedAt: new Date(),
          progress: 1,
        },
      });
    } else if (anyFailed) {
      await this.prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: WorkflowRunStatus.FAILED,
          completedAt: new Date(),
        },
      });
    }
  }

  private async getTopKeywords(campaignId: string, limit = 10): Promise<string[]> {
    const keywords = await this.prisma.campaignKeyword.findMany({
      where: { campaignId },
      orderBy: [
        { score: 'desc' },
        { searchVolume: 'desc' },
      ],
      take: limit,
      select: { keyword: true },
    });

    return keywords.map((item) => item.keyword);
  }
}


