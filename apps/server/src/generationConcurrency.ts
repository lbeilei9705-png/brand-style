export class GenerationConcurrencyLimiter {
  private readonly activeByKey = new Map<string, number>();
  private readonly maximum: number;

  constructor(maximum: number) {
    this.maximum = maximum;
  }

  tryAcquire(key: string): boolean {
    const active = this.activeByKey.get(key) || 0;

    if (active >= this.maximum) {
      return false;
    }

    this.activeByKey.set(key, active + 1);
    return true;
  }

  release(key: string): void {
    const active = this.activeByKey.get(key) || 0;

    if (active <= 1) {
      this.activeByKey.delete(key);
      return;
    }

    this.activeByKey.set(key, active - 1);
  }

  active(key: string): number {
    return this.activeByKey.get(key) || 0;
  }
}
