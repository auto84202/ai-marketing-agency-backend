import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/auth.guard';
import { HashtagSearchService } from './hashtag-search.service';
import { SocialPlatform } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user: {
    sub: string;
    email: string;
  };
}

@Controller('ai/hashtag-search')
@UseGuards(JwtAuthGuard)
export class HashtagSearchController {
  constructor(private readonly hashtagSearchService: HashtagSearchService) {}

  /**
   * Search for hashtags/keywords across all social media platforms
   * POST /ai/hashtag-search
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async searchHashtags(
    @Request() req: AuthenticatedRequest,
    @Body() body: {
      keyword: string;
      maxResultsPerPlatform?: number;
      platforms?: SocialPlatform[];
    },
  ) {
    const { keyword, maxResultsPerPlatform, platforms } = body;

    if (!keyword || keyword.trim().length === 0) {
      throw new Error('Keyword is required');
    }

    return this.hashtagSearchService.searchHashtags(req.user.sub, keyword.trim(), {
      maxResultsPerPlatform,
      platforms,
    });
  }

  /**
   * Get search history for the authenticated user
   * GET /ai/hashtag-search/history
   */
  @Get('history')
  async getSearchHistory(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.hashtagSearchService.getSearchHistory(req.user.sub, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * Get search results by search ID
   * GET /ai/hashtag-search/:searchId
   */
  @Get(':searchId')
  async getSearchResults(
    @Request() req: AuthenticatedRequest,
    @Param('searchId') searchId: string,
  ) {
    return this.hashtagSearchService.getSearchResults(searchId, req.user.sub);
  }
}

