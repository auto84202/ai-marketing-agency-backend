import { Controller, Get, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Controller('ai/images')
export class ImageDownloadController {
  /**
   * Proxy endpoint to download images (bypasses CORS)
   * This endpoint doesn't require authentication as it's just proxying images
   */
  @Get('download')
  async downloadImage(
    @Query('url') imageUrl: string,
    @Query('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!imageUrl) {
      throw new HttpException('Image URL is required', HttpStatus.BAD_REQUEST);
    }

    try {
      // Decode the URL if it's encoded
      let decodedUrl = decodeURIComponent(imageUrl);
      
      // If the URL is relative (starts with /), make it absolute to localhost
      if (decodedUrl.startsWith('/')) {
        decodedUrl = `http://localhost:3001${decodedUrl}`;
      }

      console.log(`[ImageDownload] Attempting to download from URL: ${decodedUrl}`);

      // Fetch the image from the URL
      // OpenAI DALL-E images are publicly accessible but may expire
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      try {
        const response = await fetch(decodedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'image/*',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
      
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          console.error(`[ImageDownload] Failed to fetch image: ${response.status} ${response.statusText}`, {
            url: decodedUrl,
            errorText: errorText.substring(0, 500), // Limit error text length
          });
          
          // Provide more specific error messages
          let errorMessage = `Failed to fetch image: ${response.status} ${response.statusText}`;
          
          if (response.status === 403) {
            // Check if it's an OpenAI URL that might have expired
            if (decodedUrl.includes('oaidalleapiprodscus') || decodedUrl.includes('dalle') || decodedUrl.includes('openai.com')) {
              errorMessage = 'Image URL has expired. OpenAI DALL-E image URLs are temporary and expire after a period of time. Please generate a new image.';
            } else if (decodedUrl.includes('blob.core.windows.net') || decodedUrl.includes('azure')) {
              errorMessage = 'Image URL requires authentication. This appears to be an Azure Blob Storage URL that requires authentication.';
            } else {
              errorMessage = 'Image URL requires authentication or access has been denied. The image may have expired or moved.';
            }
          } else if (response.status === 404) {
            errorMessage = 'Image not found. The image URL may have expired or been deleted.';
          } else if (response.status === 410) {
            errorMessage = 'Image URL has expired or been removed. Please generate a new image.';
          }
          
          throw new HttpException(errorMessage, HttpStatus.BAD_REQUEST);
        }

        // Check if response is an image
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
          console.warn(`[ImageDownload] Unexpected content type: ${contentType}`);
        }

        // Get the image buffer
        const buffer = await response.arrayBuffer();
        
        if (!buffer || buffer.byteLength === 0) {
          throw new HttpException('Downloaded image is empty', HttpStatus.BAD_REQUEST);
        }

        // Set headers for download
        const downloadFilename = filename || 'generated-image.png';
        res.setHeader('Content-Type', contentType || 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        res.setHeader('Content-Length', buffer.byteLength.toString());
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        // Send the image
        res.send(Buffer.from(buffer));
        
        console.log(`[ImageDownload] Successfully downloaded image: ${downloadFilename} (${buffer.byteLength} bytes)`);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        // Check if it was a timeout
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new HttpException('Image download timed out. The image URL may be unreachable or the server is too slow.', HttpStatus.REQUEST_TIMEOUT);
        }
        
        // Re-throw if it's already an HttpException
        if (fetchError instanceof HttpException) {
          throw fetchError;
        }
        
        // Handle other fetch errors
        const msg = fetchError instanceof Error ? fetchError.message : 'Failed to download image';
        console.error(`[ImageDownload] Error:`, fetchError);
        throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to download image';
      console.error(`[ImageDownload] Error:`, error);
      const statusCode = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(msg, statusCode);
    }
  }
}
