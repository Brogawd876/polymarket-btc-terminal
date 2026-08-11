export class RequestGate {
  private activeRequestId: string | null = null;
  begin(requestId: string): boolean {
    if (this.activeRequestId) return false;
    this.activeRequestId = requestId;
    return true;
  }
  complete(requestId?: string): void {
    if (!requestId || requestId === this.activeRequestId) this.activeRequestId = null;
  }
  get active(): boolean { return this.activeRequestId !== null; }
}
