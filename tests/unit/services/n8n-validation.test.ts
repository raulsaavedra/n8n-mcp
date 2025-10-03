import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  workflowNodeSchema,
  workflowConnectionSchema,
  workflowSettingsSchema,
  defaultWorkflowSettings,
  validateWorkflowNode,
  validateWorkflowConnections,
  validateWorkflowSettings,
  cleanWorkflowForCreate,
  cleanWorkflowForUpdate,
  validateWorkflowStructure,
  hasWebhookTrigger,
  getWebhookUrl,
  getWorkflowStructureExample,
  getWorkflowFixSuggestions,
} from '../../../src/services/n8n-validation';
import { WorkflowBuilder } from '../../utils/builders/workflow.builder';
import { z } from 'zod';
import { WorkflowNode, WorkflowConnection, Workflow } from '../../../src/types/n8n-api';

describe('n8n-validation', () => {
  describe('Zod Schemas', () => {
    describe('workflowNodeSchema', () => {
      it('should validate a complete valid node', () => {
        const validNode = {
          id: 'node-1',
          name: 'Test Node',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          position: [100, 200],
          parameters: { key: 'value' },
          credentials: { api: 'cred-id' },
          disabled: false,
          notes: 'Test notes',
          notesInFlow: true,
          continueOnFail: true,
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 1000,
          alwaysOutputData: true,
          executeOnce: false,
        };

        const result = workflowNodeSchema.parse(validNode);
        expect(result).toEqual(validNode);
      });

      it('should validate a minimal valid node', () => {
        const minimalNode = {
          id: 'node-1',
          name: 'Test Node',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          position: [100, 200],
          parameters: {},
        };

        const result = workflowNodeSchema.parse(minimalNode);
        expect(result).toEqual(minimalNode);
      });

      it('should reject node with missing required fields', () => {
        const invalidNode = {
          name: 'Test Node',
          type: 'n8n-nodes-base.set',
        };

        expect(() => workflowNodeSchema.parse(invalidNode)).toThrow();
      });

      it('should reject node with invalid position format', () => {
        const invalidNode = {
          id: 'node-1',
          name: 'Test Node',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          position: [100], // Should be tuple of 2 numbers
          parameters: {},
        };

        expect(() => workflowNodeSchema.parse(invalidNode)).toThrow();
      });

      it('should reject node with invalid type values', () => {
        const invalidNode = {
          id: 'node-1',
          name: 'Test Node',
          type: 'n8n-nodes-base.set',
          typeVersion: '3', // Should be number
          position: [100, 200],
          parameters: {},
        };

        expect(() => workflowNodeSchema.parse(invalidNode)).toThrow();
      });
    });

    describe('workflowConnectionSchema', () => {
      it('should validate valid connections', () => {
        const validConnections = {
          'node-1': {
            main: [[{ node: 'node-2', type: 'main', index: 0 }]],
          },
          'node-2': {
            main: [
              [
                { node: 'node-3', type: 'main', index: 0 },
                { node: 'node-4', type: 'main', index: 0 },
              ],
            ],
          },
        };

        const result = workflowConnectionSchema.parse(validConnections);
        expect(result).toEqual(validConnections);
      });

      it('should validate empty connections', () => {
        const emptyConnections = {};
        const result = workflowConnectionSchema.parse(emptyConnections);
        expect(result).toEqual(emptyConnections);
      });

      it('should reject invalid connection structure', () => {
        const invalidConnections = {
          'node-1': {
            main: [{ node: 'node-2', type: 'main', index: 0 }], // Should be array of arrays
          },
        };

        expect(() => workflowConnectionSchema.parse(invalidConnections)).toThrow();
      });

      it('should reject connections missing required fields', () => {
        const invalidConnections = {
          'node-1': {
            main: [[{ node: 'node-2' }]], // Missing type and index
          },
        };

        expect(() => workflowConnectionSchema.parse(invalidConnections)).toThrow();
      });
    });

    describe('workflowSettingsSchema', () => {
      it('should validate complete settings', () => {
        const completeSettings = {
          executionOrder: 'v1' as const,
          timezone: 'America/New_York',
          saveDataErrorExecution: 'all' as const,
          saveDataSuccessExecution: 'all' as const,
          saveManualExecutions: true,
          saveExecutionProgress: true,
          executionTimeout: 300,
          errorWorkflow: 'error-handler-workflow',
        };

        const result = workflowSettingsSchema.parse(completeSettings);
        expect(result).toEqual(completeSettings);
      });

      it('should apply defaults for missing fields', () => {
        const minimalSettings = {};
        const result = workflowSettingsSchema.parse(minimalSettings);
        
        expect(result).toEqual({
          executionOrder: 'v1',
          saveDataErrorExecution: 'all',
          saveDataSuccessExecution: 'all',
          saveManualExecutions: true,
          saveExecutionProgress: true,
        });
      });

      it('should reject invalid enum values', () => {
        const invalidSettings = {
          executionOrder: 'v2', // Invalid enum value
        };

        expect(() => workflowSettingsSchema.parse(invalidSettings)).toThrow();
      });
    });
  });

  describe('Validation Functions', () => {
    describe('validateWorkflowNode', () => {
      it('should validate and return a valid node', () => {
        const node = {
          id: 'test-1',
          name: 'Test',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: {},
        };

        const result = validateWorkflowNode(node);
        expect(result).toEqual(node);
      });

      it('should throw for invalid node', () => {
        const invalidNode = { name: 'Test' };
        expect(() => validateWorkflowNode(invalidNode)).toThrow();
      });
    });

    describe('validateWorkflowConnections', () => {
      it('should validate and return valid connections', () => {
        const connections = {
          'Node1': {
            main: [[{ node: 'Node2', type: 'main', index: 0 }]],
          },
        };

        const result = validateWorkflowConnections(connections);
        expect(result).toEqual(connections);
      });

      it('should throw for invalid connections', () => {
        const invalidConnections = {
          'Node1': {
            main: 'invalid', // Should be array
          },
        };

        expect(() => validateWorkflowConnections(invalidConnections)).toThrow();
      });
    });

    describe('validateWorkflowSettings', () => {
      it('should validate and return valid settings', () => {
        const settings = {
          executionOrder: 'v1' as const,
          timezone: 'UTC',
        };

        const result = validateWorkflowSettings(settings);
        expect(result).toMatchObject(settings);
      });

      it('should apply defaults and validate', () => {
        const result = validateWorkflowSettings({});
        expect(result).toMatchObject(defaultWorkflowSettings);
      });
    });
  });

  describe('Workflow Cleaning Functions', () => {
    describe('cleanWorkflowForCreate', () => {
      it('should remove read-only fields', () => {
        const workflow = {
          id: 'should-be-removed',
          name: 'Test Workflow',
          nodes: [],
          connections: {},
          createdAt: '2023-01-01',
          updatedAt: '2023-01-01',
          versionId: 'v123',
          meta: { test: 'data' },
          active: true,
          tags: ['tag1'],
        };

        const cleaned = cleanWorkflowForCreate(workflow as any);
        
        expect(cleaned).not.toHaveProperty('id');
        expect(cleaned).not.toHaveProperty('createdAt');
        expect(cleaned).not.toHaveProperty('updatedAt');
        expect(cleaned).not.toHaveProperty('versionId');
        expect(cleaned).not.toHaveProperty('meta');
        expect(cleaned).not.toHaveProperty('active');
        expect(cleaned).not.toHaveProperty('tags');
        expect(cleaned.name).toBe('Test Workflow');
      });

      it('should add default settings if not present', () => {
        const workflow = {
          name: 'Test Workflow',
          nodes: [],
          connections: {},
        };

        const cleaned = cleanWorkflowForCreate(workflow as Workflow);
        expect(cleaned.settings).toEqual(defaultWorkflowSettings);
      });

      it('should preserve existing settings', () => {
        const customSettings = {
          executionOrder: 'v0' as const,
          timezone: 'America/New_York',
        };

        const workflow = {
          name: 'Test Workflow',
          nodes: [],
          connections: {},
          settings: customSettings,
        };

        const cleaned = cleanWorkflowForCreate(workflow as Workflow);
        expect(cleaned.settings).toEqual(customSettings);
      });
    });

    describe('cleanWorkflowForUpdate', () => {
      it('should remove all read-only and computed fields', () => {
        const workflow = {
          id: 'keep-id',
          name: 'Updated Workflow',
          nodes: [],
          connections: {},
          createdAt: '2023-01-01',
          updatedAt: '2023-01-01',
          versionId: 'v123',
          meta: { test: 'data' },
          staticData: { some: 'data' },
          pinData: { pin: 'data' },
          tags: ['tag1'],
          isArchived: false,
          usedCredentials: ['cred1'],
          sharedWithProjects: ['proj1'],
          triggerCount: 5,
          shared: true,
          active: true,
          settings: { executionOrder: 'v1' },
        } as any;

        const cleaned = cleanWorkflowForUpdate(workflow);
        
        // Should remove all these fields
        expect(cleaned).not.toHaveProperty('id');
        expect(cleaned).not.toHaveProperty('createdAt');
        expect(cleaned).not.toHaveProperty('updatedAt');
        expect(cleaned).not.toHaveProperty('versionId');
        expect(cleaned).not.toHaveProperty('meta');
        expect(cleaned).not.toHaveProperty('staticData');
        expect(cleaned).not.toHaveProperty('pinData');
        expect(cleaned).not.toHaveProperty('tags');
        expect(cleaned).not.toHaveProperty('isArchived');
        expect(cleaned).not.toHaveProperty('usedCredentials');
        expect(cleaned).not.toHaveProperty('sharedWithProjects');
        expect(cleaned).not.toHaveProperty('triggerCount');
        expect(cleaned).not.toHaveProperty('shared');
        expect(cleaned).not.toHaveProperty('active');
        
        // Should keep name but replace settings with empty object (n8n API limitation)
        expect(cleaned.name).toBe('Updated Workflow');
        expect(cleaned.settings).toEqual({});
      });

      it('should add empty settings object for cloud API compatibility', () => {
        const workflow = {
          name: 'Test Workflow',
          nodes: [],
          connections: {},
        } as any;

        const cleaned = cleanWorkflowForUpdate(workflow);
        expect(cleaned.settings).toEqual({});
      });

      it('should replace settings with empty object to prevent API errors (Issue #248 - final fix)', () => {
        const workflow = {
          name: 'Test Workflow',
          nodes: [],
          connections: {},
          settings: {
            executionOrder: 'v1' as const,
            saveDataSuccessExecution: 'none' as const,
            callerPolicy: 'workflowsFromSameOwner' as const,
            timeSavedPerExecution: 5, // UI-only property
          },
        } as any;

        const cleaned = cleanWorkflowForUpdate(workflow);

        // Settings replaced with empty object (satisfies both API versions)
        expect(cleaned.settings).toEqual({});
      });

      it('should replace settings with callerPolicy (Issue #248 - API limitation)', () => {
        const workflow = {
          name: 'Test Workflow',
          nodes: [],
          connections: {},
          settings: {
            executionOrder: 'v1' as const,
            callerPolicy: 'workflowsFromSameOwner' as const,
            errorWorkflow: 'N2O2nZy3aUiBRGFN',
          },
        } as any;

        const cleaned = cleanWorkflowForUpdate(workflow);

        // Settings replaced with empty object (n8n API rejects updates with settings properties)
        expect(cleaned.settings).toEqual({});
      });

      it('should replace all settings regardless of content (Issue #248 - API design)', () => {
        const workflow = {
          name: 'Test Workflow',
          nodes: [],
          connections: {},
          settings: {
            executionOrder: 'v0' as const,
            timezone: 'UTC',
            saveDataErrorExecution: 'all' as const,
            saveDataSuccessExecution: 'none' as const,
            saveManualExecutions: false,
            saveExecutionProgress: false,
            executionTimeout: 300,
            errorWorkflow: 'error-workflow-id',
            callerPolicy: 'workflowsFromAList' as const,
          },
        } as any;

        const cleaned = cleanWorkflowForUpdate(workflow);

        // Settings replaced with empty object due to n8n API limitation (cannot update settings via API)
        // See: https://community.n8n.io/t/api-workflow-update-endpoint-doesnt-support-setting-callerpolicy/161916
        expect(cleaned.settings).toEqual({});
      });

      it('should handle workflows without settings gracefully', () => {
        const workflow = {
          name: 'Test Workflow',
          nodes: [],
          connections: {},
        } as any;

        const cleaned = cleanWorkflowForUpdate(workflow);
        expect(cleaned.settings).toEqual({});
      });
    });
  });

  describe('validateWorkflowStructure', () => {
    it('should return no errors for valid workflow', () => {
      const workflow = new WorkflowBuilder('Valid Workflow')
        .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
        .addSlackNode({ id: 'slack-1', name: 'Send Slack' })
        .connect('Webhook', 'Send Slack')
        .build();

      const errors = validateWorkflowStructure(workflow as any);
      expect(errors).toEqual([]);
    });

    it('should detect missing workflow name', () => {
      const workflow = {
        nodes: [],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow as any);
      expect(errors).toContain('Workflow name is required');
    });

    it('should detect missing nodes', () => {
      const workflow = {
        name: 'Test',
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow as any);
      expect(errors).toContain('Workflow must have at least one node');
    });

    it('should detect empty nodes array', () => {
      const workflow = {
        name: 'Test',
        nodes: [],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow as any);
      expect(errors).toContain('Workflow must have at least one node');
    });

    it('should detect missing connections', () => {
      const workflow = {
        name: 'Test',
        nodes: [{ id: 'node-1', name: 'Node 1', type: 'n8n-nodes-base.set', typeVersion: 1, position: [0, 0] as [number, number], parameters: {} }],
      };

      const errors = validateWorkflowStructure(workflow as any);
      expect(errors).toContain('Workflow connections are required');
    });

    it('should allow single webhook node workflow', () => {
      const workflow = {
        name: 'Webhook Only',
        nodes: [{
          id: 'webhook-1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: {},
        }],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow as any);
      expect(errors).toEqual([]);
    });

    it('should reject single non-webhook node workflow', () => {
      const workflow = {
        name: 'Invalid Single Node',
        nodes: [{
          id: 'set-1',
          name: 'Set',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          position: [250, 300] as [number, number],
          parameters: {},
        }],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Single-node workflows are only valid for webhooks. Add at least one more node and connect them. Example: Manual Trigger → Set node');
    });

    it('should detect empty connections in multi-node workflow', () => {
      const workflow = {
        name: 'Disconnected Nodes',
        nodes: [
          {
            id: 'node-1',
            name: 'Node 1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [250, 300] as [number, number],
            parameters: {},
          },
          {
            id: 'node-2',
            name: 'Node 2',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [550, 300] as [number, number],
            parameters: {},
          },
        ],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Multi-node workflow has empty connections. Connect nodes like this: connections: { "Node1 Name": { "main": [[{ "node": "Node2 Name", "type": "main", "index": 0 }]] } }');
    });

    it('should validate node type format - missing package prefix', () => {
      const workflow = {
        name: 'Invalid Node Type',
        nodes: [{
          id: 'node-1',
          name: 'Node 1',
          type: 'webhook', // Missing package prefix
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: {},
        }],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Invalid node type "webhook" at index 0. Node types must include package prefix (e.g., "n8n-nodes-base.webhook").');
    });

    it('should validate node type format - wrong prefix format', () => {
      const workflow = {
        name: 'Invalid Node Type',
        nodes: [{
          id: 'node-1',
          name: 'Node 1',
          type: 'nodes-base.webhook', // Wrong prefix
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: {},
        }],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Invalid node type "nodes-base.webhook" at index 0. Use "n8n-nodes-base.webhook" instead.');
    });

    it('should detect invalid node structure', () => {
      const workflow = {
        name: 'Invalid Node',
        nodes: [{
          name: 'Missing Required Fields',
          // Missing id, type, typeVersion, position, parameters
        } as any],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow);
      // The validation will fail because the node is missing required fields
      expect(errors.some(e => e.includes('Invalid node at index 0'))).toBe(true);
    });

    it('should detect non-existent connection source by name', () => {
      const workflow = {
        name: 'Bad Connection',
        nodes: [{
          id: 'node-1',
          name: 'Node 1',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          position: [250, 300] as [number, number],
          parameters: {},
        }],
        connections: {
          'Non-existent Node': {
            main: [[{ node: 'Node 1', type: 'main', index: 0 }]],
          },
        },
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Connection references non-existent node: Non-existent Node');
    });

    it('should detect non-existent connection target by name', () => {
      const workflow = {
        name: 'Bad Connection Target',
        nodes: [{
          id: 'node-1',
          name: 'Node 1',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          position: [250, 300] as [number, number],
          parameters: {},
        }],
        connections: {
          'Node 1': {
            main: [[{ node: 'Non-existent Node', type: 'main', index: 0 }]],
          },
        },
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Connection references non-existent target node: Non-existent Node (from Node 1[0][0])');
    });

    it('should detect when node ID is used instead of name in connection source', () => {
      const workflow = {
        name: 'ID Instead of Name',
        nodes: [
          {
            id: 'node-1',
            name: 'First Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [250, 300] as [number, number],
            parameters: {},
          },
          {
            id: 'node-2',
            name: 'Second Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [550, 300] as [number, number],
            parameters: {},
          },
        ],
        connections: {
          'node-1': { // Using ID instead of name
            main: [[{ node: 'Second Node', type: 'main', index: 0 }]],
          },
        },
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain("Connection uses node ID 'node-1' but must use node name 'First Node'. Change connections.node-1 to connections['First Node']");
    });

    it('should detect when node ID is used instead of name in connection target', () => {
      const workflow = {
        name: 'ID Instead of Name in Target',
        nodes: [
          {
            id: 'node-1',
            name: 'First Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [250, 300] as [number, number],
            parameters: {},
          },
          {
            id: 'node-2',
            name: 'Second Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [550, 300] as [number, number],
            parameters: {},
          },
        ],
        connections: {
          'First Node': {
            main: [[{ node: 'node-2', type: 'main', index: 0 }]], // Using ID instead of name
          },
        },
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain("Connection target uses node ID 'node-2' but must use node name 'Second Node' (from First Node[0][0])");
    });

    it('should handle complex multi-output connections', () => {
      const workflow = {
        name: 'Complex Connections',
        nodes: [
          {
            id: 'if-1',
            name: 'IF Node',
            type: 'n8n-nodes-base.if',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {},
          },
          {
            id: 'true-1',
            name: 'True Branch',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [450, 200] as [number, number],
            parameters: {},
          },
          {
            id: 'false-1',
            name: 'False Branch',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [450, 400] as [number, number],
            parameters: {},
          },
        ],
        connections: {
          'IF Node': {
            main: [
              [{ node: 'True Branch', type: 'main', index: 0 }],
              [{ node: 'False Branch', type: 'main', index: 0 }],
            ],
          },
        },
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toEqual([]);
    });

    it('should validate invalid connections structure', () => {
      const workflow = {
        name: 'Invalid Connections',
        nodes: [
          {
            id: 'node-1',
            name: 'Node 1',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [250, 300] as [number, number],
            parameters: {},
          },
          {
            id: 'node-2',
            name: 'Node 2',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [550, 300] as [number, number],
            parameters: {},
          }
        ],
        connections: {
          'Node 1': 'invalid', // Should be an object
        } as any,
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors.some(e => e.includes('Invalid connections'))).toBe(true);
    });
  });

  describe('hasWebhookTrigger', () => {
    it('should return true for workflow with webhook node', () => {
      const workflow = new WorkflowBuilder()
        .addWebhookNode()
        .build() as Workflow;

      expect(hasWebhookTrigger(workflow)).toBe(true);
    });

    it('should return true for workflow with webhookTrigger node', () => {
      const workflow = {
        name: 'Test',
        nodes: [{
          id: 'webhook-1',
          name: 'Webhook Trigger',
          type: 'n8n-nodes-base.webhookTrigger',
          typeVersion: 1,
          position: [250, 300] as [number, number],
          parameters: {},
        }],
        connections: {},
      } as Workflow;

      expect(hasWebhookTrigger(workflow)).toBe(true);
    });

    it('should return false for workflow without webhook nodes', () => {
      const workflow = new WorkflowBuilder()
        .addSlackNode()
        .addHttpRequestNode()
        .build() as Workflow;

      expect(hasWebhookTrigger(workflow)).toBe(false);
    });

    it('should return true even if webhook is not the first node', () => {
      const workflow = new WorkflowBuilder()
        .addSlackNode()
        .addWebhookNode()
        .addHttpRequestNode()
        .build() as Workflow;

      expect(hasWebhookTrigger(workflow)).toBe(true);
    });
  });

  describe('getWebhookUrl', () => {
    it('should return webhook path from webhook node', () => {
      const workflow = {
        name: 'Test',
        nodes: [{
          id: 'webhook-1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: {
            path: 'my-custom-webhook',
          },
        }],
        connections: {},
      } as Workflow;

      expect(getWebhookUrl(workflow)).toBe('my-custom-webhook');
    });

    it('should return webhook path from webhookTrigger node', () => {
      const workflow = {
        name: 'Test',
        nodes: [{
          id: 'webhook-1',
          name: 'Webhook Trigger',
          type: 'n8n-nodes-base.webhookTrigger',
          typeVersion: 1,
          position: [250, 300] as [number, number],
          parameters: {
            path: 'trigger-webhook-path',
          },
        }],
        connections: {},
      } as Workflow;

      expect(getWebhookUrl(workflow)).toBe('trigger-webhook-path');
    });

    it('should return null if no webhook node exists', () => {
      const workflow = new WorkflowBuilder()
        .addSlackNode()
        .build() as Workflow;

      expect(getWebhookUrl(workflow)).toBe(null);
    });

    it('should return null if webhook node has no parameters', () => {
      const workflow = {
        name: 'Test',
        nodes: [{
          id: 'webhook-1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: undefined as any,
        }],
        connections: {},
      } as Workflow;

      expect(getWebhookUrl(workflow)).toBe(null);
    });

    it('should return null if webhook node has no path parameter', () => {
      const workflow = {
        name: 'Test',
        nodes: [{
          id: 'webhook-1',
          name: 'Webhook',
          type: 'n8n-nodes-base.webhook',
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: {
            method: 'POST',
            // No path parameter
          },
        }],
        connections: {},
      } as Workflow;

      expect(getWebhookUrl(workflow)).toBe(null);
    });

    it('should return first webhook path when multiple webhooks exist', () => {
      const workflow = {
        name: 'Test',
        nodes: [
          {
            id: 'webhook-1',
            name: 'Webhook 1',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [250, 300] as [number, number],
            parameters: {
              path: 'first-webhook',
            },
          },
          {
            id: 'webhook-2',
            name: 'Webhook 2',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 2,
            position: [550, 300] as [number, number],
            parameters: {
              path: 'second-webhook',
            },
          },
        ],
        connections: {},
      } as Workflow;

      expect(getWebhookUrl(workflow)).toBe('first-webhook');
    });
  });

  describe('getWorkflowStructureExample', () => {
    it('should return a string containing example workflow structure', () => {
      const example = getWorkflowStructureExample();
      
      expect(example).toContain('Minimal Workflow Example');
      expect(example).toContain('Manual Trigger');
      expect(example).toContain('Set Data');
      expect(example).toContain('connections');
      expect(example).toContain('IMPORTANT: In connections, use the node NAME');
    });

    it('should contain valid JSON structure in example', () => {
      const example = getWorkflowStructureExample();
      // Extract the JSON part between the first { and last }
      const match = example.match(/\{[\s\S]*\}/);
      expect(match).toBeTruthy();
      
      if (match) {
        // Should not throw when parsing
        expect(() => JSON.parse(match[0])).not.toThrow();
      }
    });
  });

  describe('getWorkflowFixSuggestions', () => {
    it('should suggest fixes for empty connections', () => {
      const errors = ['Multi-node workflow has empty connections'];
      const suggestions = getWorkflowFixSuggestions(errors);
      
      expect(suggestions).toContain('Add connections between your nodes. Each node (except endpoints) should connect to another node.');
      expect(suggestions).toContain('Connection format: connections: { "Source Node Name": { "main": [[{ "node": "Target Node Name", "type": "main", "index": 0 }]] } }');
    });

    it('should suggest fixes for single-node workflows', () => {
      const errors = ['Single-node workflows are only valid for webhooks'];
      const suggestions = getWorkflowFixSuggestions(errors);
      
      expect(suggestions).toContain('Add at least one more node to process data. Common patterns: Trigger → Process → Output');
      expect(suggestions).toContain('Examples: Manual Trigger → Set, Webhook → HTTP Request, Schedule Trigger → Database Query');
    });

    it('should suggest fixes for node ID usage instead of names', () => {
      const errors = ["Connection uses node ID 'set-1' but must use node name 'Set Data' instead of node name"];
      const suggestions = getWorkflowFixSuggestions(errors);
      
      expect(suggestions.some(s => s.includes('Replace node IDs with node names'))).toBe(true);
      expect(suggestions.some(s => s.includes('connections: { "set-1": {...} }'))).toBe(true);
    });

    it('should return empty array for no errors', () => {
      const suggestions = getWorkflowFixSuggestions([]);
      expect(suggestions).toEqual([]);
    });

    it('should handle multiple error types', () => {
      const errors = [
        'Multi-node workflow has empty connections',
        'Single-node workflows are only valid for webhooks',
        "Connection uses node ID instead of node name",
      ];
      const suggestions = getWorkflowFixSuggestions(errors);
      
      expect(suggestions.length).toBeGreaterThan(3);
      expect(suggestions).toContain('Add connections between your nodes. Each node (except endpoints) should connect to another node.');
      expect(suggestions).toContain('Add at least one more node to process data. Common patterns: Trigger → Process → Output');
      expect(suggestions).toContain('Replace node IDs with node names in connections. The name is what appears in the node header.');
    });

    it('should not duplicate suggestions for similar errors', () => {
      const errors = [
        "Connection uses node ID 'id1' instead of node name",
        "Connection uses node ID 'id2' instead of node name",
      ];
      const suggestions = getWorkflowFixSuggestions(errors);
      
      // Should only have 2 suggestions for this error type
      const idSuggestions = suggestions.filter(s => s.includes('Replace node IDs'));
      expect(idSuggestions.length).toBe(1);
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle workflow with null values gracefully', () => {
      const workflow = {
        name: 'Test',
        nodes: null as any,
        connections: null as any,
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Workflow must have at least one node');
      expect(errors).toContain('Workflow connections are required');
    });

    it('should handle undefined parameters in cleaning functions', () => {
      const workflow = {
        name: undefined as any,
        nodes: undefined as any,
        connections: undefined as any,
      };

      expect(() => cleanWorkflowForCreate(workflow)).not.toThrow();
      expect(() => cleanWorkflowForUpdate(workflow as any)).not.toThrow();
    });

    it('should handle circular references in workflow structure', () => {
      const node1: any = {
        id: 'node-1',
        name: 'Node 1',
        type: 'n8n-nodes-base.set',
        typeVersion: 3,
        position: [250, 300],
        parameters: {},
      };
      
      // Create circular reference
      node1.parameters.circular = node1;

      const workflow = {
        name: 'Circular Ref',
        nodes: [node1],
        connections: {},
      };

      // Should handle circular references without crashing
      expect(() => validateWorkflowStructure(workflow)).not.toThrow();
    });

    it('should validate very large position values', () => {
      const node = {
        id: 'node-1',
        name: 'Test Node',
        type: 'n8n-nodes-base.set',
        typeVersion: 3,
        position: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] as [number, number],
        parameters: {},
      };

      expect(() => validateWorkflowNode(node)).not.toThrow();
    });

    it('should handle special characters in node names', () => {
      const workflow = {
        name: 'Special Chars',
        nodes: [
          {
            id: 'node-1',
            name: 'Node with "quotes" & special <chars>',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [250, 300] as [number, number],
            parameters: {},
          },
          {
            id: 'node-2',
            name: 'Normal Node',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            position: [550, 300] as [number, number],
            parameters: {},
          },
        ],
        connections: {
          'Node with "quotes" & special <chars>': {
            main: [[{ node: 'Normal Node', type: 'main', index: 0 }]],
          },
        },
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toEqual([]);
    });

    it('should handle empty string values', () => {
      const workflow = {
        name: '',
        nodes: [{
          id: '',
          name: '',
          type: '',
          typeVersion: 1,
          position: [0, 0] as [number, number],
          parameters: {},
        }],
        connections: {},
      };

      const errors = validateWorkflowStructure(workflow);
      expect(errors).toContain('Workflow name is required');
      // Empty string for type will be caught as invalid
      expect(errors.some(e => e.includes('Invalid node at index 0') || e.includes('Node types must include package prefix'))).toBe(true);
    });

    it('should handle negative position values', () => {
      const node = {
        id: 'node-1',
        name: 'Test Node',
        type: 'n8n-nodes-base.set',
        typeVersion: 3,
        position: [-100, -200] as [number, number],
        parameters: {},
      };

      // Negative positions are valid
      expect(() => validateWorkflowNode(node)).not.toThrow();
    });

    it('should validate settings with additional unknown properties', () => {
      const settings = {
        executionOrder: 'v1' as const,
        timezone: 'UTC',
        unknownProperty: 'should be allowed',
        anotherUnknown: { nested: 'object' },
      };

      // Zod by default strips unknown properties
      const result = validateWorkflowSettings(settings);
      expect(result).toHaveProperty('executionOrder', 'v1');
      expect(result).toHaveProperty('timezone', 'UTC');
      expect(result).not.toHaveProperty('unknownProperty');
      expect(result).not.toHaveProperty('anotherUnknown');
    });
  });

  describe('Integration Tests', () => {
    it('should validate a complete real-world workflow', () => {
      const workflow = new WorkflowBuilder('Production Workflow')
        .addWebhookNode({ 
          id: 'webhook-1', 
          name: 'Order Webhook',
          parameters: {
            path: 'new-order',
            method: 'POST',
          },
        })
        .addIfNode({
          id: 'if-1',
          name: 'Check Order Value',
          parameters: {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{
                id: '1',
                leftValue: '={{ $json.orderValue }}',
                rightValue: '100',
                operator: { type: 'number', operation: 'gte' },
              }],
              combinator: 'and',
            },
          },
        })
        .addSlackNode({
          id: 'slack-1',
          name: 'Notify High Value',
          parameters: {
            channel: '#high-value-orders',
            text: 'High value order received: ${{ $json.orderId }}',
          },
        })
        .addHttpRequestNode({
          id: 'http-1',
          name: 'Update Inventory',
          parameters: {
            method: 'POST',
            url: 'https://api.inventory.com/update',
            sendBody: true,
            bodyParametersJson: '={{ $json }}',
          },
        })
        .connect('Order Webhook', 'Check Order Value')
        .connect('Check Order Value', 'Notify High Value', 0) // True output
        .connect('Check Order Value', 'Update Inventory', 1) // False output
        .setSettings({
          executionOrder: 'v1',
          timezone: 'America/New_York',
          saveDataErrorExecution: 'all',
          saveDataSuccessExecution: 'none',
          executionTimeout: 300,
        })
        .build();

      const errors = validateWorkflowStructure(workflow as any);
      expect(errors).toEqual([]);

      // Validate individual components
      workflow.nodes.forEach(node => {
        expect(() => validateWorkflowNode(node)).not.toThrow();
      });
      expect(() => validateWorkflowConnections(workflow.connections)).not.toThrow();
      expect(() => validateWorkflowSettings(workflow.settings!)).not.toThrow();
    });

    it('should clean and validate workflow for API operations', () => {
      const originalWorkflow = {
        id: 'wf-123',
        name: 'API Test Workflow',
        nodes: [
          {
            id: 'manual-1',
            name: 'Manual Trigger',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [250, 300] as [number, number],
            parameters: {},
          },
          {
            id: 'set-1',
            name: 'Set Data',
            type: 'n8n-nodes-base.set',
            typeVersion: 3.4,
            position: [450, 300] as [number, number],
            parameters: {
              mode: 'manual',
              assignments: {
                assignments: [{
                  id: '1',
                  name: 'testKey',
                  value: 'testValue',
                  type: 'string',
                }],
              },
            },
          }
        ],
        connections: {
          'Manual Trigger': {
            main: [[{
              node: 'Set Data',
              type: 'main',
              index: 0,
            }]],
          },
        },
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z',
        versionId: 'v123',
        active: true,
        tags: ['test', 'api'],
        meta: { instanceId: 'instance-123' },
      };

      // Test create cleaning
      const forCreate = cleanWorkflowForCreate(originalWorkflow);
      expect(forCreate).not.toHaveProperty('id');
      expect(forCreate).not.toHaveProperty('createdAt');
      expect(forCreate).not.toHaveProperty('updatedAt');
      expect(forCreate).not.toHaveProperty('versionId');
      expect(forCreate).not.toHaveProperty('active');
      expect(forCreate).not.toHaveProperty('tags');
      expect(forCreate).not.toHaveProperty('meta');
      expect(forCreate).toHaveProperty('settings');
      expect(validateWorkflowStructure(forCreate)).toEqual([]);

      // Test update cleaning
      const forUpdate = cleanWorkflowForUpdate(originalWorkflow as any);
      expect(forUpdate).not.toHaveProperty('id');
      expect(forUpdate).not.toHaveProperty('createdAt');
      expect(forUpdate).not.toHaveProperty('updatedAt');
      expect(forUpdate).not.toHaveProperty('versionId');
      expect(forUpdate).not.toHaveProperty('active');
      expect(forUpdate).not.toHaveProperty('tags');
      expect(forUpdate).not.toHaveProperty('meta');
      expect(forUpdate.settings).toEqual({}); // Settings replaced with empty object for API compatibility
      expect(validateWorkflowStructure(forUpdate)).toEqual([]);
    });
  });
});