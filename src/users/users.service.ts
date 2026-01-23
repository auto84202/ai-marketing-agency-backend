import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      this.logger.log('Creating new user');

      // Ensure the role (if provided as string) is cast to the Prisma Role enum type
      const createData: any = {
        ...createUserDto,
      };

      // Only hash password if it's provided (not for OAuth users)
      if (createUserDto.password) {
        createData.password = await bcrypt.hash(createUserDto.password, 10);
      }

      if (createData.role && typeof createData.role === 'string') {
        createData.role = createData.role as any; // cast to Prisma Role
      }

      const user = await this.prisma.user.create({
        data: createData,
      });

      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as any;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create user: ${msg}`);
      throw error;
    }
  }

  async findAll(options?: { page?: number; limit?: number }) {
    try {
      this.logger.log('Getting all users');

      const page = options?.page || 1;
      const limit = options?.limit || 30; // Increased from 10 to 30 to show all users
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        this.prisma.user.findMany({
          skip,
          take: limit,
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            company: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                campaigns: true,
                clients: true,
                aiContent: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.user.count(),
      ]);

      return {
        success: true,
        data: users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get users: ${msg}`);
      throw error;
    }
  }

  async findOne(id: string) {
    try {
      this.logger.log(`Getting user ${id}`);

      const user = await this.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          company: true,
          phone: true,
          avatar: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              campaigns: true,
              clients: true,
              aiContent: true,
              socialPosts: true,
              chatbots: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return {
        success: true,
        data: user,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get user: ${msg}`);
      throw error;
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      this.logger.log(`Updating user ${id}`);

      const existingUser = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

  let updateData: any = { ...updateUserDto };

      // Hash password if it's being updated
      if (updateUserDto.password) {
        updateData.password = await bcrypt.hash(updateUserDto.password, 10);
      }

      // Cast role if it's provided as a string to satisfy Prisma enum typing
      if (updateData.role && typeof updateData.role === 'string') {
        updateData.role = updateData.role as any;
      }

      const user = await this.prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          company: true,
          phone: true,
          avatar: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        success: true,
        data: user,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update user: ${msg}`);
      throw error;
    }
  }

  async remove(id: string) {
    try {
      this.logger.log(`Deleting user ${id}`);

      const existingUser = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      // Soft delete by setting isActive to false
      await this.prisma.user.update({
        where: { id },
        data: { isActive: false },
      });

      return {
        success: true,
        message: 'User deleted successfully',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete user: ${msg}`);
      throw error;
    }
  }

  async findByEmail(email: string) {
    try {
      this.logger.log(`Finding user by email: ${email}`);
      const user = await this.prisma.user.findUnique({
        where: { email },
      });

      if (user) {
        this.logger.log(`User found: ${email}`);
      } else {
        this.logger.log(`User not found: ${email}`);
      }
      
      return user;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to find user by email: ${msg}`);
      // Check if it's a database connection error
      if (msg.includes('connect') || msg.includes('ECONNREFUSED') || msg.includes('timeout')) {
        this.logger.error('Database connection error. Please check your DATABASE_URL and ensure the database server is running.');
      }
      throw error;
    }
  }

  async updateLastLogin(id: string) {
    try {
      await this.prisma.user.update({
        where: { id },
        data: { lastLoginAt: new Date() },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update last login: ${msg}`);
    }
  }
}