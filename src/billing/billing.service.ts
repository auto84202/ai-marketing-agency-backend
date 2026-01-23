import { Injectable, Logger, BadRequestException, InternalServerErrorException } from "@nestjs/common";
import Stripe from "stripe";
import { PrismaService } from "src/prisma/prisma.service";


@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: Stripe | null = null;
  private isStripeConfigured = false;

  constructor(private prisma: PrismaService) {
    this.initializeStripe();
  }

  /**
   * Initialize Stripe client with proper error handling
   */
  private initializeStripe(): void {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY not configured. Payment features will be disabled.');
      this.isStripeConfigured = false;
      return;
    }

    // Validate Stripe key format
    if (!secretKey.startsWith('sk_')) {
      this.logger.error('Invalid STRIPE_SECRET_KEY format. Must start with "sk_"');
      this.isStripeConfigured = false;
      return;
    }

    // Check if it's a placeholder key
    if (secretKey.includes('your_stripe') || secretKey.includes('here') || secretKey.length < 32) {
      this.logger.warn('STRIPE_SECRET_KEY appears to be a placeholder. Payment features will be disabled.');
      this.isStripeConfigured = false;
      return;
    }

    try {
      this.stripe = new Stripe(secretKey, { 
        apiVersion: "2024-06-20",
      });
      this.isStripeConfigured = true;
      this.logger.log('Stripe initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Stripe:', error);
      this.isStripeConfigured = false;
    }
  }

  /**
   * Check if Stripe is properly configured
   */
  private ensureStripeConfigured(): void {
    if (!this.isStripeConfigured || !this.stripe) {
      throw new BadRequestException(
        'Payment service is not configured. Please contact support or check your Stripe API keys.'
      );
    }
  }

  // Legacy payment intent helper (keeps existing behavior)
  createCheckoutSession(amount: number, currency: string, metadata: any) {
    this.ensureStripeConfigured();
    
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not available');
    }

    return this.stripe.paymentIntents
      .create({
        amount: amount,
        currency: currency,
        metadata: metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      })
      .catch((err: any) => {
        this.logger.error('createCheckoutSession error', err);
        // Don't expose sensitive Stripe error details
        if (err.type === 'StripeAuthenticationError') {
          throw new BadRequestException('Invalid payment configuration. Please contact support.');
        }
        throw new InternalServerErrorException('Failed to create payment session. Please try again.');
      });
  }

  // Ensure a Stripe customer exists for the given userId. If so, return the customer id.
  async ensureCustomerForUser(userId: string) {
    this.ensureStripeConfigured();
    
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not available');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // Check existing subscription/customer mapping
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (sub?.stripeCustomerId) return sub.stripeCustomerId;

    try {
      // Create customer in Stripe
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId },
      });

      // Persist in DB (create or upsert subscription record)
      await this.prisma.subscription.upsert({
        where: { userId },
        create: { userId, stripeCustomerId: customer.id, status: 'pending' },
        update: { stripeCustomerId: customer.id },
      });

      return customer.id;
    } catch (error: any) {
      this.logger.error('Failed to create Stripe customer:', error);
      if (error.type === 'StripeAuthenticationError') {
        throw new BadRequestException('Invalid payment configuration. Please contact support.');
      }
      throw new InternalServerErrorException('Failed to create customer. Please try again.');
    }
  }

  // Create a Stripe Checkout Session for a recurring subscription
  async createSubscriptionCheckoutSession(userId: string, priceId: string) {
    this.ensureStripeConfigured();
    
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not available');
    }

    // Validate priceId format
    if (!priceId || !priceId.startsWith('price_')) {
      throw new BadRequestException('Invalid price ID format. Must start with "price_"');
    }

    try {
      const customerId = await this.ensureCustomerForUser(userId);

      const successUrl = process.env.STRIPE_SUCCESS_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = process.env.STRIPE_CANCEL_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/billing/cancel`;

      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId },
        subscription_data: {
          metadata: { userId },
        },
      });

      return session;
    } catch (error: any) {
      this.logger.error('Failed to create checkout session:', error);
      
      // Handle specific Stripe errors without exposing sensitive details
      if (error.type === 'StripeAuthenticationError') {
        throw new BadRequestException('Invalid payment configuration. Please contact support.');
      }
      if (error.type === 'StripeInvalidRequestError') {
        throw new BadRequestException(error.message || 'Invalid request. Please check your subscription plan.');
      }
      
      throw new InternalServerErrorException('Failed to create checkout session. Please try again.');
    }
  }

  // Create a Stripe Billing Portal session to allow the user to manage their subscription
  async createBillingPortalSession(userId: string) {
    this.ensureStripeConfigured();
    
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not available');
    }

    try {
      const customerId = await this.ensureCustomerForUser(userId);
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: process.env.FRONTEND_URL || 'http://localhost:3000',
      });
      return session;
    } catch (error: any) {
      this.logger.error('Failed to create billing portal session:', error);
      if (error.type === 'StripeAuthenticationError') {
        throw new BadRequestException('Invalid payment configuration. Please contact support.');
      }
      throw new InternalServerErrorException('Failed to create billing portal session. Please try again.');
    }
  }

  // Cancel a subscription (by userId)
  async cancelSubscriptionByUser(userId: string) {
    this.ensureStripeConfigured();
    
    if (!this.stripe) {
      throw new InternalServerErrorException('Payment service not available');
    }

    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub?.stripeSubId) {
      throw new BadRequestException('No active subscription found');
    }

    try {
      const result = await this.stripe.subscriptions.cancel(sub.stripeSubId);
      await this.prisma.subscription.update({ where: { userId }, data: { status: result.status } });
      return result;
    } catch (error: any) {
      this.logger.error('Failed to cancel subscription:', error);
      if (error.type === 'StripeAuthenticationError') {
        throw new BadRequestException('Invalid payment configuration. Please contact support.');
      }
      throw new InternalServerErrorException('Failed to cancel subscription. Please try again.');
    }
  }
}