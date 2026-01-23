import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { AuthModule } from "src/auth/auth.module";

@Module({ 
    imports: [AuthModule],
    controllers: [BillingController], 
    providers: [BillingService] 
})
export class BillingModule {}