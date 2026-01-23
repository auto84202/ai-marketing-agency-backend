import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService } from '../queue/queue.service';
import { QueueName } from '../queue/queue.constants';
import { WorkflowsService } from './workflows.service';
import {
  WorkflowQueueJobPayload,
  WorkflowDispatchJob,
  SocialPublishJobPayload,
} from './workflows.interfaces';
import { WORKFLOW_JOB_NAMES } from './workflows.constants';

@Injectable()
export class WorkflowProcessor implements OnModuleInit {
  private readonly logger = new Logger(WorkflowProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly workflowsService: WorkflowsService,
  ) {}

  onModuleInit() {
    this.registerWorkflowWorker();
    this.registerKeywordWorker();
    this.registerContentWorker();
    this.registerImageWorker();
    this.registerSocialWorker();
    this.registerOutreachWorker();
    this.registerAnalyticsWorker();
  }

  private registerWorkflowWorker() {
    this.queueService.createWorker<WorkflowDispatchJob>(
      QueueName.WORKFLOW,
      async (job) => {
        if (job.name === WORKFLOW_JOB_NAMES.DISPATCH) {
          await this.workflowsService.dispatchWorkflow(job.data);
        } else if (job.name === WORKFLOW_JOB_NAMES.REFRESH) {
          await this.workflowsService.dispatchWorkflow({
            runId: job.data.runId,
            reason: 'manual',
          });
        } else {
          this.logger.warn(`Unknown workflow job name "${job.name}". Skipping.`);
        }
      },
      { concurrency: 2 },
    );
  }

  private registerKeywordWorker() {
    this.queueService.createWorker<WorkflowQueueJobPayload>(
      QueueName.KEYWORDS,
      (job) => this.safeProcess(job, this.workflowsService.processKeywordJob.bind(this.workflowsService)),
      { concurrency: 1 },
    );
  }

  private registerContentWorker() {
    this.queueService.createWorker<WorkflowQueueJobPayload>(
      QueueName.CONTENT,
      (job) => this.safeProcess(job, this.workflowsService.processContentJob.bind(this.workflowsService)),
      { concurrency: 1 },
    );
  }

  private registerImageWorker() {
    this.queueService.createWorker<WorkflowQueueJobPayload>(
      QueueName.IMAGE,
      (job) => this.safeProcess(job, this.workflowsService.processImageJob.bind(this.workflowsService)),
      { concurrency: 1 },
    );
  }

  private registerSocialWorker() {
    this.queueService.createWorker<WorkflowQueueJobPayload>(
      QueueName.SOCIAL,
      (job) =>
        this.safeProcess(job, async (payload) => {
          if (job.name === 'social.publish') {
            await this.workflowsService.processSocialPublishJob(
              payload as SocialPublishJobPayload,
            );
          } else {
            await this.workflowsService.processSocialJob(payload);
          }
        }),
      { concurrency: 2 },
    );
  }

  private registerOutreachWorker() {
    this.queueService.createWorker<WorkflowQueueJobPayload>(
      QueueName.OUTREACH,
      (job) => this.safeProcess(job, this.workflowsService.processOutreachJob.bind(this.workflowsService)),
      { concurrency: 1 },
    );
  }

  private registerAnalyticsWorker() {
    this.queueService.createWorker<WorkflowQueueJobPayload>(
      QueueName.ANALYTICS,
      (job) => this.safeProcess(job, this.workflowsService.processAnalyticsJob.bind(this.workflowsService)),
      { concurrency: 1 },
    );
  }

  private async safeProcess(
    job: Job<WorkflowQueueJobPayload>,
    handler: (payload: WorkflowQueueJobPayload) => Promise<void>,
  ) {
    try {
      await handler(job.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Job "${job.name}" failed for workflow ${job.data?.runId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }
}

