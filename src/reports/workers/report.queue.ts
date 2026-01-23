// import { Queue } from "bullmq";
// // import IORedis from "ioredis";


// export const connection = new IORedis(process.env.REDIS_URL!);
// export const reportQueue = new Queue("reports", { connection });


// export type ReportJobPayload = {
// reportId: string;
// };


// export async function enqueueReport(reportId: string) {
// await reportQueue.add("generate", { reportId } as ReportJobPayload, {
// removeOnComplete: 100,
// removeOnFail: 100,
// attempts: 3,
// backoff: { type: "exponential", delay: 3000 },
// jobId: `report:${reportId}`,
// });
// }