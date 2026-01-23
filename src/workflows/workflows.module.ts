import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { AiModule } from '../ai/ai.module';
import { ImageGenerationModule } from '../ai/images/image-generation.module';
import { WorkflowsService } from './workflows.service';
import { WorkflowProcessor } from './workflow.processor';
import { WorkflowsController } from './workflows.controller';
import { SocialAutomationModule } from '../ai/social-media/social-automation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    AiModule,
    ImageGenerationModule,
    SocialAutomationModule,
    NotificationsModule,
    AuthModule,
  ],
  providers: [WorkflowsService, WorkflowProcessor],
  controllers: [WorkflowsController],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}

