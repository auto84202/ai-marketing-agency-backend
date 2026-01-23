import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter based on configuration
   */
  private initializeTransporter() {
    const emailProvider = this.configService.get<string>('EMAIL_PROVIDER') || 'console';
    
    if (emailProvider === 'smtp') {
      // Configure for SMTP provider (Gmail, SendGrid, etc.)
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('EMAIL_HOST'),
        port: parseInt(this.configService.get<string>('EMAIL_PORT') || '587'),
        secure: this.configService.get<string>('EMAIL_SECURE') === 'true',
        auth: {
          user: this.configService.get<string>('EMAIL_USER'),
          pass: this.configService.get<string>('EMAIL_PASSWORD'),
        },
      });
      this.logger.log('Email service initialized with SMTP');
    } else if (emailProvider === 'sendgrid') {
      // Configure for SendGrid
      const sendGridApiKey = this.configService.get<string>('SENDGRID_API_KEY');
      if (sendGridApiKey) {
        this.transporter = nodemailer.createTransport({
          service: 'SendGrid',
          auth: {
            user: 'apikey',
            pass: sendGridApiKey,
          },
        });
        this.logger.log('Email service initialized with SendGrid');
      } else {
        this.logger.warn('SendGrid API key not found, falling back to console logging');
        this.transporter = null;
      }
    } else if (emailProvider === 'gmail') {
      // Configure for Gmail
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: this.configService.get<string>('GMAIL_USER'),
          pass: this.configService.get<string>('GMAIL_APP_PASSWORD'),
        },
      });
      this.logger.log('Email service initialized with Gmail');
    } else {
      // Default: console logging for development
      this.logger.warn('Email provider not configured or set to console mode. Emails will be logged to console.');
      this.transporter = null;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetLink: string, userName?: string): Promise<void> {
    const subject = 'Password Reset Request';
    const htmlContent = this.getPasswordResetEmailTemplate(userName || 'User', resetLink);

    await this.sendEmail(email, subject, htmlContent);
  }

  /**
   * Send generic email
   */
  async sendEmail(to: string, subject: string, html: string, from?: string): Promise<void> {
    const fromEmail = from || this.configService.get<string>('EMAIL_FROM') || 'noreply@ai-marketing-agency.com';

    try {
      if (this.transporter) {
        // Send actual email
        await this.transporter.sendMail({
          from: fromEmail,
          to,
          subject,
          html,
        });
        this.logger.log(`Email sent successfully to ${to}`);
      } else {
        // Log to console for development
        this.logger.log('\n=== EMAIL TO BE SENT ===');
        this.logger.log(`To: ${to}`);
        this.logger.log(`From: ${fromEmail}`);
        this.logger.log(`Subject: ${subject}`);
        this.logger.log(`HTML Content: ${html}`);
        this.logger.log('=======================\n');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send email to ${to}: ${msg}`);
      throw error;
    }
  }

  /**
   * Get password reset email HTML template
   */
  private getPasswordResetEmailTemplate(userName: string, resetLink: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f4f4f4;
          }
          .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
          }
          .logo {
            font-size: 24px;
            font-weight: bold;
            color: #8b5cf6;
            margin-bottom: 10px;
          }
          .content {
            margin-bottom: 30px;
          }
          .button {
            display: inline-block;
            padding: 14px 28px;
            background-color: #8b5cf6;
            color: #ffffff;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            text-align: center;
            margin: 20px 0;
          }
          .button:hover {
            background-color: #7c3aed;
          }
          .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 12px;
            color: #6b7280;
            text-align: center;
          }
          .warning {
            background-color: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 12px;
            margin: 20px 0;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">AI Marketing Pro</div>
          </div>
          
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>Hello ${userName},</p>
            <p>We received a request to reset your password for your AI Marketing Pro account. Click the button below to create a new password:</p>
            
            <div style="text-align: center;">
              <a href="${resetLink}" class="button">Reset Password</a>
            </div>
            
            <div class="warning">
              <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour. If you didn't request this password reset, please ignore this email or contact support if you have concerns.
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #6b7280; font-size: 12px;">${resetLink}</p>
          </div>
          
          <div class="footer">
            <p>This email was sent by AI Marketing Pro. If you have any questions, please contact our support team.</p>
            <p>&copy; ${new Date().getFullYear()} AI Marketing Pro. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

