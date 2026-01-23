import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { KeywordScannerService } from './keyword-scanner.service';

interface AuthRequest extends Request {
  user: {
    sub: string;
    userId?: string;
    email: string;
    role: string;
  };
}

@Controller('keyword-scanner')
@UseGuards(JwtAuthGuard)
export class KeywordScannerController {
  constructor(private readonly keywordScannerService: KeywordScannerService) {}

  @Post('scan')
  async scanKeyword(
    @Body() body: { keyword: string; platforms: string[] },
    @Request() req: AuthRequest,
  ) {
    const { keyword, platforms } = body;
    const userId = req.user.sub || req.user.userId || '';

    if (!userId) {
      return {
        success: false,
        error: 'User not authenticated',
        results: [],
        totalResults: 0,
      };
    }

    const results = await this.keywordScannerService.scanKeyword(
      keyword,
      platforms,
      userId,
    );

    return {
      success: true,
      keyword,
      platforms,
      results,
      totalResults: results.length,
    };
  }

  @Post('chat')
  async chat(
    @Body() body: { message: string; context: any },
    @Request() req: AuthRequest,
  ) {
    const { message, context } = body;
    const userId = req.user.sub || req.user.userId || '';

    if (!userId) {
      return {
        success: false,
        response: 'User not authenticated',
      };
    }

    const response = await this.keywordScannerService.chatWithAI(
      message,
      context,
      userId,
    );

    return {
      success: true,
      response,
    };
  }
}

