export class TradingError extends Error {
  public code: string;

  constructor(message: string, code: string = 'UNKNOWN_ERROR') {
    super(message);
    this.name = 'TradingError';
    this.code = code;
  }
}
