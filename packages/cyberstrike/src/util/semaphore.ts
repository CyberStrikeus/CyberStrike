export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve() }))
  }
  release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}
