import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface InstagramPostPayload {
  caption: string;
  imageUrl?: string;
  videoUrl?: string;
  scheduledPublishTime?: Date;
}

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly graphBaseUrl: string;
  private readonly graphVersion: string;

  constructor(private readonly config: ConfigService) {
    this.graphVersion = this.config.get<string>('FACEBOOK_GRAPH_VERSION') ?? 'v18.0';
    this.graphBaseUrl =
      this.config.get<string>('FACEBOOK_GRAPH_BASE_URL') ?? 'https://graph.facebook.com';
  }

  async publishPost(
    accessToken: string,
    instagramBusinessAccountId: string,
    payload: InstagramPostPayload,
  ) {
    if (!payload.imageUrl && !payload.videoUrl) {
      throw new Error('Instagram post requires imageUrl or videoUrl');
    }

    const createEndpoint = `${this.graphBaseUrl}/${this.graphVersion}/${instagramBusinessAccountId}/media`;

    const formData: Record<string, string> = {
      caption: payload.caption,
      access_token: accessToken,
    };

    if (payload.imageUrl) {
      formData.image_url = payload.imageUrl;
    }

    if (payload.videoUrl) {
      formData.video_url = payload.videoUrl;
    }

    if (payload.scheduledPublishTime) {
      formData.publish_at = Math.floor(payload.scheduledPublishTime.getTime() / 1000).toString();
    }

    const creationResponse = await fetch(createEndpoint, {
      method: 'POST',
      body: new URLSearchParams(formData),
    });

    if (!creationResponse.ok) {
      const errorText = await creationResponse.text();
      this.logger.error(`Instagram media creation failed: ${errorText}`);
      throw new Error(`Instagram media creation failed with status ${creationResponse.status}`);
    }

    const creationData = await creationResponse.json();
    const creationId = creationData?.id;

    if (!creationId) {
      throw new Error('Instagram media creation did not return an id');
    }

    const publishEndpoint = `${this.graphBaseUrl}/${this.graphVersion}/${instagramBusinessAccountId}/media_publish`;
    const publishResponse = await fetch(publishEndpoint, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken,
      }),
    });

    if (!publishResponse.ok) {
      const errorText = await publishResponse.text();
      this.logger.error(`Instagram publish failed: ${errorText}`);
      throw new Error(`Instagram publish failed with status ${publishResponse.status}`);
    }

    const result = await publishResponse.json();
    this.logger.log(`Instagram post published successfully: ${result?.id ?? creationId}`);
    return result;
  }

  /**
   * Search Instagram posts by keyword
   */
  async searchPostsByKeyword(keyword: string, maxResults: number = 50): Promise<any[]> {
    try {
      const accessToken = this.config.get<string>('INSTAGRAM_ACCESS_TOKEN');
      const accountId = this.config.get<string>('INSTAGRAM_BUSINESS_ACCOUNT_ID');

      if (!accessToken || !accountId) {
        this.logger.warn('Instagram credentials not configured');
        return [];
      }

      const posts = await this.getAccountMedia(accessToken, accountId, maxResults);
      
      // Filter posts by keyword in caption
      return posts.filter(post => 
        post.caption && post.caption.toLowerCase().includes(keyword.toLowerCase())
      );
    } catch (error) {
      this.logger.error(`Error searching Instagram posts: ${error}`);
      return [];
    }
  }

  /**
   * Get access token from config or parameter
   */
  private getAccessToken(accessToken?: string): string {
    const token = accessToken || this.config.get<string>('INSTAGRAM_ACCESS_TOKEN');
    if (!token) {
      throw new Error('Instagram access token is required. Set INSTAGRAM_ACCESS_TOKEN in .env file or provide it as parameter.');
    }
    return token;
  }

  /**
   * Search for hashtags/keywords on Instagram
   * Uses Instagram Graph API to search for posts by hashtag or keywords
   */
  async searchHashtags(
    keyword: string,
    accessToken?: string,
    options: {
      maxResults?: number;
      instagramBusinessAccountId?: string;
    } = {},
  ): Promise<any[]> {
    try {
      const token = this.getAccessToken(accessToken);
      const maxResults = options.maxResults || 20;
      
      this.logger.log(`Searching Instagram for keyword: ${keyword}`);

      // Clean keyword (remove # if present)
      const cleanKeyword = keyword.replace('#', '').trim();
      
      // Strategy: Search for Instagram hashtag, then get recent media
      return this.searchHashtagMedia(token, cleanKeyword, maxResults, options.instagramBusinessAccountId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to search Instagram hashtags: ${msg}`);
      throw error;
    }
  }

  /**
   * Search Instagram posts by hashtag
   */
  private async searchHashtagMedia(
    accessToken: string,
    hashtag: string,
    maxResults: number,
    businessAccountId?: string,
  ): Promise<any[]> {
    try {
      // First, get the hashtag ID
      const hashtagId = await this.getHashtagId(accessToken, hashtag);
      
      if (!hashtagId) {
        this.logger.warn(`Hashtag ${hashtag} not found, trying alternative search`);
        // Fallback: search for top media or recent media if hashtag search fails
        return this.searchMediaByKeyword(accessToken, hashtag, maxResults);
      }

      // Get recent media for the hashtag
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${hashtagId}/recent_media`;
      const params = new URLSearchParams({
        access_token: accessToken,
        fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count,username',
        limit: Math.min(maxResults, 100).toString(),
      });

      const response = await fetch(`${endpoint}?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Instagram hashtag media fetch failed: ${errorText}`);
        // Fallback to keyword search
        return this.searchMediaByKeyword(accessToken, hashtag, maxResults);
      }

      const data = await response.json();
      const posts = data.data || [];

      const mappedPosts = posts.map((post: any) => {
        // Ensure we have a valid permalink
        let permalink = post.permalink;
        if (!permalink || !permalink.startsWith('http')) {
          permalink = this.constructInstagramUrl(post.id);
        }
        
        return {
          id: post.id,
          caption: post.caption || '',
          mediaUrl: post.media_url || post.thumbnail_url || '',
          permalink: permalink,
          createdTime: post.timestamp ? new Date(post.timestamp) : new Date(),
          metrics: {
            likes: post.like_count || 0,
            comments: post.comments_count || 0,
          },
          author: {
            username: post.username || 'unknown',
          },
          mediaType: post.media_type || 'IMAGE',
        };
      });

      this.logger.log(`Successfully mapped ${mappedPosts.length} Instagram posts from hashtag with permalinks`);
      return mappedPosts;
    } catch (error) {
      this.logger.warn(`Hashtag media search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return this.searchMediaByKeyword(accessToken, hashtag, maxResults);
    }
  }

  /**
   * Get Instagram hashtag ID
   */
  private async getHashtagId(accessToken: string, hashtag: string): Promise<string | null> {
    try {
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/ig_hashtag_search`;
      const params = new URLSearchParams({
        access_token: accessToken,
        user_id: 'me', // This requires a user ID, may need to use business account ID
        q: hashtag,
      });

      const response = await fetch(`${endpoint}?${params}`);
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (data.data && data.data.length > 0) {
        return data.data[0].id;
      }
      
      return null;
    } catch (error) {
      this.logger.warn(`Failed to get hashtag ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Search media by keyword (fallback method)
   * This searches for pages/accounts and gets their media
   */
  private async searchMediaByKeyword(
    accessToken: string,
    keyword: string,
    maxResults: number,
  ): Promise<any[]> {
    try {
      // Search for Instagram accounts/pages related to keyword
      const accounts = await this.searchAccounts(accessToken, keyword, 5);
      
      if (accounts.length === 0) {
        this.logger.warn(`No Instagram accounts found for keyword: ${keyword}`);
        return [];
      }

      const allPosts: any[] = [];
      for (const account of accounts) {
        try {
          const media = await this.getAccountMedia(accessToken, account.id, maxResults);
          
          // Filter media by keyword
          const filteredMedia = media.filter((post: any) => {
            const caption = (post.caption || '').toLowerCase();
            return caption.includes(keyword.toLowerCase());
          });
          
          allPosts.push(...filteredMedia);
          
          if (allPosts.length >= maxResults) {
            break;
          }
        } catch (error) {
          this.logger.warn(`Failed to get media from account ${account.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          continue;
        }
      }

      return allPosts.slice(0, maxResults);
    } catch (error) {
      this.logger.error(`Failed to search media by keyword: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Search for Instagram accounts/business profiles
   */
  private async searchAccounts(
    accessToken: string,
    query: string,
    maxResults: number = 5,
  ): Promise<any[]> {
    try {
      // Instagram Graph API search is limited
      // This is a simplified approach - may need business account ID
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/search`;
      const params = new URLSearchParams({
        access_token: accessToken,
        type: 'ig_hashtag',
        q: query,
        limit: Math.min(maxResults, 25).toString(),
      });

      const response = await fetch(`${endpoint}?${params}`);
      
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      this.logger.warn(`Failed to search accounts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Get media from an Instagram account
   */
  private async getAccountMedia(
    accessToken: string,
    accountId: string,
    maxResults: number,
  ): Promise<any[]> {
    try {
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${accountId}/media`;
      const params = new URLSearchParams({
        access_token: accessToken,
        fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count,username',
        limit: Math.min(maxResults, 100).toString(),
      });

      const response = await fetch(`${endpoint}?${params}`);
      
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const posts = data.data || [];

      return posts.map((post: any) => ({
        id: post.id,
        caption: post.caption || '',
        mediaUrl: post.media_url || post.thumbnail_url || '',
        permalink: post.permalink || this.constructInstagramUrl(post.id),
        createdTime: post.timestamp ? new Date(post.timestamp) : new Date(),
        metrics: {
          likes: post.like_count || 0,
          comments: post.comments_count || 0,
        },
        author: {
          username: post.username || 'unknown',
        },
        mediaType: post.media_type || 'IMAGE',
      }));
    } catch (error) {
      this.logger.warn(`Failed to get account media: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Search Instagram posts by keywords (similar to Facebook)
   */
  async searchPosts(
    query: string,
    accessToken?: string,
    options: {
      maxResults?: number;
      instagramBusinessAccountId?: string;
    } = {},
  ): Promise<any[]> {
    try {
      const token = this.getAccessToken(accessToken);
      const maxResults = options.maxResults || 20;
      
      this.logger.log(`Searching Instagram posts for query: ${query}`);

      // Extract hashtags from query
      const hashtags = query.match(/#(\w+)/g) || [];
      
      if (hashtags.length > 0) {
        // Search by hashtag
        const hashtag = hashtags[0]!.replace('#', '');
        return this.searchHashtagMedia(token, hashtag, maxResults, options.instagramBusinessAccountId);
      }

      // Otherwise search by keyword
      return this.searchMediaByKeyword(token, query, maxResults);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to search Instagram posts: ${msg}`);
      throw error;
    }
  }

  /**
   * Get comments from an Instagram post
   */
  async getPostComments(
    postId: string,
    accessToken?: string,
    options: {
      maxResults?: number;
    } = {},
  ): Promise<any[]> {
    try {
      const token = this.getAccessToken(accessToken);
      const maxResults = options.maxResults || 100;

      this.logger.log(`Fetching comments for Instagram post: ${postId}`);

      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${postId}/comments`;
      const params = new URLSearchParams({
        access_token: token,
        fields: 'id,text,timestamp,username,like_count',
        limit: Math.min(maxResults, 100).toString(),
      });

      const response = await fetch(`${endpoint}?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Instagram comments fetch failed: ${errorText}`);
        throw new Error(`Instagram API error: ${response.status}`);
      }

      const data = await response.json();
      const comments = data.data || [];

      return comments.map((comment: any) => ({
        id: comment.id,
        message: comment.text || '',
        author: {
          username: comment.username || 'Unknown',
        },
        createdTime: comment.timestamp ? new Date(comment.timestamp) : new Date(),
        likeCount: comment.like_count || 0,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch Instagram comments: ${msg}`);
      throw error;
    }
  }

  /**
   * Construct Instagram URL from post ID
   */
  private constructInstagramUrl(postId: string): string {
    if (!postId) {
      return 'https://www.instagram.com';
    }
    // Instagram post URLs: https://www.instagram.com/p/{shortcode}/
    // Note: Post ID may need to be converted to shortcode
    return `https://www.instagram.com/p/${postId}/`;
  }

  /**
   * Extract hashtags from text
   */
  extractHashtags(text: string): string[] {
    const hashtagRegex = /#(\w+)/g;
    const matches = text.match(hashtagRegex) || [];
    return matches.map(tag => tag.substring(1)); // Remove # symbol
  }

  /**
   * Post a comment on an Instagram media
   */
  async postComment(accessToken: string, mediaId: string, text: string): Promise<{ id: string }> {
    try {
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${mediaId}/comments`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          access_token: accessToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Instagram API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return { id: data.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to post Instagram comment: ${msg}`);
      throw error;
    }
  }

  /**
   * Reply to an Instagram comment
   */
  async replyToComment(accessToken: string, commentId: string, text: string): Promise<{ id: string }> {
    try {
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${commentId}/replies`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
          access_token: accessToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Instagram API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return { id: data.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to reply to Instagram comment: ${msg}`);
      throw error;
    }
  }
}
