import { Module } from "@nestjs/common";
import { JwtModule, JwtModuleOptions } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({ 
  imports: [
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
  controllers: [ReportsController], 
  providers: [ReportsService] 
})
export class ReportsModule {}