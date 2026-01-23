-- Migration: Add Social Scraper Tables
-- Description: Adds tables for social media scraping functionality

-- Create ScraperJob table
CREATE TABLE IF NOT EXISTS "ScraperJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "googlePages" INTEGER NOT NULL DEFAULT 1,
    "replyLimit" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalComments" INTEGER NOT NULL DEFAULT 0,
    "totalReplies" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP,
    "completedAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- Create ScrapedComment table
CREATE TABLE IF NOT EXISTS "ScrapedComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "postUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "timePosted" TEXT,
    "hoursAgo" REAL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("jobId") REFERENCES "ScraperJob"("id") ON DELETE CASCADE
);

-- Create ScraperReply table
CREATE TABLE IF NOT EXISTS "ScraperReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL UNIQUE,
    "username" TEXT NOT NULL,
    "replyText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "repliedAt" TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("jobId") REFERENCES "ScraperJob"("id") ON DELETE CASCADE,
    FOREIGN KEY ("commentId") REFERENCES "ScrapedComment"("id") ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "ScraperJob_userId_idx" ON "ScraperJob"("userId");
CREATE INDEX IF NOT EXISTS "ScraperJob_platform_idx" ON "ScraperJob"("platform");
CREATE INDEX IF NOT EXISTS "ScraperJob_status_idx" ON "ScraperJob"("status");
CREATE INDEX IF NOT EXISTS "ScraperJob_createdAt_idx" ON "ScraperJob"("createdAt");

CREATE INDEX IF NOT EXISTS "ScrapedComment_jobId_idx" ON "ScrapedComment"("jobId");
CREATE INDEX IF NOT EXISTS "ScrapedComment_platform_idx" ON "ScrapedComment"("platform");
CREATE INDEX IF NOT EXISTS "ScrapedComment_username_idx" ON "ScrapedComment"("username");

CREATE INDEX IF NOT EXISTS "ScraperReply_jobId_idx" ON "ScraperReply"("jobId");
CREATE INDEX IF NOT EXISTS "ScraperReply_status_idx" ON "ScraperReply"("status");
