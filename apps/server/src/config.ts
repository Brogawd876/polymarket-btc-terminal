import { z } from 'zod';

const BooleanStringSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  ENABLE_LIVE_TRADING: BooleanStringSchema.default('false'),
  PRIVATE_KEY: z.string().min(1).optional(),
  POLY_FUNDER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  POLY_SIGNATURE_TYPE: z.coerce.number().int().min(0).max(3).default(3),
  POLY_API_KEY_NONCE: z.coerce.number().int().nonnegative().default(0),
  // Short legacy tokens are ignored and replaced with a random runtime token.
  WS_AUTH_TOKEN: z.string().optional(),
  EXTENSION_ID: z.string().regex(/^[a-p]{32}$/).default('jkpghfeaioigocjjdfeeocfjilhjbdno'),
  POLYMARKET_DATA_DIR: z.string().min(1).optional(),
  POLYMARKET_DB_PATH: z.string().min(1).optional(),
  POLYMARKET_RUNTIME_DIR: z.string().min(1).optional(),
  MARKET_FAMILY: z.string().default('btc-up-or-down-5m'),
  MARKET_SLUG_PREFIX: z.string().default('btc-updown-5m'),
  MARKET_SLOT_MS: z.coerce.number().int().positive().default(300000),
  MIN_TIME_REMAINING_MS: z.coerce.number().int().min(5000).default(10000),
  MAX_MARKET_DATA_AGE_MS: z.coerce.number().int().min(500).default(3000),
  MAX_REFERENCE_DATA_AGE_MS: z.coerce.number().int().min(500).default(5000),
  MAX_SINGLE_BUY_USD: z.coerce.number().positive().default(100),
  MAX_OPEN_EXPOSURE_USD: z.coerce.number().positive().default(500),
  MAX_POSITION_SHARES: z.coerce.number().positive().default(1000),
  MAX_OPEN_ORDERS: z.coerce.number().int().positive().default(20),
  MAX_SESSION_LOSS: z.coerce.number().positive().default(10),
  MAX_SESSION_PROFIT: z.coerce.number().positive().default(150),
  MAX_FAK_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(5000).default(200),
  CHAINLINK_RTDS_URL: z.string().url().default('wss://ws-live-data.polymarket.com'),
}).superRefine((config, ctx) => {
  if (!config.ENABLE_LIVE_TRADING) return;
  if (!config.PRIVATE_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PRIVATE_KEY'], message: 'PRIVATE_KEY is required when live trading is enabled' });
  }
  if (!config.POLY_FUNDER_ADDRESS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['POLY_FUNDER_ADDRESS'], message: 'POLY_FUNDER_ADDRESS is required when live trading is enabled' });
  }
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'configuration'}: ${issue.message}`);
    throw new Error(`CONFIGURATION ERROR\n${details.join('\n')}`);
  }
  cachedConfig = parsed.data;
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = null;
}

export function getAllowedExtensionOrigin(config: AppConfig = loadConfig()): string {
  return `chrome-extension://${config.EXTENSION_ID}`;
}

export function getPublicConfigSummary(config: AppConfig = loadConfig()) {
  return {
    nodeEnv: config.NODE_ENV,
    host: config.HOST,
    port: config.PORT,
    liveTradingConfigured: config.ENABLE_LIVE_TRADING && Boolean(config.PRIVATE_KEY && config.POLY_FUNDER_ADDRESS),
    signatureType: config.POLY_SIGNATURE_TYPE,
    extensionId: config.EXTENSION_ID,
    minimumTimeRemainingMs: config.MIN_TIME_REMAINING_MS,
    maximumMarketDataAgeMs: config.MAX_MARKET_DATA_AGE_MS,
    maximumReferenceDataAgeMs: config.MAX_REFERENCE_DATA_AGE_MS,
  };
}
