import dotenv from 'dotenv';
import { z } from 'zod';
import { logger } from '../utils/logger';

export interface N8nApiConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

const MARKET_ENV_PATTERN = /^N8N_([A-Z0-9]+)_API_(URL|KEY|TIMEOUT|MAX_RETRIES)$/;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;

const configSchema = z.object({
  N8N_API_URL: z.string().url().optional(),
  N8N_API_KEY: z.string().min(1).optional(),
  N8N_API_TIMEOUT: z.coerce.number().positive().default(DEFAULT_TIMEOUT),
  N8N_API_MAX_RETRIES: z.coerce.number().positive().default(DEFAULT_MAX_RETRIES),
});

let envLoaded = false;
let cachedMarkets: Record<string, N8nApiConfig> | null = null;

function ensureEnv(): void {
  if (!envLoaded) {
    dotenv.config();
    envLoaded = true;
  }
}

function normalizeMarket(market: string): string {
  return market.trim().toUpperCase();
}

function parseBaseConfig(): z.infer<typeof configSchema> {
  const parsed = configSchema.safeParse(process.env);
  return parsed.success ? parsed.data : configSchema.parse({});
}

function loadMarketConfigs(): Record<string, N8nApiConfig> {
  ensureEnv();

  if (cachedMarkets) {
    return cachedMarkets;
  }

  const base = parseBaseConfig();
  const partials: Record<string, { url?: string; key?: string; timeout?: string; maxRetries?: string }> = {};

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envValue) continue;

    const match = envKey.match(MARKET_ENV_PATTERN);
    if (!match) continue;

    const [, rawMarket, field] = match;
    const market = normalizeMarket(rawMarket);
    partials[market] ??= {};

    switch (field) {
      case 'URL':
        partials[market].url = envValue;
        break;
      case 'KEY':
        partials[market].key = envValue;
        break;
      case 'TIMEOUT':
        partials[market].timeout = envValue;
        break;
      case 'MAX_RETRIES':
        partials[market].maxRetries = envValue;
        break;
      default:
        break;
    }
  }

  const configs: Record<string, N8nApiConfig> = {};

  for (const [market, values] of Object.entries(partials)) {
    const candidate = {
      N8N_API_URL: values.url,
      N8N_API_KEY: values.key,
      N8N_API_TIMEOUT: values.timeout ?? base.N8N_API_TIMEOUT,
      N8N_API_MAX_RETRIES: values.maxRetries ?? base.N8N_API_MAX_RETRIES,
    };

    const parsed = configSchema.safeParse(candidate);
    if (!parsed.success) {
      logger.warn(`Invalid n8n configuration for market ${market}: ${parsed.error.message}`);
      continue;
    }

    const config = parsed.data;
    if (!config.N8N_API_URL || !config.N8N_API_KEY) {
      logger.warn(`Incomplete n8n configuration for market ${market}: missing URL or API key`);
      continue;
    }

    configs[market] = {
      baseUrl: config.N8N_API_URL,
      apiKey: config.N8N_API_KEY,
      timeout: config.N8N_API_TIMEOUT,
      maxRetries: config.N8N_API_MAX_RETRIES,
    };
  }

  cachedMarkets = configs;
  return configs;
}

export function resetN8nApiConfigCache(): void {
  cachedMarkets = null;
}

export function getN8nApiConfig(market?: string): N8nApiConfig | null {
  ensureEnv();

  if (market) {
    const configs = loadMarketConfigs();
    return configs[normalizeMarket(market)] ?? null;
  }

  const base = configSchema.safeParse(process.env);
  if (!base.success) {
    return null;
  }

  const config = base.data;
  if (!config.N8N_API_URL || !config.N8N_API_KEY) {
    return null;
  }

  return {
    baseUrl: config.N8N_API_URL,
    apiKey: config.N8N_API_KEY,
    timeout: config.N8N_API_TIMEOUT,
    maxRetries: config.N8N_API_MAX_RETRIES,
  };
}

export function getN8nApiConfigForMarket(market: string): N8nApiConfig | null {
  return getN8nApiConfig(market);
}

export function getAvailableMarkets(): string[] {
  return Object.keys(loadMarketConfigs());
}

export function getDefaultMarket(): string | null {
  ensureEnv();

  const explicitDefault = process.env.N8N_DEFAULT_MARKET;
  if (explicitDefault) {
    const normalized = normalizeMarket(explicitDefault);
    if (getN8nApiConfig(normalized)) {
      return normalized;
    }
  }

  const markets = getAvailableMarkets();
  if (markets.length === 1) {
    return markets[0];
  }

  if (getN8nApiConfig()) {
    return 'GLOBAL';
  }

  return null;
}

export function isN8nApiConfigured(market?: string): boolean {
  if (market) {
    return getN8nApiConfig(market) !== null;
  }

  const markets = getAvailableMarkets();
  if (markets.length > 0) {
    return markets.some(m => getN8nApiConfig(m) !== null);
  }

  return getN8nApiConfig() !== null;
}

export function getN8nApiConfigFromContext(context: {
  n8nApiUrl?: string;
  n8nApiKey?: string;
  n8nApiTimeout?: number;
  n8nApiMaxRetries?: number;
}): N8nApiConfig | null {
  if (!context.n8nApiUrl || !context.n8nApiKey) {
    return null;
  }

  return {
    baseUrl: context.n8nApiUrl,
    apiKey: context.n8nApiKey,
    timeout: context.n8nApiTimeout ?? DEFAULT_TIMEOUT,
    maxRetries: context.n8nApiMaxRetries ?? DEFAULT_MAX_RETRIES,
  };
}
