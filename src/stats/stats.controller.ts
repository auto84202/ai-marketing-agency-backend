import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { StatsService } from './stats.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('stats')
@UseGuards(AuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  async getStats(@Request() req: any) {
    console.log('Request user object:', req.user);
    console.log('User sub:', req.user.sub);
    return this.statsService.getUserStats(req.user.sub);
  }

  @Get('system')
  async getSystemStats() {
    return this.statsService.getSystemStats();
  }

  @Get('user/:id')
  async getUserStats(@Param('id') userId: string) {
    return this.statsService.getUserStats(userId);
  }
}
