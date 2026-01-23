import { Controller, Get, Post, Param, Query, Request, UseGuards } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { AuthGuard } from '../auth/auth.guard';
import { WorkflowRunStatus } from '@prisma/client';

@Controller('workflows')
@UseGuards(AuthGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('runs')
  async listRuns(@Request() req: any, @Query('status') status?: WorkflowRunStatus) {
    const normalizedStatus = status ? (String(status).toUpperCase() as WorkflowRunStatus) : undefined;
    return this.workflows.listRuns(req.user, normalizedStatus);
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string, @Request() req: any) {
    return this.workflows.getRunById(id, req.user);
  }

  @Post('runs/:id/pause')
  async pauseRun(@Param('id') id: string, @Request() req: any) {
    return this.workflows.pauseRun(id, req.user);
  }

  @Post('runs/:id/resume')
  async resumeRun(@Param('id') id: string, @Request() req: any) {
    return this.workflows.resumeRun(id, req.user);
  }

  @Post('jobs/:id/retry')
  async retryJob(@Param('id') id: string, @Request() req: any) {
    return this.workflows.retryJob(id, req.user);
  }
}

