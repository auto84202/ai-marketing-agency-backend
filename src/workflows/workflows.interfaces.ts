import { CampaignType, WorkflowJobStatus, WorkflowRunStatus } from '@prisma/client';
import { QueueName } from '../queue/queue.constants';

export interface WorkflowStepDefinition {
  id: string;
  name: string;
  description?: string;
  queue: QueueName;
  jobName: string;
  dependsOn?: string[];
  payload?: Record<string, any>;
  continueOnFail?: boolean;
}

export interface WorkflowTemplateDefinition {
  slug: string;
  name: string;
  plan: string;
  description?: string;
  steps: WorkflowStepDefinition[];
  metadata?: Record<string, any>;
}

export interface StartCampaignAutomationInput {
  campaignId: string;
  userId: string;
  plan: string;
  campaignType: CampaignType;
  businessProfile?: Record<string, any>;
  audienceProfile?: Record<string, any>;
  goals?: string[];
  focusKeywords?: string[];
}

export interface WorkflowDispatchJob {
  runId: string;
  reason?: 'initial' | 'job-completed' | 'retry' | 'manual';
}

export interface WorkflowQueueJobPayload {
  runId: string;
  jobId: string;
  stepId: string;
  queue: QueueName;
  jobName: string;
  payload?: Record<string, any>;
  continueOnFail?: boolean;
}

export interface SocialPublishJobPayload extends WorkflowQueueJobPayload {
  postId: string;
  accountId: string;
  scheduledAt?: string;
}

export interface WorkflowContext {
  runId: string;
  campaign: {
    id: string;
    name: string;
    type: CampaignType;
    plan?: string | null;
    description?: string | null;
    settings?: Record<string, any> | null;
  } | null;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    company: string | null;
  };
  goals: string[];
  focusKeywords: string[];
  businessProfile?: Record<string, any>;
  audienceProfile?: Record<string, any>;
}

export interface WorkflowRunSummary {
  id: string;
  status: WorkflowRunStatus;
  progress: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export interface WorkflowJobTransitionInput {
  jobId: string;
  status: WorkflowJobStatus;
  result?: Record<string, any>;
  errorMessage?: string;
  errorStack?: string;
}

