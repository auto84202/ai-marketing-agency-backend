import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
// import { enqueueReport } from "./workers/report.queue";


@Injectable()
export class ReportsService {
constructor(private prisma: PrismaService) {}


async createAndEnqueue(userId: string, periodStart: Date, periodEnd: Date) {
// verify client belongs to org
await this.prisma.user.findFirstOrThrow({ where: { id: userId,  } });
const report = await this.prisma.report.create({ data: { userId, periodStart, periodEnd, metrics: {} } });
// await enqueueReport(report.id);
return report;
}


get(id: string) {
return this.prisma.report.findUniqueOrThrow({ where: { id } });
}
}