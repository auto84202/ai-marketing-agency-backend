import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';

export interface WorkflowNotificationContext {
  runId: string;
  jobId?: string;
  campaignName?: string | null;
  userEmail?: string | null;
  message: string;
  errorStack?: string;
  severity?: 'info' | 'warning' | 'critical';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly slackWebhook: string | undefined;
  private readonly alertEmails: string[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.slackWebhook = this.config.get<string>('SLACK_WEBHOOK_URL') || undefined;
    const alertRecipients = this.config.get<string>('ALERT_EMAILS');
    if (alertRecipients) {
      this.alertEmails = alertRecipients
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean);
    }
  }

  /**
   * Notify stakeholders about a workflow failure.
   */
  async notifyWorkflowFailure(context: WorkflowNotificationContext) {
    const payload = this.buildNotificationPayload('Workflow Failure', context);

    await Promise.allSettled([
      this.sendSlackNotification(payload),
      this.sendEmailNotification(payload, context.userEmail),
    ]);
  }

  /**
   * Notify stakeholders that a workflow recovered after previous failures.
   */
  async notifyWorkflowRecovery(context: WorkflowNotificationContext) {
    const payload = this.buildNotificationPayload('Workflow Recovered', context);

    await Promise.allSettled([
      this.sendSlackNotification(payload),
      this.sendEmailNotification(payload, context.userEmail),
    ]);
  }

  /**
   * Broadcast informational update, e.g. workflow status change.
   */
  async notifyWorkflowUpdate(context: WorkflowNotificationContext) {
    const payload = this.buildNotificationPayload('Workflow Update', context);

    await Promise.allSettled([
      this.sendSlackNotification(payload),
      this.sendEmailNotification(payload, context.userEmail, false),
    ]);
  }

  private buildNotificationPayload(
    title: string,
    context: WorkflowNotificationContext,
  ) {
    return {
      title,
      message: context.message,
      runId: context.runId,
      jobId: context.jobId,
      campaignName: context.campaignName,
      severity: context.severity ?? 'warning',
      errorStack: context.errorStack,
      timestamp: new Date().toISOString(),
    };
  }

  private async sendEmailNotification(
    payload: ReturnType<typeof this.buildNotificationPayload>,
    userEmail?: string | null,
    includeAdmins: boolean = true,
  ) {
    const recipients = new Set<string>();

    if (includeAdmins) {
      this.alertEmails.forEach((email) => recipients.add(email));
    }

    if (userEmail) {
      recipients.add(userEmail);
    }

    if (recipients.size === 0) {
      return;
    }

    const subject = `[${payload.severity.toUpperCase()}] ${payload.title} (Run ${payload.runId})`;
    const html = `
      <h2>${payload.title}</h2>
      <p>${payload.message}</p>
      <ul>
        <li><strong>Workflow Run:</strong> ${payload.runId}</li>
        ${
          payload.jobId
            ? `<li><strong>Job:</strong> ${payload.jobId}</li>`
            : ''
        }
        ${
          payload.campaignName
            ? `<li><strong>Campaign:</strong> ${payload.campaignName}</li>`
            : ''
        }
        <li><strong>Severity:</strong> ${payload.severity}</li>
        <li><strong>Timestamp:</strong> ${payload.timestamp}</li>
      </ul>
      ${
        payload.errorStack
          ? `<pre style="background:#111;color:#f5f5f5;padding:12px;border-radius:4px;">${payload.errorStack}</pre>`
          : ''
      }
    `;

    await Promise.all(
      Array.from(recipients).map((recipient) =>
        this.emailService
          .sendEmail(recipient, subject, html)
          .catch((error) =>
            this.logger.error(
              `Failed to send workflow email notification to ${recipient}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          ),
      ),
    );
  }

  private async sendSlackNotification(
    payload: ReturnType<typeof this.buildNotificationPayload>,
  ) {
    if (!this.slackWebhook) {
      return;
    }

    try {
      await fetch(this.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${payload.title}*\n${payload.message}\n• Run: ${
            payload.runId
          }${payload.jobId ? `\n• Job: ${payload.jobId}` : ''}${
            payload.campaignName ? `\n• Campaign: ${payload.campaignName}` : ''
          }\n• Severity: ${payload.severity}\n• Timestamp: ${
            payload.timestamp
          }`,
        }),
      });
    } catch (error) {
      this.logger.error(
        `Failed to send Slack notification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
