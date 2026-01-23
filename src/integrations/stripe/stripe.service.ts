import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export interface StripeCustomer {
  id: string;
  email: string;
  name?: string;
  metadata?: any;
}

export interface StripeSubscription {
  id: string;
  customerId: string;
  priceId: string;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

export interface StripeInvoice {
  id: string;
  customerId: string;
  amount: number;
  currency: string;
  status: string;
  dueDate?: Date;
  paidAt?: Date;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe!: Stripe;
  private isConfigured = false;

  constructor(private configService: ConfigService) {
    this.initializeStripe();
  }

  /**
   * Initialize Stripe client
   * TODO: Configure when API keys are provided
   */
  private initializeStripe(): void {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const publishableKey = this.configService.get<string>('STRIPE_PUBLISHABLE_KEY');
    
    if (secretKey && secretKey !== 'your_stripe_secret_key_here') {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2024-06-20',
      });
      this.isConfigured = true;
      this.logger.log('Stripe service initialized successfully');
    } else {
      this.logger.warn('Stripe API keys not configured. Service will use mock responses.');
    }
  }

  /**
   * Create a customer
   * TODO: Implement when API keys are provided
   */
  async createCustomer(
    email: string,
    name?: string,
    metadata?: any,
  ): Promise<StripeCustomer> {
    try {
      if (!this.isConfigured) {
        return this.createMockCustomer(email, name, metadata);
      }

      this.logger.log(`Creating Stripe customer for email: ${email}`);

      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata,
      });

      return {
        id: customer.id,
        email: customer.email || email,
        name: customer.name || name,
        metadata: customer.metadata,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create customer: ${msg}`);
      throw error;
    }
  }

  /**
   * Get customer by ID
   */
  async getCustomer(customerId: string): Promise<StripeCustomer> {
    try {
      if (!this.isConfigured) {
        return this.getMockCustomer(customerId);
      }

      const customerRaw = await this.stripe.customers.retrieve(customerId);

      // Stripe retrieve may return a DeletedCustomer; narrow the type before accessing fields
      if ('deleted' in customerRaw && customerRaw.deleted) {
        throw new Error('Customer has been deleted');
      }

      const customer = customerRaw as Stripe.Customer;

      return {
        id: customer.id,
        email: customer.email || '',
        name: customer.name || undefined,
        metadata: customer.metadata,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get customer: ${msg}`);
      throw error;
    }
  }

  /**
   * Create a subscription
   * TODO: Implement when API keys are provided
   */
  async createSubscription(
    customerId: string,
    priceId: string,
    metadata?: any,
  ): Promise<StripeSubscription> {
    try {
      if (!this.isConfigured) {
        return this.createMockSubscription(customerId, priceId, metadata);
      }

      this.logger.log(`Creating subscription for customer: ${customerId}`);

      const subscription = await this.stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        metadata,
        expand: ['latest_invoice.payment_intent'],
      });

      return {
        id: subscription.id,
        customerId: subscription.customer as string,
        priceId: subscription.items.data[0].price.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create subscription: ${msg}`);
      throw error;
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId: string, immediately = false): Promise<StripeSubscription> {
    try {
      if (!this.isConfigured) {
        return this.cancelMockSubscription(subscriptionId);
      }

      this.logger.log(`Canceling subscription: ${subscriptionId}`);

      const subscription = immediately
        ? await this.stripe.subscriptions.cancel(subscriptionId)
        : await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
          });

      return {
        id: subscription.id,
        customerId: subscription.customer as string,
        priceId: subscription.items.data[0].price.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to cancel subscription: ${msg}`);
      throw error;
    }
  }

  /**
   * Create a payment intent
   */
  async createPaymentIntent(
    amount: number,
    currency: string = 'usd',
    customerId?: string,
    metadata?: any,
  ): Promise<any> {
    try {
      if (!this.isConfigured) {
        return this.createMockPaymentIntent(amount, currency, customerId, metadata);
      }

      this.logger.log(`Creating payment intent for amount: ${amount} ${currency}`);

      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        customer: customerId,
        metadata,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      return {
        id: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create payment intent: ${msg}`);
      throw error;
    }
  }

  /**
   * Create a checkout session
   */
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    metadata?: any,
  ): Promise<any> {
    try {
      if (!this.isConfigured) {
        return this.createMockCheckoutSession(customerId, priceId, successUrl, cancelUrl, metadata);
      }

      this.logger.log(`Creating checkout session for customer: ${customerId}`);

      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
      });

      return {
        id: session.id,
        url: session.url,
        customerId: session.customer,
        priceId,
        status: session.payment_status,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create checkout session: ${msg}`);
      throw error;
    }
  }

  /**
   * Get invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<StripeInvoice> {
    try {
      if (!this.isConfigured) {
        return this.getMockInvoice(invoiceId);
      }

      const invoice = await this.stripe.invoices.retrieve(invoiceId);

      return {
        id: invoice.id,
        customerId: invoice.customer as string,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status || 'draft',
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : undefined,
        paidAt: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : undefined,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get invoice: ${msg}`);
      throw error;
    }
  }

  /**
   * Handle webhook events
   */
  async handleWebhook(payload: string, signature: string): Promise<any> {
    try {
      if (!this.isConfigured) {
        return this.handleMockWebhook(payload);
      }

      const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
      
      if (!webhookSecret) {
        throw new Error('Webhook secret not configured');
      }

      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);

      this.logger.log(`Handling webhook event: ${event.type}`);

      switch (event.type) {
        case 'customer.subscription.created':
          return this.handleSubscriptionCreated(event.data.object);
        case 'customer.subscription.updated':
          return this.handleSubscriptionUpdated(event.data.object);
        case 'customer.subscription.deleted':
          return this.handleSubscriptionDeleted(event.data.object);
        case 'invoice.payment_succeeded':
          return this.handlePaymentSucceeded(event.data.object);
        case 'invoice.payment_failed':
          return this.handlePaymentFailed(event.data.object);
        default:
          this.logger.warn(`Unhandled webhook event type: ${event.type}`);
          return { received: true };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to handle webhook: ${msg}`);
      throw error;
    }
  }

  /**
   * Get subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<StripeSubscription> {
    try {
      if (!this.isConfigured) {
        return this.getMockSubscription(subscriptionId);
      }

      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

      return {
        id: subscription.id,
        customerId: subscription.customer as string,
        priceId: subscription.items.data[0].price.id,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get subscription: ${msg}`);
      throw error;
    }
  }

  /**
   * Handle subscription created webhook
   */
  private async handleSubscriptionCreated(subscription: any): Promise<any> {
    this.logger.log(`Subscription created: ${subscription.id}`);
    // TODO: Update database with subscription data
    return { processed: true, event: 'subscription.created' };
  }

  /**
   * Handle subscription updated webhook
   */
  private async handleSubscriptionUpdated(subscription: any): Promise<any> {
    this.logger.log(`Subscription updated: ${subscription.id}`);
    // TODO: Update database with subscription data
    return { processed: true, event: 'subscription.updated' };
  }

  /**
   * Handle subscription deleted webhook
   */
  private async handleSubscriptionDeleted(subscription: any): Promise<any> {
    this.logger.log(`Subscription deleted: ${subscription.id}`);
    // TODO: Update database with subscription data
    return { processed: true, event: 'subscription.deleted' };
  }

  /**
   * Handle payment succeeded webhook
   */
  private async handlePaymentSucceeded(invoice: any): Promise<any> {
    this.logger.log(`Payment succeeded for invoice: ${invoice.id}`);
    // TODO: Update database with payment data
    return { processed: true, event: 'payment.succeeded' };
  }

  /**
   * Handle payment failed webhook
   */
  private async handlePaymentFailed(invoice: any): Promise<any> {
    this.logger.log(`Payment failed for invoice: ${invoice.id}`);
    // TODO: Handle failed payment
    return { processed: true, event: 'payment.failed' };
  }

  /**
   * Mock methods for when Stripe is not configured
   */
  private createMockCustomer(email: string, name?: string, metadata?: any): StripeCustomer {
    return {
      id: `cus_mock_${Date.now()}`,
      email,
      name,
      metadata,
    };
  }

  private getMockCustomer(customerId: string): StripeCustomer {
    return {
      id: customerId,
      email: 'mock@example.com',
      name: 'Mock Customer',
      metadata: {},
    };
  }

  private createMockSubscription(customerId: string, priceId: string, metadata?: any): StripeSubscription {
    return {
      id: `sub_mock_${Date.now()}`,
      customerId,
      priceId,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      cancelAtPeriodEnd: false,
    };
  }

  private cancelMockSubscription(subscriptionId: string): StripeSubscription {
    return {
      id: subscriptionId,
      customerId: 'cus_mock',
      priceId: 'price_mock',
      status: 'canceled',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    };
  }

  private getMockSubscription(subscriptionId: string): StripeSubscription {
    return {
      id: subscriptionId,
      customerId: 'cus_mock',
      priceId: 'price_mock',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    };
  }

  private createMockPaymentIntent(amount: number, currency: string, customerId?: string, metadata?: any): any {
    return {
      id: `pi_mock_${Date.now()}`,
      clientSecret: `pi_mock_${Date.now()}_secret_mock`,
      amount: Math.round(amount * 100),
      currency,
      status: 'requires_payment_method',
      customer: customerId,
      metadata,
    };
  }

  private createMockCheckoutSession(customerId: string, priceId: string, successUrl: string, cancelUrl: string, metadata?: any): any {
    return {
      id: `cs_mock_${Date.now()}`,
      url: 'https://checkout.stripe.com/mock',
      customerId,
      priceId,
      status: 'open',
      metadata,
    };
  }

  private getMockInvoice(invoiceId: string): StripeInvoice {
    return {
      id: invoiceId,
      customerId: 'cus_mock',
      amount: 9999,
      currency: 'usd',
      status: 'paid',
      dueDate: new Date(),
      paidAt: new Date(),
    };
  }

  private handleMockWebhook(payload: string): any {
    this.logger.log('Handling mock webhook');
    return { processed: true, mock: true };
  }
}