import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

// Core modules
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";

// Feature modules
import { CampaignsModule } from "./campaigns/campaigns.module";
import { ReportsModule } from "./reports/reports.module";
import { BillingModule } from "./billing/billing.module";
import { ClientsModule } from "./clients/clients.module";
import { AiModule } from "./ai/ai.module";
import { WorkflowsModule } from "./workflows/workflows.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { StatsModule } from "./stats/stats.module";
import { AdminModule } from "./admin/admin.module";
import { KeywordScannerModule } from "./keyword-scanner/keyword-scanner.module";
import { SocialScraperModule } from "./social-scraper/social-scraper.module";

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        QueueModule,
        
        // Core modules
        AuthModule,
        UsersModule,
        
        // Feature modules
        CampaignsModule,
        ReportsModule,
        BillingModule,
        ClientsModule,
        AiModule,
        WorkflowsModule,
        NotificationsModule,
        StatsModule,
        AdminModule,
        KeywordScannerModule,
        SocialScraperModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule { }