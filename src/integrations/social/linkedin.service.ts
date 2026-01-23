import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LinkedInPostPayload {
  authorUrn: string;
  text: string;
  media?: Array<{
    media: string;
    status?: 'READY' | 'PROCESSING';
    description?: string;
    title?: string;
  }>;
  visibility?: 'PUBLIC' | 'CONNECTIONS';
}

export interface LinkedInMessagePayload {
  recipients: string[];
  subject?: string;
  text: string;
}

@Injectable()
export class LinkedInService {
  private readonly logger = new Logger(LinkedInService.name);
  private readonly apiBase: string;

  constructor(private readonly config: ConfigService) {
    this.apiBase = this.config.get<string>('LINKEDIN_API_BASE') ?? 'https://api.linkedin.com';
  }

  async publishPost(accessToken: string, payload: LinkedInPostPayload) {
    const endpoint = `${this.apiBase}/v2/ugcPosts`;

    const body = {
      author: payload.authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: payload.text,
          },
          shareMediaCategory: payload.media && payload.media.length > 0 ? 'ARTICLE' : 'NONE',
          media: payload.media?.map((item) => ({
            status: item.status ?? 'READY',
            description: item.description ? { text: item.description } : undefined,
            originalUrl: item.media,
            title: item.title ? { text: item.title } : undefined,
          })),
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': payload.visibility ?? 'PUBLIC',
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`LinkedIn publish failed: ${errorText}`);
      throw new Error(`LinkedIn publish failed with status ${response.status}`);
    }

    const result = await response.json();
    this.logger.log(`LinkedIn post published successfully: ${result?.id ?? 'unknown id'}`);
    return result;
  }

  async sendMessage(accessToken: string, payload: LinkedInMessagePayload) {
    const endpoint = `${this.apiBase}/v2/messages`;

    const body = {
      recipients: {
        values: payload.recipients.map((urn) => ({ person: urn.startsWith('urn:') ? urn : `urn:li:person:${urn}` })),
      },
      subject: payload.subject ?? 'Message from AI Marketing Agency',
      body: payload.text,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`LinkedIn message failed: ${errorText}`);
      throw new Error(`LinkedIn message failed with status ${response.status}`);
    }

    const result = await response.json();
    this.logger.log(`LinkedIn message sent successfully.`);
    return result;
  }

  /**
   * Search for hashtags/keywords on LinkedIn
   */
  async searchHashtags(
    keyword: string,
    accessToken?: string,
    options: {
      maxResults?: number;
    } = {},
  ): Promise<any[]> {
    try {
      this.logger.log(`Searching LinkedIn for keyword: ${keyword}`);

      // TODO: Implement actual LinkedIn API call
      // Note: LinkedIn API has limited search capabilities for public content
      // You may need to use LinkedIn Marketing API or third-party services
      
      // For now, return mock data
      return this.searchMockHashtags(keyword, options);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to search LinkedIn hashtags: ${msg}`);
      throw error;
    }
  }

  private searchMockHashtags(keyword: string, options: any): any[] {
    const posts = [];
    const maxResults = options.maxResults || 20;

    for (let i = 0; i < maxResults; i++) {
      posts.push({
        id: `linkedin_${Date.now()}_${i}`,
        text: `Professional insights about ${keyword}. #${keyword} #business #professional`,
        author: {
          id: `user_${i}`,
          name: `LinkedIn User ${i}`,
          headline: `Professional in ${keyword} industry`,
        },
        metrics: {
          likes: Math.floor(Math.random() * 5000) + 50,
          comments: Math.floor(Math.random() * 500) + 10,
          shares: Math.floor(Math.random() * 200) + 5,
        },
        postedAt: new Date(Date.now() - i * 30 * 60 * 1000), // 30 minutes apart
        permalink: `https://linkedin.com/posts/mock_${i}`,
      });
    }

    return posts;
  }

  /**
   * Search for posts by keyword
   */
  async searchPosts(
    accessToken: string,
    keyword: string,
    options: {
      maxResults?: number;
    } = {},
  ): Promise<any[]> {
    try {
      this.logger.log(`Searching LinkedIn posts for keyword: ${keyword}`);

      // TODO: Implement actual LinkedIn API call
      // LinkedIn's search API is limited and requires specific permissions
      
      // For now, use mock data
      return this.searchMockHashtags(keyword, options).map(post => ({
        id: post.id,
        commentary: post.text,
        text: post.text,
        author: post.author,
        createdAt: post.postedAt,
        shareUrl: post.permalink,
        profileUrl: `https://linkedin.com/in/mock_${post.author.id}`,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to search LinkedIn posts: ${msg}`);
      throw error;
    }
  }

  /**
   * Post a comment on a LinkedIn post
   */
  async postComment(accessToken: string, postId: string, text: string): Promise<{ id: string }> {
    try {
      const endpoint = `${this.apiBase}/v2/socialActions/${postId}/comments`;

      const body = {
        actor: 'urn:li:person:me',
        message: {
          text,
        },
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`LinkedIn comment failed: ${errorText}`);
        
        // For now, return mock response
        this.logger.log(`Mock: Commenting on LinkedIn post ${postId} with: ${text}`);
        return { id: `comment_mock_${Date.now()}` };
      }

      const result = await response.json();
      this.logger.log(`LinkedIn comment posted successfully: ${result?.id ?? 'unknown id'}`);
      return { id: result?.id ?? `comment_mock_${Date.now()}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to post LinkedIn comment: ${msg}`);
      
      // Return mock response on error
      this.logger.log(`Mock: Commenting on LinkedIn post ${postId} with: ${text}`);
      return { id: `comment_mock_${Date.now()}` };
    }
  }
}
