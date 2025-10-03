/**
 * Integration Test Credentials Management
 *
 * Provides environment-aware credential loading for integration tests.
 * - Local development: Reads from .env file
 * - CI/GitHub Actions: Uses GitHub secrets from process.env
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env file for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface N8nTestCredentials {
  url: string;
  apiKey: string;
  webhookWorkflows: {
    get: string;
    post: string;
    put: string;
    delete: string;
  };
  cleanup: {
    enabled: boolean;
    tag: string;
    namePrefix: string;
  };
}

/**
 * Get n8n credentials for integration tests
 *
 * Automatically detects environment (local vs CI) and loads
 * credentials from the appropriate source.
 *
 * @returns N8nTestCredentials
 * @throws Error if required credentials are missing
 */
export function getN8nCredentials(): N8nTestCredentials {
  if (process.env.CI) {
    // CI: Use GitHub secrets - validate required variables first
    const url = process.env.N8N_URL;
    const apiKey = process.env.N8N_API_KEY;

    if (!url || !apiKey) {
      throw new Error(
        'Missing required CI credentials:\n' +
        `  N8N_URL: ${url ? 'set' : 'MISSING'}\n` +
        `  N8N_API_KEY: ${apiKey ? 'set' : 'MISSING'}\n` +
        'Please configure GitHub secrets for integration tests.'
      );
    }

    return {
      url,
      apiKey,
      webhookWorkflows: {
        get: process.env.N8N_TEST_WEBHOOK_GET_ID || '',
        post: process.env.N8N_TEST_WEBHOOK_POST_ID || '',
        put: process.env.N8N_TEST_WEBHOOK_PUT_ID || '',
        delete: process.env.N8N_TEST_WEBHOOK_DELETE_ID || ''
      },
      cleanup: {
        enabled: true,
        tag: 'mcp-integration-test',
        namePrefix: '[MCP-TEST]'
      }
    };
  } else {
    // Local: Use .env file - validate required variables first
    const url = process.env.N8N_API_URL;
    const apiKey = process.env.N8N_API_KEY;

    if (!url || !apiKey) {
      throw new Error(
        'Missing required credentials in .env:\n' +
        `  N8N_API_URL: ${url ? 'set' : 'MISSING'}\n` +
        `  N8N_API_KEY: ${apiKey ? 'set' : 'MISSING'}\n\n` +
        'Please add these to your .env file.\n' +
        'See .env.example for configuration details.'
      );
    }

    return {
      url,
      apiKey,
      webhookWorkflows: {
        get: process.env.N8N_TEST_WEBHOOK_GET_ID || '',
        post: process.env.N8N_TEST_WEBHOOK_POST_ID || '',
        put: process.env.N8N_TEST_WEBHOOK_PUT_ID || '',
        delete: process.env.N8N_TEST_WEBHOOK_DELETE_ID || ''
      },
      cleanup: {
        enabled: process.env.N8N_TEST_CLEANUP_ENABLED !== 'false',
        tag: process.env.N8N_TEST_TAG || 'mcp-integration-test',
        namePrefix: process.env.N8N_TEST_NAME_PREFIX || '[MCP-TEST]'
      }
    };
  }
}

/**
 * Validate that required credentials are present
 *
 * @param creds - Credentials to validate
 * @throws Error if required credentials are missing
 */
export function validateCredentials(creds: N8nTestCredentials): void {
  const missing: string[] = [];

  if (!creds.url) {
    missing.push(process.env.CI ? 'N8N_URL' : 'N8N_API_URL');
  }
  if (!creds.apiKey) {
    missing.push('N8N_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required n8n credentials: ${missing.join(', ')}\n\n` +
      `Please set the following environment variables:\n` +
      missing.map(v => `  ${v}`).join('\n') + '\n\n' +
      `See .env.example for configuration details.`
    );
  }
}

/**
 * Validate that webhook workflow IDs are configured
 *
 * @param creds - Credentials to validate
 * @throws Error with setup instructions if webhook workflows are missing
 */
export function validateWebhookWorkflows(creds: N8nTestCredentials): void {
  const missing: string[] = [];

  if (!creds.webhookWorkflows.get) missing.push('GET');
  if (!creds.webhookWorkflows.post) missing.push('POST');
  if (!creds.webhookWorkflows.put) missing.push('PUT');
  if (!creds.webhookWorkflows.delete) missing.push('DELETE');

  if (missing.length > 0) {
    const envVars = missing.map(m => `N8N_TEST_WEBHOOK_${m}_ID`);

    throw new Error(
      `Missing webhook workflow IDs for HTTP methods: ${missing.join(', ')}\n\n` +
      `Webhook testing requires pre-activated workflows in n8n.\n` +
      `n8n API doesn't support workflow activation, so these must be created manually.\n\n` +
      `Setup Instructions:\n` +
      `1. Create ${missing.length} workflow(s) in your n8n instance\n` +
      `2. Each workflow should have a single Webhook node\n` +
      `3. Configure webhook paths:\n` +
      missing.map(m => `   - ${m}: mcp-test-${m.toLowerCase()}`).join('\n') + '\n' +
      `4. ACTIVATE each workflow in n8n UI\n` +
      `5. Set the following environment variables with workflow IDs:\n` +
      envVars.map(v => `   ${v}=<workflow-id>`).join('\n') + '\n\n' +
      `See docs/local/integration-testing-plan.md for detailed instructions.`
    );
  }
}

/**
 * Check if credentials are configured (non-throwing version)
 *
 * @returns true if basic credentials are available
 */
export function hasCredentials(): boolean {
  try {
    const creds = getN8nCredentials();
    return !!(creds.url && creds.apiKey);
  } catch {
    return false;
  }
}

/**
 * Check if webhook workflows are configured (non-throwing version)
 *
 * @returns true if all webhook workflow IDs are available
 */
export function hasWebhookWorkflows(): boolean {
  try {
    const creds = getN8nCredentials();
    return !!(
      creds.webhookWorkflows.get &&
      creds.webhookWorkflows.post &&
      creds.webhookWorkflows.put &&
      creds.webhookWorkflows.delete
    );
  } catch {
    return false;
  }
}
