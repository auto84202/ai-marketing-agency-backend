import { PrismaService } from '../src/prisma/prisma.service';
import { AdminSeedService } from '../src/admin/seed/admin-seed';

async function main() {
  const prisma = new PrismaService();
  const adminSeed = new AdminSeedService(prisma);

  try {
    await adminSeed.runSeed();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
