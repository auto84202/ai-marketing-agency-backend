import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FacebookPostPayload {
  message: string;
  link?: string;
  imageUrl?: string;
  scheduledPublishTime?: Date;
}

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly graphBaseUrl: string;
  private readonly graphVersion: string;

  constructor(private readonly config: ConfigService) {
    this.graphVersion = this.config.get<string>('FACEBOOK_GRAPH_VERSION') ?? 'v18.0';
    this.graphBaseUrl =
      this.config.get<string>('FACEBOOK_GRAPH_BASE_URL') ?? 'https://graph.facebook.com';
  }

  async publishPagePost(accessToken: string, pageId: string, payload: FacebookPostPayload) {
    if (payload.imageUrl) {
      return this.publishPhoto(accessToken, pageId, payload);
    }

    const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${pageId}/feed`;
    const body = new URLSearchParams({
      message: payload.message,
      access_token: accessToken,
    });

    if (payload.link) {
      body.append('link', payload.link);
    }

    if (payload.scheduledPublishTime) {
      body.append(
        'scheduled_publish_time',
        Math.floor(payload.scheduledPublishTime.getTime() / 1000).toString(),
      );
      body.append('published', 'false');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Facebook post failed: ${errorText}`);
      throw new Error(`Facebook post failed with status ${response.status}`);
    }

    const result = await response.json();
    this.logger.log(`Facebook post created successfully: ${result?.id ?? 'unknown id'}`);
    return result;
  }

  private async publishPhoto(
    accessToken: string,
    pageId: string,
    payload: FacebookPostPayload,
  ) {
    const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${pageId}/photos`;
    const body = new URLSearchParams({
      caption: payload.message,
      url: payload.imageUrl!,
      access_token: accessToken,
    });

    if (payload.scheduledPublishTime) {
      body.append(
        'scheduled_publish_time',
        Math.floor(payload.scheduledPublishTime.getTime() / 1000).toString(),
      );
      body.append('published', 'false');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Facebook photo publish failed: ${errorText}`);
      throw new Error(`Facebook photo publish failed with status ${response.status}`);
    }

    const result = await response.json();
    this.logger.log(`Facebook photo post created successfully: ${result?.post_id ?? 'unknown id'}`);
    return result;
  }

  /**
   * Get access token from config or parameter
   */
  private getAccessToken(accessToken?: string): string {
    const token = accessToken || this.config.get<string>('FACEBOOK_ACCESS_TOKEN');
    if (!token) {
      throw new Error('Facebook access token is required. Set FACEBOOK_ACCESS_TOKEN in .env file or provide it as parameter.');
    }
    return token;
  }

  /**
   * Search for posts by keywords on Facebook
   * Uses page posts search - requires managing a page or public posts
   */
  async searchPosts(
    query: string,
    accessToken?: string,
    options: {
      maxResults?: number;
      pageId?: string;
    } = {},
  ): Promise<any[]> {
    try {
      const token = this.getAccessToken(accessToken);
      const maxResults = options.maxResults || 20;
      
      this.logger.log(`Searching Facebook posts for query: ${query}`);

      // If pageId is provided, search within that page's posts
      if (options.pageId) {
        return this.searchPagePosts(token, options.pageId, query, maxResults);
      }

      // Search public posts using Graph API search
      // Note: Facebook Graph API search has limitations - requires page_id or uses feed endpoint
      return this.searchPublicPosts(token, query, maxResults);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to search Facebook posts: ${msg}`);
      throw error;
    }
  }

  /**
   * Search posts from a specific Facebook page
   */
  private async searchPagePosts(
    accessToken: string,
    pageId: string,
    query: string,
    maxResults: number,
  ): Promise<any[]> {
    const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${pageId}/posts`;
    const params = new URLSearchParams({
      access_token: accessToken,
      fields: 'id,message,created_time,permalink_url,attachments{media{image{src}}},shares,reactions.summary(true),comments.summary(true)',
      limit: Math.min(maxResults, 100).toString(),
    });

    const response = await fetch(`${endpoint}?${params}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Facebook page posts fetch failed: ${errorText}`);
      throw new Error(`Facebook API error: ${response.status}`);
    }

    const data = await response.json();
    const posts = data.data || [];

    // Filter posts by query keywords
    const keywords = query.toLowerCase().split(/\s+/);
    const filteredPosts = posts
      .filter((post: any) => {
        const message = (post.message || '').toLowerCase();
        return keywords.some(keyword => message.includes(keyword));
      })
      .slice(0, maxResults);

    const mappedPosts = filteredPosts.map((post: any) => {
      // Ensure we have a valid permalink
      let permalink = post.permalink_url;
      if (!permalink || !permalink.startsWith('http')) {
        permalink = this.constructFacebookUrl(post.id);
      }
      
      return {
        id: post.id,
        message: post.message || '',
        permalink: permalink,
        createdTime: post.created_time ? new Date(post.created_time) : new Date(),
        metrics: {
          likes: post.reactions?.summary?.total_count || 0,
          comments: post.comments?.summary?.total_count || 0,
          shares: post.shares?.count || 0,
        },
        mediaUrl: post.attachments?.data?.[0]?.media?.image?.src,
      };
    });

    this.logger.log(`Successfully mapped ${mappedPosts.length} Facebook posts with permalinks`);
    return mappedPosts;
  }

  /**
   * Search public posts by finding relevant pages and their posts
   */
  private async searchPublicPosts(
    accessToken: string,
    query: string,
    maxResults: number,
  ): Promise<any[]> {
    try {
      this.logger.log(`Searching public Facebook posts for query: "${query}"`);
      
      // Strategy: Search for pages that match the query, then get their posts
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      
      if (keywords.length === 0) {
        this.logger.warn('No valid keywords for search');
        return [];
      }

      // Try to find pages related to the query
      this.logger.log(`Searching for Facebook pages matching query: "${query}"`);
      const pages = await this.searchPages(accessToken, query, 5);
      
      this.logger.log(`Found ${pages.length} Facebook pages for query: "${query}"`);
      
      if (pages.length === 0) {
        this.logger.warn(`No pages found for query: ${query}. Trying hashtag search as fallback.`);
        // Try hashtag search as fallback
        if (query.includes('#')) {
          const hashtag = query.match(/#(\w+)/)?.[1];
          if (hashtag) {
            this.logger.log(`Trying hashtag search for: #${hashtag}`);
            return this.searchHashtagPosts(accessToken, hashtag, maxResults);
          }
        }
        this.logger.warn(`No posts found for query: ${query}`);
        return [];
      }

      // Get posts from found pages
      const allPosts: any[] = [];
      for (const page of pages) {
        try {
          this.logger.log(`Fetching posts from page: ${page.name || page.id}`);
          const pagePosts = await this.searchPagePosts(accessToken, page.id, query, maxResults);
          // Note: searchPagePosts filters posts by query keywords
          
          this.logger.log(`Retrieved ${pagePosts.length} posts from page: ${page.name || page.id}`);
          
          // Filter posts by query keywords if needed (already filtered in getPagePosts, but double-check)
          const filteredPosts = pagePosts.filter((post: any) => {
            const message = (post.message || '').toLowerCase();
            return keywords.some(keyword => message.includes(keyword));
          });
          
          allPosts.push(...filteredPosts);
          
          if (allPosts.length >= maxResults) {
            break;
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(`Failed to get posts from page ${page.id}: ${errorMsg}`);
          continue;
        }
      }

      this.logger.log(`Total posts found: ${allPosts.length} for query: "${query}"`);
      return allPosts.slice(0, maxResults);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : '';
      this.logger.error(`Failed to search public posts for query "${query}": ${errorMsg}`, errorStack);
      // Try hashtag search as fallback
      if (query.includes('#')) {
        const hashtag = query.match(/#(\w+)/)?.[1];
        if (hashtag) {
          this.logger.log(`Trying hashtag search fallback for: #${hashtag}`);
          try {
            return this.searchHashtagPosts(accessToken, hashtag, maxResults);
          } catch (fallbackError) {
            this.logger.error(`Hashtag search fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
          }
        }
      }
      // Return empty array - don't return dummy/mock data
      return [];
    }
  }

  /**
   * Search for Facebook pages matching the query
   */
  private async searchPages(
    accessToken: string,
    query: string,
    maxResults: number = 5,
  ): Promise<any[]> {
    try {
      // Use Graph API search for pages
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/search`;
      const params = new URLSearchParams({
        access_token: accessToken,
        type: 'page',
        q: query,
        fields: 'id,name,username,category',
        limit: Math.min(maxResults, 25).toString(),
      });

      const response = await fetch(`${endpoint}?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(`Facebook page search failed: ${errorText}`);
        return [];
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      this.logger.warn(`Failed to search pages: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Search posts by keyword
   */
  async searchPostsByKeyword(keyword: string, maxResults: number = 50): Promise<any[]> {
    try {
      const accessToken = this.config.get<string>('FACEBOOK_ACCESS_TOKEN');
      const pageId = this.config.get<string>('FACEBOOK_PAGE_ID');

      if (!accessToken || !pageId) {
        this.logger.warn('Facebook credentials not configured');
        return [];
      }

      const posts = await this.getPagePosts(accessToken, pageId, maxResults);
      
      // Filter posts by keyword
      return posts.filter(post => 
        post.message && post.message.toLowerCase().includes(keyword.toLowerCase())
      );
    } catch (error) {
      this.logger.error(`Error searching Facebook posts: ${error}`);
      return [];
    }
  }

  /**
   * Get posts from a specific page
   */
  private async getPagePosts(
    accessToken: string,
    pageId: string,
    maxResults: number,
  ): Promise<any[]> {
    const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${pageId}/posts`;
    const params = new URLSearchParams({
      access_token: accessToken,
      fields: 'id,message,created_time,permalink_url,attachments{media{image{src}}},shares,reactions.summary(true),comments.summary(true)',
      limit: Math.min(maxResults, 100).toString(),
    });

    const response = await fetch(`${endpoint}?${params}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      this.logger.warn(`Failed to get page posts: ${errorText}`);
      return [];
    }

    const data = await response.json();
    const posts = data.data || [];

    const mappedPosts = posts.map((post: any) => {
      // Ensure we have a valid permalink
      let permalink = post.permalink_url;
      if (!permalink || !permalink.startsWith('http')) {
        permalink = this.constructFacebookUrl(post.id);
      }
      
      return {
        id: post.id,
        message: post.message || '',
        permalink: permalink,
        createdTime: post.created_time ? new Date(post.created_time) : new Date(),
        metrics: {
          likes: post.reactions?.summary?.total_count || 0,
          comments: post.comments?.summary?.total_count || 0,
          shares: post.shares?.count || 0,
        },
        mediaUrl: post.attachments?.data?.[0]?.media?.image?.src,
      };
    });

    this.logger.log(`Successfully mapped ${mappedPosts.length} Facebook posts from page with permalinks`);
    return mappedPosts;
  }

  /**
   * Search for hashtags/keywords on Facebook
   */
  async searchHashtags(
    keyword: string,
    accessToken?: string,
    options: {
      maxResults?: number;
      pageId?: string;
    } = {},
  ): Promise<any[]> {
    try {
      this.logger.log(`Searching Facebook for keyword: ${keyword}`);

      // Use searchPosts with pageId if provided
      if (options.pageId) {
        return this.searchPosts(keyword, accessToken, options);
      }

      // Try hashtag search
      if (keyword.startsWith('#')) {
        return this.searchHashtagPosts(
          this.getAccessToken(accessToken),
          keyword.substring(1),
          options.maxResults || 20,
        );
      }

      // Search posts with the keyword
      return this.searchPosts(keyword, accessToken, options);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to search Facebook hashtags: ${msg}`);
      // Return empty array instead of throwing to allow graceful degradation
      return [];
    }
  }

  /**
   * Search posts by hashtag
   */
  private async searchHashtagPosts(
    accessToken: string,
    hashtag: string,
    maxResults: number,
  ): Promise<any[]> {
    const cleanHashtag = hashtag.replace('#', '').trim();
    
    // Strategy 1: Search for pages with hashtag in name/description
    try {
      const pages = await this.searchPages(accessToken, `#${cleanHashtag}`, 10);
      
      if (pages.length > 0) {
        const allPosts: any[] = [];
        for (const page of pages) {
          try {
            const pagePosts = await this.getPagePosts(accessToken, page.id, maxResults);
            // Filter posts that contain the hashtag
            const hashtagPosts = pagePosts.filter((post: any) => {
              const message = (post.message || '').toLowerCase();
              return message.includes(`#${cleanHashtag}`) || message.includes(cleanHashtag);
            });
            allPosts.push(...hashtagPosts);
            
            if (allPosts.length >= maxResults) {
              break;
            }
          } catch (error) {
            continue;
          }
        }
        
        if (allPosts.length > 0) {
          return allPosts.slice(0, maxResults);
        }
      }
    } catch (error) {
      this.logger.warn(`Hashtag page search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Strategy 2: Search for pages by keyword, then filter posts with hashtag
    try {
      const pages = await this.searchPages(accessToken, cleanHashtag, 10);
      const allPosts: any[] = [];
      
      for (const page of pages) {
        try {
          const pagePosts = await this.getPagePosts(accessToken, page.id, maxResults);
          // Filter posts that contain the hashtag
          const hashtagPosts = pagePosts.filter((post: any) => {
            const message = (post.message || '').toLowerCase();
            return message.includes(`#${cleanHashtag}`) || message.includes(cleanHashtag);
          });
          allPosts.push(...hashtagPosts);
          
          if (allPosts.length >= maxResults) {
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      if (allPosts.length > 0) {
        return allPosts.slice(0, maxResults);
      }
    } catch (error) {
      this.logger.warn(`Hashtag keyword search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Fallback: return empty array
    this.logger.warn(`No posts found for hashtag: #${cleanHashtag}`);
    return [];
  }

  /**
   * Get comments from a Facebook post
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

      this.logger.log(`Fetching comments for Facebook post: ${postId}`);

      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${postId}/comments`;
      const params = new URLSearchParams({
        access_token: token,
        fields: 'id,message,created_time,from{id,name,picture},like_count,comment_count',
        limit: Math.min(maxResults, 100).toString(),
        order: 'chronological',
      });

      const response = await fetch(`${endpoint}?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Facebook comments fetch failed: ${errorText}`);
        throw new Error(`Facebook API error: ${response.status}`);
      }

      const data = await response.json();
      const comments = data.data || [];

      return comments.map((comment: any) => ({
        id: comment.id,
        message: comment.message || '',
        author: {
          id: comment.from?.id,
          name: comment.from?.name || 'Unknown',
          picture: comment.from?.picture?.data?.url,
        },
        createdTime: comment.created_time ? new Date(comment.created_time) : new Date(),
        likeCount: comment.like_count || 0,
        replyCount: comment.comment_count || 0,
      }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to fetch Facebook comments: ${msg}`);
      throw error;
    }
  }

  /**
   * Construct Facebook URL from post ID
   * Facebook post IDs can be in format: {page_id}_{post_id}
   */
  private constructFacebookUrl(postId: string): string {
    if (!postId) {
      return 'https://www.facebook.com';
    }
    
    // If post ID contains underscore, it's likely in format pageId_postId
    // Facebook permalink format: https://www.facebook.com/{page_id}/posts/{post_id}
    if (postId.includes('_')) {
      const [pageId, actualPostId] = postId.split('_');
      return `https://www.facebook.com/${pageId}/posts/${actualPostId}`;
    }
    
    // Fallback: try direct post ID
    return `https://www.facebook.com/${postId}`;
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
   * Extract hashtags from multiple posts
   */
  extractHashtagsFromPosts(posts: any[]): string[] {
    const allHashtags = new Set<string>();
    
    posts.forEach(post => {
      if (post.message) {
        const hashtags = this.extractHashtags(post.message);
        hashtags.forEach(tag => allHashtags.add(tag.toLowerCase()));
      }
    });

    return Array.from(allHashtags);
  }

  /**
   * Post a comment on a Facebook post or reply to a comment
   */
  async postComment(accessToken: string, postOrCommentId: string, message: string): Promise<{ id: string }> {
    try {
      const endpoint = `${this.graphBaseUrl}/${this.graphVersion}/${postOrCommentId}/comments`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          access_token: accessToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Facebook API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return { id: data.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to post Facebook comment: ${msg}`);
      throw error;
    }
  }
}

