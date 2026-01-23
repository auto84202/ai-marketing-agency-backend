import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createSystemUser() {
  try {
    // Check if system user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: 'system@aimarketingpro.com' },
    });

    if (existingUser) {
      console.log('✅ System user already exists:', existingUser.id);
      return existingUser;
    }

    // Create system user for leads
    const systemUser = await prisma.user.create({
      data: {
        id: 'system',
        email: 'system@aimarketingpro.com',
        name: 'System User',
        role: 'ADMIN',
        isActive: true,
      },
    });

    console.log('✅ System user created successfully:', systemUser.id);
    return systemUser;
  } catch (error) {
    console.error('❌ Error creating system user:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createSystemUser();

