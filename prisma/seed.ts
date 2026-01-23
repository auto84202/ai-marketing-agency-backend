import { PrismaClient, Role, CampaignType } from "@prisma/client";


const prisma = new PrismaClient();


async function main() {
const admin = await prisma.user.upsert({
where: { email: "admin@example.com" },
update: {},
create: { email: "admin@example.com", name: "Admin", password: "12345678", role: Role.ADMIN },
});




const campaign = await prisma.campaign.create({
data: { 
  userId: admin.id, 
  name: "Social Media Campaign",
  type: CampaignType.SOCIAL, 
  status: "active", 
  budget: 2000 
},
});


// await prisma.campaign.create({
// data: { campaignId: campaign.id, kind: AssetKind.CAPTION, draft: { text: "Hello world" } },
// });


console.log("Seed complete");
}


main().finally(async () => prisma.$disconnect());