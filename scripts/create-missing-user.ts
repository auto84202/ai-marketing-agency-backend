import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Create the user that's in the JWT token
  const hashedPassword = await bcrypt.hash('Password123!', 10);
  
  const user = await prisma.user.upsert({
    where: { id: 'cmklbvdb10001v2548kbokuid' },
    update: {},
    create: {
      id: 'cmklbvdb10001v2548kbokuid',
      email: 'auto84202@gmail.com',
      password: hashedPassword,
      name: 'Test User',
      role: 'USER',
      isActive: true,
    },
  });

  console.log('✅ User created:', user.email);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
