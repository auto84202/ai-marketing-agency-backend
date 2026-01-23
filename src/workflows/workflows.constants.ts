import { QueueName } from '../queue/queue.constants';

export const WORKFLOW_JOB_NAMES = {
  DISPATCH: 'workflow.dispatch',
  REFRESH: 'workflow.refresh',
};

export const AUTOMATION_TEMPLATE_SLUGS = {
  PRO: 'pro-campaign-automation',
};

export const WORKFLOW_QUEUE_SEQUENCE: QueueName[] = [
  QueueName.KEYWORDS,
  QueueName.CONTENT,
  QueueName.IMAGE,
  QueueName.SOCIAL,
  QueueName.OUTREACH,
  QueueName.ANALYTICS,
];

