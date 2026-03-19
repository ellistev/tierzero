/**
 * Fake Stripe API for billing tests (future).
 * Placeholder — captures subscription and payment events in memory.
 */

export interface MockSubscription {
  id: string;
  customerId: string;
  plan: string;
  status: "active" | "past_due" | "canceled";
  createdAt: string;
}

export interface MockPayment {
  id: string;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
  customerId: string;
  createdAt: string;
}

export class MockStripe {
  readonly subscriptions: MockSubscription[] = [];
  readonly payments: MockPayment[] = [];

  createSubscription(customerId: string, plan: string): MockSubscription {
    const sub: MockSubscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      customerId,
      plan,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    this.subscriptions.push(sub);
    return sub;
  }

  cancelSubscription(subId: string): void {
    const sub = this.subscriptions.find((s) => s.id === subId);
    if (sub) sub.status = "canceled";
  }

  processPayment(customerId: string, amount: number, currency = "usd"): MockPayment {
    const payment: MockPayment = {
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      amount,
      currency,
      status: "succeeded",
      customerId,
      createdAt: new Date().toISOString(),
    };
    this.payments.push(payment);
    return payment;
  }

  getCustomerPayments(customerId: string): MockPayment[] {
    return this.payments.filter((p) => p.customerId === customerId);
  }
}
