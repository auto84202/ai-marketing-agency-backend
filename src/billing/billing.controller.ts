import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards, HttpException, HttpStatus } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { PrismaService } from "src/prisma/prisma.service";
import { Stripe } from "stripe";
import { AuthGuard } from "src/auth/auth.guard";

@Controller("billing")
export class BillingController {
    constructor(private billing: BillingService, private prisma: PrismaService) { }

    // Legacy intent endpoint for one-off payments
    @Post("intent")
    @UseGuards(AuthGuard)
    checkout(@Body() body: { userId?: string; amount: number, currency: string, }, @Req() req: any) {
        // SECURITY: Always use authenticated user's ID from JWT token
        const authenticatedUserId = req.user?.sub || req.user?.id;
        if (!authenticatedUserId) {
            throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
        }
        return this.billing.createCheckoutSession(body.amount, body.currency, { userId: authenticatedUserId });
    }

    // Create subscription checkout session (mode=subscription)
    @Post('create-subscription-session')
    @UseGuards(AuthGuard)
    async createSubscriptionSession(@Body() body: { userId?: string; priceId: string; }, @Req() req: any) {
        // SECURITY: Always use authenticated user's ID from JWT token - never trust userId from body
        const userId = req.user?.sub || req.user?.id;
        if (!userId) {
            throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
        }
        if (!body.priceId) {
            throw new HttpException('Price ID is required', HttpStatus.BAD_REQUEST);
        }
        try {
            const session = await this.billing.createSubscriptionCheckoutSession(userId, body.priceId);
            return { url: session.url, id: session.id };
        } catch (error: any) {
            // Preserve HTTP exceptions, convert others
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                error.message || 'Failed to create subscription session',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    // Create billing portal session
    @Post('create-portal-session')
    @UseGuards(AuthGuard)
    async createPortalSession(@Body() body: { userId?: string; }, @Req() req: any) {
        // SECURITY: Always use authenticated user's ID from JWT token - never trust userId from body
        const userId = req.user?.sub || req.user?.id;
        if (!userId) {
            throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
        }
        try {
            const session = await this.billing.createBillingPortalSession(userId);
            return { url: session.url };
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                error.message || 'Failed to create portal session',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    // Get subscription status for a user
    @Get('subscription/:userId')
    @UseGuards(AuthGuard)
    async getSubscription(@Param('userId') userId: string, @Req() req: any) {
        // Ensure user can only access their own subscription
        const requestingUserId = req.user?.sub || req.user?.id;
        if (requestingUserId !== userId) {
            throw new HttpException('Unauthorized: You can only access your own subscription', HttpStatus.FORBIDDEN);
        }
        try {
            const sub = await this.prisma.subscription.findUnique({ where: { userId } });
            return sub || null;
        } catch (error: any) {
            throw new HttpException(
                error.message || 'Failed to fetch subscription',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    @Post('cancel-subscription')
    @UseGuards(AuthGuard)
    async cancelSubscription(@Body() body: { userId?: string }, @Req() req: any) {
        // SECURITY: Always use authenticated user's ID from JWT token - never trust userId from body
        const userId = req.user?.sub || req.user?.id;
        if (!userId) {
            throw new HttpException('User ID is required', HttpStatus.UNAUTHORIZED);
        }
        try {
            const result = await this.billing.cancelSubscriptionByUser(userId);
            return result;
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                error.message || 'Failed to cancel subscription',
                error.status || HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    // Stripe webhook handler - expects raw body (configure main.ts to supply raw body for this route)
    @Post("webhook")
    async webhook(@Req() req: any, @Headers("stripe-signature") sig: string) {
        const secretKey = process.env.STRIPE_SECRET_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!secretKey || !webhookSecret) {
            throw new HttpException('Webhook configuration missing', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        if (!secretKey.startsWith('sk_')) {
            throw new HttpException('Invalid webhook configuration', HttpStatus.INTERNAL_SERVER_ERROR);
        }

        const buf = (req as any).rawBody || req.rawBody || req.body; // ensure raw body in main.ts if needed
        const stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });
        let event: Stripe.Event;

        try {
            event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
        } catch (err: any) {
            throw new HttpException('Invalid webhook signature', HttpStatus.BAD_REQUEST);
        }

        switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated": {
                const sub = event.data.object as Stripe.Subscription;
                const userId = (sub.metadata as any)?.userId;
                if (userId) {
                    await this.prisma.subscription.upsert({
                        where: { userId },
                        create: {
                            userId,
                            stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
                            stripeSubId: sub.id,
                            plan: (sub.items.data[0]?.price?.id) || undefined,
                            status: sub.status,
                            currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
                        },
                        update: {
                            stripeSubId: sub.id,
                            status: sub.status,
                            currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
                        },
                    });
                }
                break;
            }
            case "invoice.payment_succeeded": {
                const invoice = event.data.object as Stripe.Invoice;
                const subscriptionId = invoice.subscription as string;
                if (subscriptionId) {
                    // Get subscription to find userId
                    const sub = await stripe.subscriptions.retrieve(subscriptionId);
                    const userId = (sub.metadata as any)?.userId;
                    if (userId) {
                        await this.prisma.subscription.updateMany({ 
                            where: { userId }, 
                            data: { status: "active" } 
                        });
                    }
                } else {
                    // Try to get userId from invoice metadata
                    const userId = (invoice.metadata as any)?.userId;
                    if (userId) {
                        await this.prisma.subscription.updateMany({ 
                            where: { userId }, 
                            data: { status: "active" } 
                        });
                    }
                }
                break;
            }
            case "customer.subscription.deleted": {
                const sub = event.data.object as Stripe.Subscription;
                const userId = (sub.metadata as any)?.userId;
                if (userId) {
                    await this.prisma.subscription.updateMany({
                        where: { userId },
                        data: { status: "canceled", stripeSubId: null },
                    });
                }
                break;
            }
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                const subscriptionId = session.subscription as string;
                if (subscriptionId && session.mode === 'subscription') {
                    // Retrieve subscription to get userId from metadata
                    const sub = await stripe.subscriptions.retrieve(subscriptionId);
                    const userId = (sub.metadata as any)?.userId || (session.metadata as any)?.userId;
                    if (userId) {
                        await this.prisma.subscription.upsert({
                            where: { userId },
                            create: {
                                userId,
                                stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
                                stripeSubId: sub.id,
                                plan: (sub.items.data[0]?.price?.id) || undefined,
                                status: sub.status,
                                currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
                            },
                            update: {
                                stripeSubId: sub.id,
                                status: sub.status,
                                currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
                            },
                        });
                    }
                }
                break;
            }
            default:
                break;
        }

        return { received: true };
    }
}