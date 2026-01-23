import { QueueName } from '../../queue/queue.constants';
import { AUTOMATION_TEMPLATE_SLUGS } from '../workflows.constants';
import { WorkflowTemplateDefinition } from '../workflows.interfaces';

export const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    slug: AUTOMATION_TEMPLATE_SLUGS.PRO,
    name: 'Pro Campaign Automation',
    plan: 'pro',
    description:
      'Full automation pipeline for pro-tier campaigns. Generates keywords, content, creatives, social posts, outreach scripts, and analytics setup automatically.',
    metadata: {
      version: '1.0.0',
      createdBy: 'system',
    },
    steps: [
      {
        id: 'collect_keywords',
        name: 'Collect Keyword Intelligence',
        description: 'Research and store targeted keywords for the campaign.',
        queue: QueueName.KEYWORDS,
        jobName: 'keywords.generate',
      },
      {
        id: 'generate_long_form_content',
        name: 'Generate Long-form Content',
        description: 'Create cornerstone content using researched keywords.',
        queue: QueueName.CONTENT,
        jobName: 'content.generate',
        dependsOn: ['collect_keywords'],
      },
      {
        id: 'generate_creatives',
        name: 'Generate Visual Creatives',
        description: 'Produce campaign visuals informed by the business profile and content.',
        queue: QueueName.IMAGE,
        jobName: 'image.generate',
        dependsOn: ['generate_long_form_content'],
      },
      {
        id: 'prepare_social_calendar',
        name: 'Prepare Social Media Calendar',
        description: 'Create platform-specific posts and schedule recommendations.',
        queue: QueueName.SOCIAL,
        jobName: 'social.generate',
        dependsOn: ['collect_keywords', 'generate_long_form_content', 'generate_creatives'],
        payload: {
          platforms: ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'TWITTER'],
        },
      },
      {
        id: 'launch_prospect_outreach',
        name: 'Launch Prospect Outreach',
        description: 'Craft outreach messaging for interested prospects based on keywords and content.',
        queue: QueueName.OUTREACH,
        jobName: 'outreach.execute',
        dependsOn: ['collect_keywords', 'generate_long_form_content'],
      },
      {
        id: 'setup_analytics',
        name: 'Setup Analytics & Monitoring',
        description: 'Create analytics plan and monitoring cadence for continuous optimization.',
        queue: QueueName.ANALYTICS,
        jobName: 'analytics.configure',
        dependsOn: ['collect_keywords', 'prepare_social_calendar'],
      },
    ],
  },
];

