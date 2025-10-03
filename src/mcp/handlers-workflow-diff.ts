/**
 * MCP Handler for Partial Workflow Updates
 * Handles diff-based workflow modifications
 */

import { z } from 'zod';
import { McpToolResponse } from '../types/n8n-api';
import { WorkflowDiffRequest, WorkflowDiffOperation } from '../types/workflow-diff';
import { WorkflowDiffEngine } from '../services/workflow-diff-engine';
import { getN8nApiClient } from './handlers-n8n-manager';
import { N8nApiError, getUserFriendlyErrorMessage } from '../utils/n8n-errors';
import { logger } from '../utils/logger';
import { InstanceContext } from '../types/instance-context';

// Zod schema for the diff request
const marketParamSchema = z.object({
  market: z.string().min(1, 'Market is required')
});

const workflowDiffSchema = marketParamSchema.extend({
  id: z.string(),
  operations: z.array(z.object({
    type: z.string(),
    description: z.string().optional(),
    // Node operations
    node: z.any().optional(),
    nodeId: z.string().optional(),
    nodeName: z.string().optional(),
    updates: z.any().optional(),
    position: z.tuple([z.number(), z.number()]).optional(),
    // Connection operations
    source: z.string().optional(),
    target: z.string().optional(),
    sourceOutput: z.string().optional(),
    targetInput: z.string().optional(),
    sourceIndex: z.number().optional(),
    targetIndex: z.number().optional(),
    ignoreErrors: z.boolean().optional(),
    // Connection cleanup operations
    dryRun: z.boolean().optional(),
    connections: z.any().optional(),
    // Metadata operations
    settings: z.any().optional(),
    name: z.string().optional(),
    tag: z.string().optional(),
  })),
  validateOnly: z.boolean().optional(),
  continueOnError: z.boolean().optional(),
});

export async function handleUpdatePartialWorkflow(args: unknown, context?: InstanceContext): Promise<McpToolResponse> {
  try {
    // Debug logging (only in debug mode)
    if (process.env.DEBUG_MCP === 'true') {
      logger.debug('Workflow diff request received', {
        argsType: typeof args,
        hasWorkflowId: args && typeof args === 'object' && 'workflowId' in args,
        operationCount: args && typeof args === 'object' && 'operations' in args ? 
          (args as any).operations?.length : 0
      });
    }
    
    // Validate input
    const input = workflowDiffSchema.parse(args);
    const { market, ...rest } = input;
    const resolvedContext: InstanceContext = { ...(context ?? {}), market };

    // Get API client
    const client = getN8nApiClient(resolvedContext);
    if (!client) {
      return {
        success: false,
        error: `n8n API not configured for market ${market}. Please set N8N_${market}_API_URL and N8N_${market}_API_KEY environment variables.`
      };
    }
    
    // Fetch current workflow
    let workflow;
    try {
      workflow = await client.getWorkflow(rest.id);
    } catch (error) {
      if (error instanceof N8nApiError) {
        return {
          success: false,
          error: getUserFriendlyErrorMessage(error),
          code: error.code
        };
      }
      throw error;
    }
    
    // Apply diff operations
    const diffEngine = new WorkflowDiffEngine();
    const diffRequest = rest as WorkflowDiffRequest;
    const diffResult = await diffEngine.applyDiff(workflow, diffRequest);

    // Check if this is a complete failure or partial success in continueOnError mode
    if (!diffResult.success) {
      // In continueOnError mode, partial success is still valuable
      if (diffRequest.continueOnError && diffResult.workflow && diffResult.operationsApplied && diffResult.operationsApplied > 0) {
        logger.info(`continueOnError mode: Applying ${diffResult.operationsApplied} successful operations despite ${diffResult.failed?.length || 0} failures`);
        // Continue to update workflow with partial changes
      } else {
        // Complete failure - return error
        return {
          success: false,
          error: 'Failed to apply diff operations',
          details: {
            errors: diffResult.errors,
            operationsApplied: diffResult.operationsApplied,
            applied: diffResult.applied,
            failed: diffResult.failed
          }
        };
      }
    }
    
    // If validateOnly, return validation result
    if (rest.validateOnly) {
      return {
        success: true,
        message: diffResult.message,
        data: {
          valid: true,
          operationsToApply: rest.operations.length
        }
      };
    }
    
    // Update workflow via API
    try {
      const updatedWorkflow = await client.updateWorkflow(rest.id, diffResult.workflow!);
      
      return {
        success: true,
        data: updatedWorkflow,
        message: `Workflow "${updatedWorkflow.name}" updated successfully. Applied ${diffResult.operationsApplied} operations.`,
        details: {
          operationsApplied: diffResult.operationsApplied,
          workflowId: updatedWorkflow.id,
          workflowName: updatedWorkflow.name,
          applied: diffResult.applied,
          failed: diffResult.failed,
          errors: diffResult.errors
        }
      };
    } catch (error) {
      if (error instanceof N8nApiError) {
        return {
          success: false,
          error: getUserFriendlyErrorMessage(error),
          code: error.code,
          details: error.details as Record<string, unknown> | undefined
        };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: 'Invalid input',
        details: { errors: error.errors }
      };
    }
    
    logger.error('Failed to update partial workflow', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}
