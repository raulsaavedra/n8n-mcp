import { ToolDocumentation } from '../types';

export const n8nTriggerWebhookWorkflowDoc: ToolDocumentation = {
  name: 'n8n_trigger_webhook_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Trigger workflow via webhook. Must be ACTIVE with Webhook node. Method must match config.',
    keyParameters: ['webhookUrl', 'httpMethod', 'data'],
    example: 'n8n_trigger_webhook_workflow({webhookUrl: "https://n8n.example.com/webhook/abc-def-ghi"})',
    performance: 'Immediate trigger, response time depends on workflow complexity',
    tips: [
      'Workflow MUST be active and contain a Webhook node for triggering',
      'HTTP method must match webhook node configuration (often GET)',
      'Use waitForResponse:false for async execution without waiting'
    ]
  },
  full: {
    description: `Triggers a workflow execution via its webhook URL. This is the primary method for external systems to start n8n workflows. The target workflow must be active and contain a properly configured Webhook node as the trigger. The HTTP method used must match the webhook configuration.`,
    parameters: {
      webhookUrl: {
        type: 'string',
        required: true,
        description: 'Full webhook URL from n8n workflow (e.g., https://n8n.example.com/webhook/abc-def-ghi)'
      },
      httpMethod: {
        type: 'string',
        required: false,
        enum: ['GET', 'POST', 'PUT', 'DELETE'],
        description: 'HTTP method (must match webhook configuration, often GET). Defaults to GET if not specified'
      },
      data: {
        type: 'object',
        required: false,
        description: 'Data to send with the webhook request. For GET requests, becomes query parameters'
      },
      headers: {
        type: 'object',
        required: false,
        description: 'Additional HTTP headers to include in the request'
      },
      waitForResponse: {
        type: 'boolean',
        required: false,
        description: 'Wait for workflow completion and return results (default: true). Set to false for fire-and-forget'
      }
    },
    returns: `Webhook response data if waitForResponse is true, or immediate acknowledgment if false. Response format depends on webhook node configuration.`,
    examples: [
      'n8n_trigger_webhook_workflow({webhookUrl: "https://n8n.example.com/webhook/order-process"}) - Trigger with GET',
      'n8n_trigger_webhook_workflow({webhookUrl: "https://n8n.example.com/webhook/data-import", httpMethod: "POST", data: {name: "John", email: "john@example.com"}}) - POST with data',
      'n8n_trigger_webhook_workflow({webhookUrl: "https://n8n.example.com/webhook/async-job", waitForResponse: false}) - Fire and forget',
      'n8n_trigger_webhook_workflow({webhookUrl: "https://n8n.example.com/webhook/api", headers: {"API-Key": "secret"}}) - With auth headers'
    ],
    useCases: [
      'Trigger data processing workflows from external applications',
      'Start scheduled jobs manually via webhook',
      'Integrate n8n workflows with third-party services',
      'Create REST API endpoints using n8n workflows',
      'Implement event-driven architectures with n8n'
    ],
    performance: `Performance varies based on workflow complexity and waitForResponse setting. Synchronous calls (waitForResponse: true) block until workflow completes. For long-running workflows, use async mode (waitForResponse: false) and monitor execution separately.`,
    errorHandling: `**Enhanced Error Messages with Execution Guidance**

When a webhook trigger fails, the error response now includes specific guidance to help debug the issue:

**Error with Execution ID** (workflow started but failed):
- Format: "Workflow {workflowId} execution {executionId} failed. Use n8n_get_execution({id: '{executionId}', mode: 'preview'}) to investigate the error."
- Response includes: executionId and workflowId fields for direct access
- Recommended action: Use n8n_get_execution with mode='preview' for fast, efficient error inspection

**Error without Execution ID** (workflow didn't start):
- Format: "Workflow failed to execute. Use n8n_list_executions to find recent executions, then n8n_get_execution with mode='preview' to investigate."
- Recommended action: Check recent executions with n8n_list_executions

**Why mode='preview'?**
- Fast: <50ms response time
- Efficient: ~500 tokens (vs 50K+ for full mode)
- Safe: No timeout or token limit risks
- Informative: Shows structure, counts, and error details
- Provides recommendations for fetching more data if needed

**Example Error Responses**:
\`\`\`json
{
  "success": false,
  "error": "Workflow wf_123 execution exec_456 failed. Use n8n_get_execution({id: 'exec_456', mode: 'preview'}) to investigate the error.",
  "executionId": "exec_456",
  "workflowId": "wf_123",
  "code": "SERVER_ERROR"
}
\`\`\`

**Investigation Workflow**:
1. Trigger returns error with execution ID
2. Call n8n_get_execution({id: executionId, mode: 'preview'}) to see structure and error
3. Based on preview recommendation, fetch more data if needed
4. Fix issues in workflow and retry`,
    bestPractices: [
      'Always verify workflow is active before attempting webhook triggers',
      'Match HTTP method exactly with webhook node configuration',
      'Use async mode (waitForResponse: false) for long-running workflows',
      'Include authentication headers when webhook requires them',
      'Test webhook URL manually first to ensure it works',
      'When errors occur, use n8n_get_execution with mode="preview" first for efficient debugging',
      'Store execution IDs from error responses for later investigation'
    ],
    pitfalls: [
      'Workflow must be ACTIVE - inactive workflows cannot be triggered',
      'HTTP method mismatch returns 404 even if URL is correct',
      'Webhook node must be the trigger node in the workflow',
      'Timeout errors occur with long workflows in sync mode',
      'Data format must match webhook node expectations',
      'Error messages always include n8n_get_execution guidance - follow the suggested steps for efficient debugging',
      'Execution IDs in error responses are crucial for debugging - always check for and use them'
    ],
    relatedTools: ['n8n_get_execution', 'n8n_list_executions', 'n8n_get_workflow', 'n8n_create_workflow']
  }
};