import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards, Request, UnauthorizedException } from "@nestjs/common";
import { OrgGuard } from "../common/guards/org.guard";
import { CampaignsService } from "./campaigns.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { UpdateCampaignDto } from "./dto/update-campaign.dto";


@UseGuards(OrgGuard)
@Controller("campaigns")
export class CampaignsController {
    constructor(private readonly service: CampaignsService) { }


    @Get()
    list(@Request() req: any) {
        // Always use authenticated user's ID from JWT token (req.user.sub)
        // Never trust userId from query parameters - security vulnerability
        const authenticatedUserId = req.user?.sub;
        if (!authenticatedUserId) {
            throw new UnauthorizedException('User ID is required');
        }
        return this.service.list(authenticatedUserId, req.isAdmin);
    }

    /**
     * Get Instagram posts with comments for dashboard
     * This route must come before @Get(":id") to avoid route conflicts
     * Query parameter: ?refresh=true to fetch live posts
     */
    @Get("instagram-posts")
    async getInstagramPosts(@Request() req: any) {
        const authenticatedUserId = req.user?.sub;
        if (!authenticatedUserId) {
            throw new UnauthorizedException('User ID is required');
        }
        const refresh = req.query?.refresh === 'true' || req.query?.refresh === true;
        return this.service.getInstagramPostsForDashboard(authenticatedUserId, refresh);
    }

    /**
     * Get Facebook posts with comments for dashboard
     * This route must come before @Get(":id") to avoid route conflicts
     * Query parameter: ?refresh=true to fetch live posts
     */
    @Get("facebook-posts")
    async getFacebookPosts(@Request() req: any) {
        const authenticatedUserId = req.user?.sub;
        if (!authenticatedUserId) {
            throw new UnauthorizedException('User ID is required');
        }
        const refresh = req.query?.refresh === 'true' || req.query?.refresh === true;
        return this.service.getFacebookPostsForDashboard(authenticatedUserId, refresh);
    }

    @Get(":id")
    async findOne(@Param("id") id: string, @Request() req: any) {
        // Always use authenticated user's ID from JWT token
        const authenticatedUserId = req.user?.sub;
        if (!authenticatedUserId) {
            throw new UnauthorizedException('User ID is required');
        }
        return this.service.findOne(id, authenticatedUserId, req.isAdmin);
    }

    @Post()
    create(@Body() dto: CreateCampaignDto, @Request() req: any) {
        // SECURITY: Always use authenticated user's ID from JWT token
        // Never trust userId from DTO - security vulnerability
        const authenticatedUserId = req.user?.sub;
        if (!authenticatedUserId) {
            throw new UnauthorizedException('User ID is required');
        }
        // Remove userId from DTO if present to prevent security vulnerability
        const { userId, ...safeDto } = dto as any;
        return this.service.create(safeDto as CreateCampaignDto, authenticatedUserId);
    }


    @Put(":id")
    async update(@Param("id") id: string, @Body() dto: UpdateCampaignDto, @Request() req: any) {
        // Always use authenticated user's ID from JWT token
        const authenticatedUserId = req.user?.sub;
        if (!authenticatedUserId) {
            throw new UnauthorizedException('User ID is required');
        }
        return this.service.update(authenticatedUserId, id, dto, req.isAdmin);
    }

    @Delete(":id")
    async delete(@Param("id") id: string, @Request() req: any) {
        // Always use authenticated user's ID from JWT token
        const authenticatedUserId = req.user?.sub;
        if (!authenticatedUserId) {
            throw new UnauthorizedException('User ID is required');
        }
        return this.service.delete(id, authenticatedUserId, req.isAdmin);
    }
}