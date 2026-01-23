import { Worker } from "bullmq";
// import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";


const prisma = new PrismaClient();
// const connection = new IORedis(process.env.REDIS_URL!);


export const reportWorker = new Worker(
"reports",
async (job) => {
const { reportId } = job.data as { reportId: string };


// TODO: Pull metrics from GA4/Search Console; for now, stub some data
const pdfUrl = `https://example-bucket.s3.amazonaws.com/reports/${reportId}.pdf`; // replace with actual upload


await prisma.report.update({ where: { id: reportId }, data: { metrics: { stub: true }, pdfUrl } });
return { reportId, pdfUrl };
},
// { connection }
);