import { Module, forwardRef } from "@nestjs/common";
import { JwtModule, JwtModuleOptions } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";
import { PrismaModule } from "../prisma/prisma.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { ChatbotModule } from "../ai/chatbot/chatbot.module";

@Module({ 
    imports: [
        PrismaModule,
        WorkflowsModule,
        forwardRef(() => ChatbotModule),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (configService: ConfigService): Promise<JwtModuleOptions> => ({
                secret: configService.get<string>('JWT_SECRET') || 'your-super-secret-jwt-key-here-make-this-very-long-and-secure',
                signOptions: { 
                    expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '7d') as any
                },
            }),
            inject: [ConfigService],
        }),
    ],
    controllers: [CampaignsController], 
    providers: [CampaignsService] 
})
export class CampaignsModule {}