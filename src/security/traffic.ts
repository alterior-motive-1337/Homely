import { DomainError } from "../domain/transactions.js";

/** Bounded per-process rate limiter. Shared/distributed deployments need a Redis or DB-backed counter. */
export class RequestLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly maxKeys = 20_000, private readonly clock: () => number = Date.now) {}
  enforce(key: string, limit: number, windowMs: number): void {
    const now = this.clock();
    const old = this.buckets.get(key);
    if (!old || old.resetAt <= now) {
      if (this.buckets.size >= this.maxKeys) {
        for (const [k, value] of this.buckets) if (value.resetAt <= now) this.buckets.delete(k);
        if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
      }
      this.buckets.set(key, {count:1, resetAt:now+windowMs});
      return;
    }
    if (old.count >= limit) throw new DomainError("Too many requests. Try again later.", 429);
    old.count++;
  }
}
