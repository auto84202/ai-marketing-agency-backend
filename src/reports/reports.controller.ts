import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { OrgGuard } from "../common/guards/org.guard";
import { ReportsService } from "./reports.service";


@UseGuards(OrgGuard)
@Controller("reports")
export class ReportsController {
    constructor(private readonly service: ReportsService) { }


    @Post("generate")
    generate(@Body() body: { clientId: string; periodStart: string; periodEnd: string }, req: any) {
        return this.service.createAndEnqueue(body.clientId, new Date(body.periodStart), new Date(body.periodEnd));
    }


    @Get(":id")
    get(@Param("id") id: string) {
        return this.service.get(id);
    }
}