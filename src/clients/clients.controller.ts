import { Controller, Get, Post, Body, Patch, Put, Param, Delete, Query, UseGuards, Request, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { AuthGuard } from '../auth/auth.guard';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  /**
   * Create a lead from contact form (no auth required)
   */
  @Post('lead')
  async createLead(@Body() createLeadDto: CreateLeadDto) {
    return this.clientsService.createLead(createLeadDto);
  }

  /**
   * Create a new client
   */
  @Post()
  @UseGuards(AuthGuard)
  async create(@Request() req: any, @Body() createClientDto: CreateClientDto) {
    try {
      console.log('Request user object:', req.user);
      console.log('User sub:', req.user.sub);
      console.log('Client DTO:', createClientDto);
      return await this.clientsService.create(req.user.sub, createClientDto);
    } catch (error: any) {
      console.error('Error in create client controller:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Handle Prisma errors
      if (errorMessage.includes('Unique constraint')) {
        throw new BadRequestException('A client with this email already exists.');
      }
      
      // Handle validation errors
      if (errorMessage.includes('validation') || errorMessage.includes('required')) {
        throw new BadRequestException(errorMessage);
      }
      
      // Re-throw the error with proper status
      throw new HttpException(
        errorMessage || 'Failed to create client',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get all clients with pagination
   */
  @Get()
  @UseGuards(AuthGuard)
  async findAll(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const options = {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    };
    
    // Admin users can see all clients, regular users see only their own
    const isAdmin = req.user.role === 'ADMIN';
    return this.clientsService.findAll(req.user.sub, options, isAdmin);
  }

  /**
   * Get a specific client
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.clientsService.findOne(req.user.sub, id);
  }

  /**
   * Update a client (PATCH)
   */
  @Patch(':id')
  @UseGuards(AuthGuard)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    return this.clientsService.update(req.user.sub, id, updateClientDto);
  }

  /**
   * Update a client (PUT)
   */
  @Put(':id')
  @UseGuards(AuthGuard)
  async updatePut(
    @Request() req: any,
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ) {
    return this.clientsService.update(req.user.sub, id, updateClientDto);
  }

  /**
   * Delete a client
   */
  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Request() req: any, @Param('id') id: string) {
    return this.clientsService.remove(req.user.sub, id);
  }

  /**
   * Get client analytics
   */
  @Get(':id/analytics')
  @UseGuards(AuthGuard)
  async getAnalytics(@Request() req: any, @Param('id') id: string) {
    return this.clientsService.getAnalytics(req.user.sub, id);
  }

  /**
   * Get client dashboard
   */
  @Get(':id/dashboard')
  @UseGuards(AuthGuard)
  async getDashboard(@Request() req: any, @Param('id') id: string) {
    return this.clientsService.getDashboard(req.user.sub, id);
  }
}
