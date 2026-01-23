import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue, QueueEvents, Worker, WorkerOptions } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';

export type QueueWorkerSettings = Omit<WorkerOptions, 'connection' | 'prefix'>;

export interface QueueWorkerOptions {
  concurrency?: number;
  settings?: QueueWorkerSettings;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection: IORedis;
  private readonly queuePrefix: string;
  private readonly queues = new Map<string, Queue>();
  private readonly events = new Map<string, QueueEvents>();
  private readonly defaultJobOptions: JobsOptions;
  private readonly defaultConcurrency: number;

  constructor(private readonly configService: ConfigService) {
    this.queuePrefix =
      this.configService.get<string>('QUEUE_PREFIX') ||
      this.configService.get<string>('APP_NAME') ||
      'ai-marketing';

    const attempts = Number(this.configService.get<string>('QUEUE_DEFAULT_ATTEMPTS') ?? 5);
    const concurrency = Number(this.configService.get<string>('QUEUE_DEFAULT_CONCURRENCY') ?? 5);
    const backoffDelay = Number(this.configService.get<string>('QUEUE_BACKOFF_DELAY_MS') ?? 5000);

    this.defaultJobOptions = {
      attempts,
      removeOnComplete: true,
      removeOnFail: false,
      backoff: {
        type: 'exponential',
        delay: backoffDelay,
      },
    };

    this.defaultConcurrency = concurrency;

    this.connection = this.createRedisConnection(this.queuePrefix);

    this.logger.log(
      `QueueService initialized with prefix "${this.queuePrefix}", attempts=${attempts}, concurrency=${concurrency}`,
    );
  }

  /**
   * Add a job to a queue.
   */
  async addJob<T = Record<string, unknown>>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobsOptions,
  ) {
    const queue = this.getQueue(queueName);

    return queue.add(jobName, data, {
      ...this.defaultJobOptions,
      ...options,
    });
  }

  /**
   * Add multiple jobs at once.
   */
  async addBulk(
    queueName: string,
    jobs: Array<{ name: string; data: any; options?: JobsOptions }>,
  ) {
    const queue = this.getQueue(queueName);

    return queue.addBulk(
      jobs.map((job) => ({
        name: job.name,
        data: job.data,
        opts: {
          ...this.defaultJobOptions,
          ...job.options,
        },
      })),
    );
  }

  /**
   * Create a worker for a queue.
   */
  createWorker<T = any, R = any>(
    queueName: string,
    processor: (job: import('bullmq').Job<T, R>) => Promise<R>,
    options?: QueueWorkerOptions,
  ) {
    const worker = new Worker<T, R>(queueName, processor, {
      prefix: this.queuePrefix,
      connection: this.connection,
      concurrency: options?.concurrency ?? this.defaultConcurrency,
      ...options?.settings,
    });

    worker.on('completed', (job) => {
      this.logger.debug(`Queue "${queueName}" job "${job.name}" completed (id=${job.id}).`);
    });

    worker.on('failed', (job, err) => {
      this.logger.error(
        `Queue "${queueName}" job "${job?.name}" failed (id=${job?.id}): ${err?.message}`,
        err?.stack,
      );
    });

    return worker;
  }

  /**
   * Get queue job counts.
   */
  async getJobCounts(queueName: string) {
    const queue = this.getQueue(queueName);
    return queue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed');
  }

  /**
   * Returns QueueEvents for the queue (singleton per queue).
   */
  getQueueEvents(queueName: string) {
    if (!this.events.has(queueName)) {
      this.events.set(
        queueName,
        new QueueEvents(queueName, {
          prefix: this.queuePrefix,
          connection: this.connection,
        }),
      );
    }

    return this.events.get(queueName)!;
  }

  /**
   * Gracefully close redis connections.
   */
  async onModuleDestroy() {
    this.logger.log('Shutting down queues and Redis connection...');

    for (const queue of this.queues.values()) {
      await queue.close();
    }

    for (const events of this.events.values()) {
      await events.close();
    }

    await this.connection.quit();
  }

  private getQueue(queueName: string) {
    if (!this.queues.has(queueName)) {
      this.logger.log(`Creating queue "${queueName}"`);

      const queue = new Queue(queueName, {
        prefix: this.queuePrefix,
        connection: this.connection,
        defaultJobOptions: this.defaultJobOptions,
      });

      this.queues.set(queueName, queue);
    }

    return this.queues.get(queueName)!;
  }

  private createRedisConnection(prefix: string) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    // BullMQ requires maxRetriesPerRequest to be null for shared connections
    const enableTLS =
      this.configService.get<string>('REDIS_TLS') === 'true' ||
      this.configService.get<string>('REDIS_TLS') === '1';

    let connection: IORedis;

    if (redisUrl) {
      connection = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        tls: enableTLS ? {} : undefined,
        retryStrategy: (times) => {
          // Retry with exponential backoff, but don't fail the app
          const delay = Math.min(times * 50, 2000);
          if (times > 10) {
            this.logger.warn('Redis connection failed after 10 retries. Queue features will be unavailable.');
            return null; // Stop retrying
          }
          return delay;
        },
        lazyConnect: true, // Don't connect immediately
      });
    } else {
      const options: RedisOptions = {
        host: this.configService.get<string>('REDIS_HOST') ?? '127.0.0.1',
        port: Number(this.configService.get<string>('REDIS_PORT') ?? 6379),
        db: Number(this.configService.get<string>('REDIS_DB') ?? 0),
        username: this.configService.get<string>('REDIS_USERNAME'),
        password: this.configService.get<string>('REDIS_PASSWORD'),
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          // Retry with exponential backoff, but don't fail the app
          const delay = Math.min(times * 50, 2000);
          if (times > 10) {
            this.logger.warn('Redis connection failed after 10 retries. Queue features will be unavailable.');
            return null; // Stop retrying
          }
          return delay;
        },
        lazyConnect: true, // Don't connect immediately
      };

      if (enableTLS) {
        options.tls = {};
      }

      connection = new IORedis(options);
    }

    connection.on('error', (err) => {
      // Only log errors, don't crash the app
      this.logger.warn(`Redis connection error: ${err.message}. Queue features may be unavailable.`);
    });

    connection.on('connect', () => {
      this.logger.log('Connected to Redis successfully.');
    });

    connection.on('close', () => {
      this.logger.warn('Redis connection closed.');
    });

    // Attempt to connect in the background, but don't block startup
    connection.connect().catch((err) => {
      this.logger.warn(`Redis connection failed: ${err.message}. Queue features will be unavailable until Redis is started.`);
    });

    return connection;
  }
}