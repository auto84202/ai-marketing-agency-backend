import { ScraperStatus } from '@prisma/client';

export class ScraperJobResponseDto {
    id!: string;
    userId!: string;
    platform!: string;
    keyword!: string;
    googlePages!: number;
    replyLimit!: number;
    status!: ScraperStatus;
    progress!: number;
    totalComments!: number;
    totalReplies!: number;
    errorMessage?: string;
    startedAt?: Date;
    completedAt?: Date;
    createdAt!: Date;
    updatedAt!: Date;
}
