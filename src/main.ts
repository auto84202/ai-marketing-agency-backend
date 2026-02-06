import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import * as bodyParser from 'body-parser';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, abortOnError: false });

    // Serve static files from uploads directory
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
        prefix: '/uploads/',
    });

    // Add global validation pipe
    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false, // Allow extra fields but strip them
        transform: true,
        disableErrorMessages: false,
        validationError: {
            target: false,
            value: false,
        },
        transformOptions: {
            enableImplicitConversion: true,
        },
    }));

    // CORS configuration - MUST be before helmet
    const isDevelopment = process.env.NODE_ENV !== 'production';

    const allowedOrigins: string[] = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
    ];

    // Add APP_URL (your Vercel frontend URL)
    if (process.env.APP_URL) {
        allowedOrigins.push(process.env.APP_URL);
        console.log(`✅ Added APP_URL to CORS: ${process.env.APP_URL}`);
    }

    // Add FRONTEND_URL if it exists and is different from APP_URL
    if (process.env.FRONTEND_URL && process.env.FRONTEND_URL !== process.env.APP_URL) {
        allowedOrigins.push(process.env.FRONTEND_URL);
        console.log(`✅ Added FRONTEND_URL to CORS: ${process.env.FRONTEND_URL}`);
    }

    // Add BACKEND_URL (ngrok URL for local backend exposure)
    if (process.env.BACKEND_URL) {
        allowedOrigins.push(process.env.BACKEND_URL);
        console.log(`✅ Added BACKEND_URL (ngrok) to CORS: ${process.env.BACKEND_URL}`);
    }

    // Add additional frontend URLs (for multiple Vercel deployments)
    if (process.env.ADDITIONAL_FRONTEND_URLS) {
        const additionalUrls = process.env.ADDITIONAL_FRONTEND_URLS.split(',').map(url => url.trim());
        additionalUrls.forEach(url => {
            if (url && !allowedOrigins.includes(url)) {
                allowedOrigins.push(url);
                console.log(`✅ Added additional frontend URL to CORS: ${url}`);
            }
        });
    }

    // Always add the known Vercel URL as a fallback
    const vercelUrl = 'https://ai-marketing-agency-frontend.vercel.app';
    if (!allowedOrigins.includes(vercelUrl)) {
        allowedOrigins.push(vercelUrl);
        console.log(`✅ Added Vercel URL to CORS: ${vercelUrl}`);
    }

    console.log('🌐 CORS Configuration:');
    console.log(`   Environment: ${isDevelopment ? 'Development' : 'Production'}`);
    console.log(`   Allowed Origins:`, allowedOrigins);

    app.enableCors({
        origin: (origin, callback) => {
            // Allow requests with no origin (mobile apps, Postman, curl, etc.)
            if (!origin) {
                return callback(null, true);
            }

            // In development, allow all origins
            if (isDevelopment) {
                return callback(null, true);
            }

            // Check if origin matches allowed origins
            if (allowedOrigins.includes(origin)) {
                console.log(`✅ CORS allowed origin: ${origin}`);
                return callback(null, true);
            }

            // Allow ngrok URLs (pattern: https://*.ngrok.io or https://*.ngrok-free.app)
            if (origin.match(/^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/i) ||
                origin.match(/^https:\/\/[a-z0-9-]+\.ngrok\.io$/i)) {
                console.log(`✅ CORS allowed ngrok origin: ${origin}`);
                return callback(null, true);
            }

            // Allow Vercel preview deployments (pattern: https://*.vercel.app)
            if (origin.match(/^https:\/\/.*\.vercel\.app$/i)) {
                console.log(`✅ CORS allowed Vercel origin: ${origin}`);
                return callback(null, true);
            }

            // Block all other origins
            console.warn(`⚠️  CORS blocked origin: ${origin}`);
            console.warn(`   Allowed origins are:`, allowedOrigins);
            console.warn(`   Also allowing: *.ngrok.io, *.ngrok-free.app, *.vercel.app`);
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-org-id',
            'Accept',
            'Origin',
            'X-Requested-With',
            'Access-Control-Request-Method',
            'Access-Control-Request-Headers',
        ],
        exposedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400, // 24 hours
        preflightContinue: false,
        optionsSuccessStatus: 204,
    });

    // Configure helmet to be less restrictive in development
    if (isDevelopment) {
        app.use(helmet({
            contentSecurityPolicy: false, // Disable CSP in development for easier debugging
            crossOriginEmbedderPolicy: false,
        }));
    } else {
        app.use(helmet({
            contentSecurityPolicy: false, // Disable for API
            crossOriginEmbedderPolicy: false, // Less restrictive for production
        }));
    }

    app.use(cookieParser());

    app.use(
        pinoHttp({
            transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
        }) as any
    );

    // Stripe requires the raw request body for webhook signature verification. Configure the
    // express raw body parser on the webhook path so other JSON routes are unaffected.
    app.use('/billing/webhook', bodyParser.raw({ type: 'application/json' }));

    // Backend runs on port 3001 by default, frontend runs on port 3000
    const port = process.env.PORT || 3001;
    await app.listen(port);
    console.log(`🚀 Backend server is running on: http://localhost:${port}`);
    console.log(`📡 API endpoints available at: http://localhost:${port}/auth/*`);
    console.log(`🏥 Health check: http://localhost:${port}/ping`);
}

bootstrap().catch((error) => {
    console.error('❌ Failed to start the server:', error);
    console.error('Error details:', error.message);
    if (error.message?.includes('connect') || error.message?.includes('ECONNREFUSED')) {
        console.error('\n💡 Common issues:');
        console.error('   1. Database not running - Check PostgreSQL is running');
        console.error('   2. DATABASE_URL not set - Check your .env file');
        console.error('   3. Redis not running (optional but recommended)');
    }
    process.exit(1);
});
