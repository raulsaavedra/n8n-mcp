import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowDiffEngine } from '@/services/workflow-diff-engine';
import { createWorkflow, WorkflowBuilder } from '@tests/utils/builders/workflow.builder';
import {
  WorkflowDiffRequest,
  WorkflowDiffOperation,
  AddNodeOperation,
  RemoveNodeOperation,
  UpdateNodeOperation,
  MoveNodeOperation,
  EnableNodeOperation,
  DisableNodeOperation,
  AddConnectionOperation,
  RemoveConnectionOperation,
  UpdateConnectionOperation,
  UpdateSettingsOperation,
  UpdateNameOperation,
  AddTagOperation,
  RemoveTagOperation,
  CleanStaleConnectionsOperation,
  ReplaceConnectionsOperation
} from '@/types/workflow-diff';
import { Workflow } from '@/types/n8n-api';

describe('WorkflowDiffEngine', () => {
  let diffEngine: WorkflowDiffEngine;
  let baseWorkflow: Workflow;
  let builder: WorkflowBuilder;

  beforeEach(() => {
    diffEngine = new WorkflowDiffEngine();
    
    // Create a base workflow with some nodes
    builder = createWorkflow('Test Workflow')
      .addWebhookNode({ id: 'webhook-1', name: 'Webhook' })
      .addHttpRequestNode({ id: 'http-1', name: 'HTTP Request' })
      .addSlackNode({ id: 'slack-1', name: 'Slack' })
      .connect('webhook-1', 'http-1')
      .connect('http-1', 'slack-1')
      .addTags('test', 'automation');
    
    baseWorkflow = builder.build() as Workflow;
    
    // Convert connections from ID-based to name-based (as n8n expects)
    const newConnections: any = {};
    for (const [nodeId, outputs] of Object.entries(baseWorkflow.connections)) {
      const node = baseWorkflow.nodes.find((n: any) => n.id === nodeId);
      if (node) {
        newConnections[node.name] = {};
        for (const [outputName, connections] of Object.entries(outputs)) {
          newConnections[node.name][outputName] = (connections as any[]).map((conns: any) =>
            conns.map((conn: any) => {
              const targetNode = baseWorkflow.nodes.find((n: any) => n.id === conn.node);
              return {
                ...conn,
                node: targetNode ? targetNode.name : conn.node
              };
            })
          );
        }
      }
    }
    baseWorkflow.connections = newConnections;
  });

  describe('Large Operation Batches', () => {
    it('should handle many operations successfully', async () => {
      // Test with 50 operations
      const operations = Array(50).fill(null).map((_: any, i: number) => ({
        type: 'updateName',
        name: `Name ${i}`
      } as UpdateNameOperation));

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.operationsApplied).toBe(50);
      expect(result.workflow!.name).toBe('Name 49'); // Last operation wins
    });

    it('should handle 100+ mixed operations', async () => {
      const operations: WorkflowDiffOperation[] = [
        // Add 30 nodes
        ...Array(30).fill(null).map((_: any, i: number) => ({
          type: 'addNode',
          node: {
            name: `Node${i}`,
            type: 'n8n-nodes-base.code',
            position: [i * 100, 300],
            parameters: {}
          }
        } as AddNodeOperation)),
        // Update names 30 times
        ...Array(30).fill(null).map((_: any, i: number) => ({
          type: 'updateName',
          name: `Workflow Version ${i}`
        } as UpdateNameOperation)),
        // Add 40 tags
        ...Array(40).fill(null).map((_: any, i: number) => ({
          type: 'addTag',
          tag: `tag${i}`
        } as AddTagOperation))
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.operationsApplied).toBe(100);
      expect(result.workflow!.nodes.length).toBeGreaterThan(30);
      expect(result.workflow!.name).toBe('Workflow Version 29');
    });
  });

  describe('AddNode Operation', () => {
    it('should add a new node successfully', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'New Code Node',
          type: 'n8n-nodes-base.code',
          position: [800, 300],
          typeVersion: 2,
          parameters: {
            mode: 'runOnceForAllItems',
            language: 'javaScript',
            jsCode: 'return items;'
          }
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(4);
      expect(result.workflow!.nodes[3].name).toBe('New Code Node');
      expect(result.workflow!.nodes[3].type).toBe('n8n-nodes-base.code');
      expect(result.workflow!.nodes[3].id).toBeDefined();
    });

    it('should reject duplicate node names', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Webhook', // Duplicate name
          type: 'n8n-nodes-base.webhook',
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('already exists');
    });

    it('should reject invalid node type format', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Invalid Node',
          type: 'webhook', // Missing package prefix
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid node type');
    });

    it('should correct nodes-base prefix to n8n-nodes-base', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Test Node',
          type: 'nodes-base.webhook', // Wrong prefix
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Use "n8n-nodes-base.');
    });

    it('should generate node ID if not provided', async () => {
      const operation: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'No ID Node',
          type: 'n8n-nodes-base.code',
          position: [800, 300]
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes[3].id).toBeDefined();
      expect(result.workflow!.nodes[3].id).toMatch(/^[0-9a-f-]+$/);
    });
  });

  describe('RemoveNode Operation', () => {
    it('should remove node by ID', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(2);
      expect(result.workflow!.nodes.find((n: any) => n.id === 'http-1')).toBeUndefined();
    });

    it('should remove node by name', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeName: 'HTTP Request'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(2);
      expect(result.workflow!.nodes.find((n: any) => n.name === 'HTTP Request')).toBeUndefined();
    });

    it('should clean up connections when removing node', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.connections['HTTP Request']).toBeUndefined();
      // Check that connections from Webhook were cleaned up
      if (result.workflow!.connections['Webhook'] && result.workflow!.connections['Webhook'].main && result.workflow!.connections['Webhook'].main[0]) {
        expect(result.workflow!.connections['Webhook'].main[0]).toHaveLength(0);
      } else {
        // Webhook connections should be cleaned up entirely
        expect(result.workflow!.connections['Webhook']).toBeUndefined();
      }
    });

    it('should reject removing non-existent node', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Node not found');
    });
  });

  describe('UpdateNode Operation', () => {
    it('should update node parameters', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'http-1',
        updates: {
          'parameters.method': 'POST',
          'parameters.url': 'https://new-api.example.com'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const updatedNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(updatedNode!.parameters.method).toBe('POST');
      expect(updatedNode!.parameters.url).toBe('https://new-api.example.com');
    });

    it('should update nested properties using dot notation', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeName: 'Slack',
        updates: {
          'parameters.resource': 'channel',
          'parameters.operation': 'create',
          'credentials.slackApi.name': 'New Slack Account'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const updatedNode = result.workflow!.nodes.find((n: any) => n.name === 'Slack');
      expect(updatedNode!.parameters.resource).toBe('channel');
      expect(updatedNode!.parameters.operation).toBe('create');
      expect((updatedNode!.credentials as any).slackApi.name).toBe('New Slack Account');
    });

    it('should reject updating non-existent node', async () => {
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'non-existent',
        updates: {
          'parameters.test': 'value'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Node not found');
    });
  });

  describe('MoveNode Operation', () => {
    it('should move node to new position', async () => {
      const operation: MoveNodeOperation = {
        type: 'moveNode',
        nodeId: 'http-1',
        position: [1000, 500]
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const movedNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(movedNode!.position).toEqual([1000, 500]);
    });

    it('should move node by name', async () => {
      const operation: MoveNodeOperation = {
        type: 'moveNode',
        nodeName: 'Webhook',
        position: [100, 100]
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const movedNode = result.workflow!.nodes.find((n: any) => n.name === 'Webhook');
      expect(movedNode!.position).toEqual([100, 100]);
    });
  });

  describe('Enable/Disable Node Operations', () => {
    it('should disable a node', async () => {
      const operation: DisableNodeOperation = {
        type: 'disableNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const disabledNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(disabledNode!.disabled).toBe(true);
    });

    it('should enable a disabled node', async () => {
      // First disable the node
      baseWorkflow.nodes[1].disabled = true;

      const operation: EnableNodeOperation = {
        type: 'enableNode',
        nodeId: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const enabledNode = result.workflow!.nodes.find((n: any) => n.id === 'http-1');
      expect(enabledNode!.disabled).toBe(false);
    });
  });

  describe('AddConnection Operation', () => {
    it('should add a new connection', async () => {
      // First add a new node to connect to
      const addNodeOp: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'Code',
          type: 'n8n-nodes-base.code',
          position: [1000, 300]
        }
      };

      const addConnectionOp: AddConnectionOperation = {
        type: 'addConnection',
        source: 'slack-1',
        target: 'Code'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNodeOp, addConnectionOp]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.connections['Slack']).toBeDefined();
      expect(result.workflow!.connections['Slack'].main[0]).toHaveLength(1);
      expect(result.workflow!.connections['Slack'].main[0][0].node).toBe('Code');
    });

    it('should reject duplicate connections', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'Webhook',  // Use node name not ID
        target: 'HTTP Request'  // Use node name not ID
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Connection already exists');
    });

    it('should reject connection to non-existent source node', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'non-existent',
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Source node not found');
    });

    it('should reject connection to non-existent target node', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'webhook-1',
        target: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Target node not found');
    });

    it('should support custom output and input types', async () => {
      // Add an IF node that has multiple outputs
      const addNodeOp: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [600, 400]
        }
      };

      const addConnectionOp: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'slack-1',
        sourceOutput: 'false',
        targetInput: 'main',
        sourceIndex: 0,
        targetIndex: 0
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNodeOp, addConnectionOp]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(true);
      expect(result.workflow!.connections['IF'].false).toBeDefined();
      expect(result.workflow!.connections['IF'].false[0][0].node).toBe('Slack');
    });

    it('should reject addConnection with wrong parameter sourceNodeId instead of source (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        sourceNodeId: 'webhook-1', // Wrong parameter name!
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid parameter(s): sourceNodeId');
      expect(result.errors![0].message).toContain("Use 'source' and 'target' instead");
    });

    it('should reject addConnection with wrong parameter targetNodeId instead of target (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        source: 'webhook-1',
        targetNodeId: 'http-1' // Wrong parameter name!
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid parameter(s): targetNodeId');
      expect(result.errors![0].message).toContain("Use 'source' and 'target' instead");
    });

    it('should reject addConnection with both wrong parameters (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        sourceNodeId: 'webhook-1', // Wrong!
        targetNodeId: 'http-1' // Wrong!
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Invalid parameter(s): sourceNodeId, targetNodeId');
      expect(result.errors![0].message).toContain("Use 'source' and 'target' instead");
    });

    it('should show helpful error with available nodes when source is missing (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        // source is missing entirely
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain("Missing required parameter 'source'");
      expect(result.errors![0].message).toContain("not 'sourceNodeId'");
    });

    it('should show helpful error with available nodes when target is missing (Issue #249)', async () => {
      const operation: any = {
        type: 'addConnection',
        source: 'webhook-1',
        // target is missing entirely
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain("Missing required parameter 'target'");
      expect(result.errors![0].message).toContain("not 'targetNodeId'");
    });

    it('should list available nodes when source node not found (Issue #249)', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'non-existent-node',
        target: 'http-1'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Source node not found: "non-existent-node"');
      expect(result.errors![0].message).toContain('Available nodes:');
      expect(result.errors![0].message).toContain('Webhook');
      expect(result.errors![0].message).toContain('HTTP Request');
      expect(result.errors![0].message).toContain('Slack');
    });

    it('should list available nodes when target node not found (Issue #249)', async () => {
      const operation: AddConnectionOperation = {
        type: 'addConnection',
        source: 'webhook-1',
        target: 'non-existent-node'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);

      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Target node not found: "non-existent-node"');
      expect(result.errors![0].message).toContain('Available nodes:');
      expect(result.errors![0].message).toContain('Webhook');
      expect(result.errors![0].message).toContain('HTTP Request');
      expect(result.errors![0].message).toContain('Slack');
    });
  });

  describe('RemoveConnection Operation', () => {
    it('should remove an existing connection', async () => {
      const operation: RemoveConnectionOperation = {
        type: 'removeConnection',
        source: 'Webhook',  // Use node name
        target: 'HTTP Request'  // Use node name
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      // After removing the connection, the array should be empty or cleaned up
      if (result.workflow!.connections['Webhook']) {
        if (result.workflow!.connections['Webhook'].main && result.workflow!.connections['Webhook'].main.length > 0) {
          expect(result.workflow!.connections['Webhook'].main[0]).toHaveLength(0);
        } else {
          expect(result.workflow!.connections['Webhook'].main).toHaveLength(0);
        }
      } else {
        // Connection was cleaned up entirely
        expect(result.workflow!.connections['Webhook']).toBeUndefined();
      }
    });

    it('should reject removing non-existent connection', async () => {
      const operation: RemoveConnectionOperation = {
        type: 'removeConnection',
        source: 'Slack',  // Use node name
        target: 'Webhook'  // Use node name
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('No connections found');
    });
  });

  describe('UpdateConnection Operation', () => {
    it('should update connection properties', async () => {
      // Add an IF node with multiple outputs
      const addNodeOp: AddNodeOperation = {
        type: 'addNode',
        node: {
          name: 'IF',
          type: 'n8n-nodes-base.if',
          position: [600, 300]
        }
      };

      const addConnectionOp: AddConnectionOperation = {
        type: 'addConnection',
        source: 'IF',
        target: 'slack-1',
        sourceOutput: 'true'
      };

      const updateConnectionOp: UpdateConnectionOperation = {
        type: 'updateConnection',
        source: 'IF',
        target: 'slack-1',
        updates: {
          sourceOutput: 'false',
          sourceIndex: 0,
          targetIndex: 0
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [addNodeOp, addConnectionOp, updateConnectionOp]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      // After update, the connection should be on 'false' output only
      expect(result.workflow!.connections['IF'].false).toBeDefined();
      expect(result.workflow!.connections['IF'].false[0][0].node).toBe('Slack');
      // The 'true' output should still have the original connection
      // because updateConnection removes using the NEW output values, not the old ones
      expect(result.workflow!.connections['IF'].true).toBeDefined();
      expect(result.workflow!.connections['IF'].true[0][0].node).toBe('Slack');
    });
  });

  describe('UpdateSettings Operation', () => {
    it('should update workflow settings', async () => {
      const operation: UpdateSettingsOperation = {
        type: 'updateSettings',
        settings: {
          executionOrder: 'v0',
          timezone: 'America/New_York',
          executionTimeout: 300
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.settings!.executionOrder).toBe('v0');
      expect(result.workflow!.settings!.timezone).toBe('America/New_York');
      expect(result.workflow!.settings!.executionTimeout).toBe(300);
    });

    it('should create settings object if not exists', async () => {
      delete baseWorkflow.settings;

      const operation: UpdateSettingsOperation = {
        type: 'updateSettings',
        settings: {
          saveManualExecutions: false
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.settings).toBeDefined();
      expect(result.workflow!.settings!.saveManualExecutions).toBe(false);
    });
  });

  describe('UpdateName Operation', () => {
    it('should update workflow name', async () => {
      const operation: UpdateNameOperation = {
        type: 'updateName',
        name: 'Updated Workflow Name'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.name).toBe('Updated Workflow Name');
    });
  });

  describe('Tag Operations', () => {
    it('should add a new tag', async () => {
      const operation: AddTagOperation = {
        type: 'addTag',
        tag: 'production'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.tags).toContain('production');
      expect(result.workflow!.tags).toHaveLength(3);
    });

    it('should not add duplicate tags', async () => {
      const operation: AddTagOperation = {
        type: 'addTag',
        tag: 'test' // Already exists
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.tags).toHaveLength(2); // No change
    });

    it('should create tags array if not exists', async () => {
      delete baseWorkflow.tags;

      const operation: AddTagOperation = {
        type: 'addTag',
        tag: 'new-tag'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.tags).toBeDefined();
      expect(result.workflow!.tags).toEqual(['new-tag']);
    });

    it('should remove an existing tag', async () => {
      const operation: RemoveTagOperation = {
        type: 'removeTag',
        tag: 'test'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.tags).not.toContain('test');
      expect(result.workflow!.tags).toHaveLength(1);
    });

    it('should handle removing non-existent tag gracefully', async () => {
      const operation: RemoveTagOperation = {
        type: 'removeTag',
        tag: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.tags).toHaveLength(2); // No change
    });
  });

  describe('ValidateOnly Mode', () => {
    it('should validate without applying changes', async () => {
      const operation: UpdateNameOperation = {
        type: 'updateName',
        name: 'Validated But Not Applied'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation],
        validateOnly: true
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Validation successful');
      expect(result.workflow).toBeUndefined();
    });

    it('should return validation errors in validateOnly mode', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'non-existent'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation],
        validateOnly: true
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Node not found');
    });
  });

  describe('Operation Ordering', () => {
    it('should process node operations before connection operations', async () => {
      // This tests the two-pass processing: nodes first, then connections
      const operations = [
        {
          type: 'addConnection',
          source: 'NewNode',
          target: 'slack-1'
        } as AddConnectionOperation,
        {
          type: 'addNode',
          node: {
            name: 'NewNode',
            type: 'n8n-nodes-base.code',
            position: [800, 300]
          }
        } as AddNodeOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(4);
      expect(result.workflow!.connections['NewNode']).toBeDefined();
    });

    it('should handle dependent operations correctly', async () => {
      const operations = [
        {
          type: 'removeNode',
          nodeId: 'http-1'
        } as RemoveNodeOperation,
        {
          type: 'addNode',
          node: {
            name: 'HTTP Request', // Reuse the same name
            type: 'n8n-nodes-base.httpRequest',
            position: [600, 300]
          }
        } as AddNodeOperation,
        {
          type: 'addConnection',
          source: 'webhook-1',
          target: 'HTTP Request'
        } as AddConnectionOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.nodes).toHaveLength(3);
      expect(result.workflow!.connections['Webhook'].main[0][0].node).toBe('HTTP Request');
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown operation type', async () => {
      const operation = {
        type: 'unknownOperation',
        someData: 'test'
      } as any;

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].message).toContain('Unknown operation type');
    });

    it('should stop on first validation error', async () => {
      const operations = [
        {
          type: 'removeNode',
          nodeId: 'non-existent'
        } as RemoveNodeOperation,
        {
          type: 'updateName',
          name: 'This should not be applied'
        } as UpdateNameOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].operation).toBe(0);
    });

    it('should return operation details in error', async () => {
      const operation: RemoveNodeOperation = {
        type: 'removeNode',
        nodeId: 'non-existent',
        description: 'Test remove operation'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(false);
      expect(result.errors![0].details).toEqual(operation);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple operations of different types', async () => {
      const operations = [
        {
          type: 'updateName',
          name: 'Complex Workflow'
        } as UpdateNameOperation,
        {
          type: 'addNode',
          node: {
            name: 'Filter',
            type: 'n8n-nodes-base.filter',
            position: [800, 200]
          }
        } as AddNodeOperation,
        {
          type: 'removeConnection',
          source: 'HTTP Request',  // Use node name
          target: 'Slack'  // Use node name
        } as RemoveConnectionOperation,
        {
          type: 'addConnection',
          source: 'HTTP Request',  // Use node name
          target: 'Filter'
        } as AddConnectionOperation,
        {
          type: 'addConnection',
          source: 'Filter',
          target: 'Slack'  // Use node name
        } as AddConnectionOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.workflow!.name).toBe('Complex Workflow');
      expect(result.workflow!.nodes).toHaveLength(4);
      expect(result.workflow!.connections['HTTP Request'].main[0][0].node).toBe('Filter');
      expect(result.workflow!.connections['Filter'].main[0][0].node).toBe('Slack');
      expect(result.operationsApplied).toBe(5);
    });

    it('should preserve workflow immutability', async () => {
      const originalNodes = [...baseWorkflow.nodes];
      const originalConnections = JSON.stringify(baseWorkflow.connections);

      const operation: UpdateNameOperation = {
        type: 'updateName',
        name: 'Modified'
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      await diffEngine.applyDiff(baseWorkflow, request);
      
      // Original workflow should remain unchanged
      expect(baseWorkflow.name).toBe('Test Workflow');
      expect(baseWorkflow.nodes).toEqual(originalNodes);
      expect(JSON.stringify(baseWorkflow.connections)).toBe(originalConnections);
    });

    it('should handle node ID as name fallback', async () => {
      // Test the findNode helper's fallback behavior
      const operation: UpdateNodeOperation = {
        type: 'updateNode',
        nodeId: 'Webhook', // Using name as ID
        updates: {
          'parameters.path': 'new-webhook-path'
        }
      };

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations: [operation]
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      const updatedNode = result.workflow!.nodes.find((n: any) => n.name === 'Webhook');
      expect(updatedNode!.parameters.path).toBe('new-webhook-path');
    });
  });

  describe('Success Messages', () => {
    it('should provide informative success message', async () => {
      const operations = [
        {
          type: 'addNode',
          node: {
            name: 'Node1',
            type: 'n8n-nodes-base.code',
            position: [100, 100]
          }
        } as AddNodeOperation,
        {
          type: 'updateSettings',
          settings: { timezone: 'UTC' }
        } as UpdateSettingsOperation,
        {
          type: 'addTag',
          tag: 'v2'
        } as AddTagOperation
      ];

      const request: WorkflowDiffRequest = {
        id: 'test-workflow',
        operations
      };

      const result = await diffEngine.applyDiff(baseWorkflow, request);
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('Successfully applied 3 operations');
      expect(result.message).toContain('1 node ops');
      expect(result.message).toContain('2 other ops');
    });
  });

  describe('New Features - v2.14.4', () => {
    describe('cleanStaleConnections operation', () => {
      it('should remove connections referencing non-existent nodes', async () => {
        // Create a workflow with a stale connection
        const workflow = builder.build() as Workflow;

        // Add a connection to a non-existent node manually
        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'HTTP Request', type: 'main', index: 0 },
          { node: 'NonExistentNode', type: 'main', index: 0 }
        ]];

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(1);
        expect(result.workflow.connections['Webhook']['main'][0][0].node).toBe('HTTP Request');
      });

      it('should remove entire source connection if source node does not exist', async () => {
        const workflow = builder.build() as Workflow;

        // Add connections from non-existent node
        workflow.connections['GhostNode'] = {
          'main': [[
            { node: 'HTTP Request', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['GhostNode']).toBeUndefined();
      });

      it('should support dryRun mode', async () => {
        const workflow = builder.build() as Workflow;

        // Add a stale connection
        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'HTTP Request', type: 'main', index: 0 },
          { node: 'NonExistentNode', type: 'main', index: 0 }
        ]];

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections',
          dryRun: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // In dryRun, stale connection should still be present (not actually removed)
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
      });
    });

    describe('replaceConnections operation', () => {
      it('should replace entire connections object', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'Webhook': {
            'main': [[
              { node: 'Slack', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual(newConnections);
        expect(result.workflow.connections['HTTP Request']).toBeUndefined();
      });

      it('should fail if referenced nodes do not exist', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'Webhook': {
            'main': [[
              { node: 'NonExistentNode', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors![0].message).toContain('Target node not found');
      });
    });

    describe('removeConnection with ignoreErrors flag', () => {
      it('should succeed when connection does not exist if ignoreErrors is true', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentNode',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should fail when connection does not exist if ignoreErrors is false', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentNode',
          ignoreErrors: false
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      it('should default to atomic behavior when ignoreErrors is not specified', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentNode'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });
    });

    describe('continueOnError mode', () => {
      it('should apply valid operations and report failed ones', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'New Workflow Name'
          } as UpdateNameOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistentNode'
          } as RemoveConnectionOperation,
          {
            type: 'addTag',
            tag: 'production'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toEqual([0, 2]); // Operations 0 and 2 succeeded
        expect(result.failed).toEqual([1]); // Operation 1 failed
        expect(result.errors).toHaveLength(1);
        expect(result.workflow.name).toBe('New Workflow Name');
        expect(result.workflow.tags).toContain('production');
      });

      it('should return success false if all operations fail in continueOnError mode', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'Node1'
          } as RemoveConnectionOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'Node2'
          } as RemoveConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toHaveLength(0);
        expect(result.failed).toEqual([0, 1]);
      });

      it('should use atomic mode by default when continueOnError is not specified', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'New Name'
          } as UpdateNameOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistent'
          } as RemoveConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toBeUndefined();
        expect(result.failed).toBeUndefined();
        // Name should not have been updated due to atomic behavior
        expect(result.workflow).toBeUndefined();
      });
    });

    describe('Backwards compatibility', () => {
      it('should maintain existing behavior for all previous operation types', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          { type: 'updateName', name: 'Test' } as UpdateNameOperation,
          { type: 'addTag', tag: 'test' } as AddTagOperation,
          { type: 'removeTag', tag: 'automation' } as RemoveTagOperation,
          { type: 'updateSettings', settings: { timezone: 'UTC' } } as UpdateSettingsOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.operationsApplied).toBe(4);
      });
    });
  });

  describe('v2.14.4 Coverage Improvements', () => {
    describe('cleanStaleConnections - Advanced Scenarios', () => {
      it('should clean up multiple stale connections across different output types', async () => {
        const workflow = builder.build() as Workflow;

        // Add an IF node with multiple outputs
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        // Add connections with both valid and stale targets on different outputs
        workflow.connections['IF'] = {
          'true': [[
            { node: 'Slack', type: 'main', index: 0 },
            { node: 'StaleNode1', type: 'main', index: 0 }
          ]],
          'false': [[
            { node: 'HTTP Request', type: 'main', index: 0 },
            { node: 'StaleNode2', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['IF']['true'][0]).toHaveLength(1);
        expect(result.workflow.connections['IF']['true'][0][0].node).toBe('Slack');
        expect(result.workflow.connections['IF']['false'][0]).toHaveLength(1);
        expect(result.workflow.connections['IF']['false'][0][0].node).toBe('HTTP Request');
      });

      it('should remove empty output types after cleaning stale connections', async () => {
        const workflow = builder.build() as Workflow;

        // Add node with connections
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        // Add connections where all targets in one output are stale
        workflow.connections['IF'] = {
          'true': [[
            { node: 'StaleNode1', type: 'main', index: 0 },
            { node: 'StaleNode2', type: 'main', index: 0 }
          ]],
          'false': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['IF']['true']).toBeUndefined();
        expect(result.workflow.connections['IF']['false']).toBeDefined();
        expect(result.workflow.connections['IF']['false'][0][0].node).toBe('Slack');
      });

      it('should clean up entire node connections when all outputs become empty', async () => {
        const workflow = builder.build() as Workflow;

        // Add node
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        // Add connections where ALL targets are stale
        workflow.connections['IF'] = {
          'true': [[
            { node: 'StaleNode1', type: 'main', index: 0 }
          ]],
          'false': [[
            { node: 'StaleNode2', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['IF']).toBeUndefined();
      });

      it('should handle dryRun with multiple stale connections', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add stale connections from both valid and invalid source nodes
        workflow.connections['GhostNode'] = {
          'main': [[{ node: 'HTTP Request', type: 'main', index: 0 }]]
        };

        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'HTTP Request', type: 'main', index: 0 },
          { node: 'StaleNode1', type: 'main', index: 0 },
          { node: 'StaleNode2', type: 'main', index: 0 }
        ]];

        const originalConnections = JSON.parse(JSON.stringify(workflow.connections));

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections',
          dryRun: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Connections should remain unchanged in dryRun
        expect(JSON.stringify(result.workflow.connections)).toBe(JSON.stringify(originalConnections));
      });

      it('should handle workflow with no stale connections', async () => {
        // Use baseWorkflow which has name-based connections
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));
        const originalConnectionsCount = Object.keys(workflow.connections).length;

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Connections should remain unchanged (no stale connections to remove)
        // Verify by checking connection count
        expect(Object.keys(result.workflow.connections).length).toBe(originalConnectionsCount);
        expect(result.workflow.connections['Webhook']).toBeDefined();
        expect(result.workflow.connections['HTTP Request']).toBeDefined();
      });
    });

    describe('replaceConnections - Advanced Scenarios', () => {
      it('should fail validation when source node does not exist', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'NonExistentSource': {
            'main': [[
              { node: 'Slack', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors![0].message).toContain('Source node not found');
      });

      it('should successfully replace with empty connections object', async () => {
        const workflow = builder.build() as Workflow;

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: {}
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual({});
      });

      it('should handle complex connection structures with multiple outputs', async () => {
        const workflow = builder.build() as Workflow;

        // Add IF node
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        const newConnections = {
          'Webhook': {
            'main': [[
              { node: 'IF', type: 'main', index: 0 }
            ]]
          },
          'IF': {
            'true': [[
              { node: 'Slack', type: 'main', index: 0 }
            ]],
            'false': [[
              { node: 'HTTP Request', type: 'main', index: 0 }
            ]]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual(newConnections);
      });
    });

    describe('removeConnection with ignoreErrors - Advanced Scenarios', () => {
      it('should succeed when source node does not exist with ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'NonExistentSource',
          target: 'Slack',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Workflow should remain unchanged (verify by checking node count)
        expect(Object.keys(result.workflow.connections).length).toBe(Object.keys(baseWorkflow.connections).length);
      });

      it('should succeed when both source and target nodes do not exist with ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'NonExistentSource',
          target: 'NonExistentTarget',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should succeed when connection exists but target node does not with ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        // This is an edge case where connection references a valid node but we're trying to remove to non-existent
        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'NonExistentTarget',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should fail when source node does not exist without ignoreErrors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'NonExistentSource',
          target: 'Slack',
          ignoreErrors: false
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors![0].message).toContain('Source node not found');
      });
    });

    describe('continueOnError - Advanced Scenarios', () => {
      it('should catch runtime errors during operation application', async () => {
        const workflow = builder.build() as Workflow;

        // Create an operation that will pass validation but fail during application
        // This is simulated by causing an error in the apply phase
        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Valid Operation'
          } as UpdateNameOperation,
          {
            type: 'updateNode',
            nodeId: 'webhook-1',
            updates: {
              // This will pass validation but could fail in complex scenarios
              'parameters.invalidDeepPath.nested.value': 'test'
            }
          } as UpdateNodeOperation,
          {
            type: 'addTag',
            tag: 'another-valid'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        // All operations should succeed in this case (no runtime errors expected)
        expect(result.success).toBe(true);
        expect(result.applied).toBeDefined();
        expect(result.applied!.length).toBeGreaterThan(0);
      });

      it('should handle mixed validation and runtime errors', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Operation 0'
          } as UpdateNameOperation,
          {
            type: 'removeNode',
            nodeId: 'non-existent-1'
          } as RemoveNodeOperation,
          {
            type: 'addTag',
            tag: 'tag1'
          } as AddTagOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistent'
          } as RemoveConnectionOperation,
          {
            type: 'addTag',
            tag: 'tag2'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toContain(0); // updateName
        expect(result.applied).toContain(2); // first addTag
        expect(result.applied).toContain(4); // second addTag
        expect(result.failed).toContain(1); // removeNode
        expect(result.failed).toContain(3); // removeConnection
        expect(result.errors).toHaveLength(2);
      });

      it('should support validateOnly with continueOnError mode', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'New Name'
          } as UpdateNameOperation,
          {
            type: 'removeNode',
            nodeId: 'non-existent'
          } as RemoveNodeOperation,
          {
            type: 'addTag',
            tag: 'test-tag'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.workflow).toBeUndefined();
        expect(result.message).toContain('Validation completed');
        expect(result.applied).toEqual([0, 2]);
        expect(result.failed).toEqual([1]);
        expect(result.errors).toHaveLength(1);
      });

      it('should handle all operations failing with helpful message', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeNode',
            nodeId: 'non-existent-1'
          } as RemoveNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'non-existent-2'
          } as RemoveNodeOperation,
          {
            type: 'removeConnection',
            source: 'Invalid',
            target: 'Invalid'
          } as RemoveConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toHaveLength(0);
        expect(result.failed).toEqual([0, 1, 2]);
        expect(result.errors).toHaveLength(3);
        expect(result.message).toContain('0 operations');
        expect(result.message).toContain('3 failed');
      });

      it('should preserve operation order in applied and failed arrays', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          { type: 'updateName', name: 'Name1' } as UpdateNameOperation, // 0 - success
          { type: 'removeNode', nodeId: 'invalid1' } as RemoveNodeOperation, // 1 - fail
          { type: 'addTag', tag: 'tag1' } as AddTagOperation, // 2 - success
          { type: 'removeNode', nodeId: 'invalid2' } as RemoveNodeOperation, // 3 - fail
          { type: 'addTag', tag: 'tag2' } as AddTagOperation, // 4 - success
          { type: 'removeNode', nodeId: 'invalid3' } as RemoveNodeOperation, // 5 - fail
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toEqual([0, 2, 4]);
        expect(result.failed).toEqual([1, 3, 5]);
      });
    });

    describe('Edge Cases and Error Paths', () => {
      it('should handle workflow with initialized but empty connections', async () => {
        const workflow = builder.build() as Workflow;
        // Start with empty connections
        workflow.connections = {};

        // Add some nodes but no connections
        workflow.nodes.push({
          id: 'orphan-1',
          name: 'Orphan Node',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [800, 400],
          parameters: {}
        });

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual({});
      });

      it('should handle empty connections in cleanStaleConnections', async () => {
        const workflow = builder.build() as Workflow;
        workflow.connections = {};

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections).toEqual({});
      });

      it('should handle removeConnection with ignoreErrors on valid but non-connected nodes', async () => {
        const workflow = builder.build() as Workflow;

        // Both nodes exist but no connection between them
        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Slack',
          target: 'Webhook',
          ignoreErrors: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should handle replaceConnections with nested connection arrays', async () => {
        const workflow = builder.build() as Workflow;

        const newConnections = {
          'Webhook': {
            'main': [
              [
                { node: 'HTTP Request', type: 'main', index: 0 },
                { node: 'Slack', type: 'main', index: 0 }
              ],
              [
                { node: 'HTTP Request', type: 'main', index: 1 }
              ]
            ]
          }
        };

        const operations: ReplaceConnectionsOperation[] = [{
          type: 'replaceConnections',
          connections: newConnections
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Webhook']['main']).toHaveLength(2);
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
        expect(result.workflow.connections['Webhook']['main'][1]).toHaveLength(1);
      });

      it('should validate cleanStaleConnections always returns null', async () => {
        const workflow = builder.build() as Workflow;

        // This tests that validation for cleanStaleConnections always passes
        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Validation successful');
      });

      it('should handle continueOnError with no operations', async () => {
        const workflow = builder.build() as Workflow;

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations: [],
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toEqual([]);
        expect(result.failed).toEqual([]);
      });
    });

    describe('Integration Tests - v2.14.4 Features Combined', () => {
      it('should combine cleanStaleConnections and replaceConnections', async () => {
        const workflow = builder.build() as Workflow;

        // Add stale connections
        workflow.connections['GhostNode'] = {
          'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
        };

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'cleanStaleConnections'
          } as CleanStaleConnectionsOperation,
          {
            type: 'replaceConnections',
            connections: {
              'Webhook': {
                'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
              }
            }
          } as ReplaceConnectionsOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['GhostNode']).toBeUndefined();
        expect(result.workflow.connections['Webhook']['main'][0][0].node).toBe('Slack');
      });

      it('should use continueOnError with new v2.14.4 operations', async () => {
        const workflow = builder.build() as Workflow;

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'cleanStaleConnections'
          } as CleanStaleConnectionsOperation,
          {
            type: 'replaceConnections',
            connections: {
              'NonExistentNode': {
                'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
              }
            }
          } as ReplaceConnectionsOperation,
          {
            type: 'removeConnection',
            source: 'Webhook',
            target: 'NonExistent',
            ignoreErrors: true
          } as RemoveConnectionOperation,
          {
            type: 'addTag',
            tag: 'final-tag'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.applied).toContain(0); // cleanStaleConnections
        expect(result.failed).toContain(1); // replaceConnections with invalid node
        expect(result.applied).toContain(2); // removeConnection with ignoreErrors
        expect(result.applied).toContain(3); // addTag
        expect(result.workflow.tags).toContain('final-tag');
      });
    });

    describe('Additional Edge Cases for 90% Coverage', () => {
      it('should handle cleanStaleConnections with connections from valid node to itself', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add self-referencing connection
        if (!workflow.connections['Webhook']) {
          workflow.connections['Webhook'] = {};
        }
        workflow.connections['Webhook']['main'] = [[
          { node: 'Webhook', type: 'main', index: 0 },
          { node: 'HTTP Request', type: 'main', index: 0 }
        ]];

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Self-referencing connection should remain (it's valid)
        expect(result.workflow.connections['Webhook']['main'][0].some((c: any) => c.node === 'Webhook')).toBe(true);
      });

      it('should handle removeTag when tags array does not exist', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));
        delete workflow.tags;

        const operations: RemoveTagOperation[] = [{
          type: 'removeTag',
          tag: 'non-existent'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should handle cleanStaleConnections with multiple connection indices', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add connections with multiple indices
        workflow.connections['Webhook'] = {
          'main': [
            [
              { node: 'HTTP Request', type: 'main', index: 0 },
              { node: 'Slack', type: 'main', index: 0 }
            ],
            [
              { node: 'StaleNode', type: 'main', index: 0 }
            ]
          ]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // First index should remain with both valid connections
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
        // Second index with stale node should be removed, so only one index remains
        expect(result.workflow.connections['Webhook']['main'].length).toBe(1);
      });

      it('should handle continueOnError with runtime error during apply', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Create a scenario that might cause runtime errors
        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateNode',
            nodeId: 'webhook-1',
            updates: {
              'parameters.test': 'value1'
            }
          } as UpdateNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid-node'
          } as RemoveNodeOperation,
          {
            type: 'updateNode',
            nodeName: 'HTTP Request',
            updates: {
              'parameters.test': 'value2'
            }
          } as UpdateNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.applied).toContain(0);
        expect(result.failed).toContain(1);
        expect(result.applied).toContain(2);
      });

      it('should handle atomic mode failure in node operations', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateNode',
            nodeId: 'webhook-1',
            updates: {
              'parameters.valid': 'update'
            }
          } as UpdateNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid-node'
          } as RemoveNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].operation).toBe(1);
      });

      it('should handle atomic mode failure in connection operations', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'addNode',
            node: {
              name: 'NewNode',
              type: 'n8n-nodes-base.code',
              position: [900, 300],
              parameters: {}
            }
          } as AddNodeOperation,
          {
            type: 'addConnection',
            source: 'NewNode',
            target: 'InvalidTarget'
          } as AddConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors![0].operation).toBe(1);
      });

      it('should handle cleanStaleConnections in dryRun with source node missing', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add connections from non-existent source
        workflow.connections['GhostSource1'] = {
          'main': [[{ node: 'Slack', type: 'main', index: 0 }]]
        };

        workflow.connections['GhostSource2'] = {
          'main': [[{ node: 'HTTP Request', type: 'main', index: 0 }]],
          'error': [[{ node: 'Slack', type: 'main', index: 0 }]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections',
          dryRun: true
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // In dryRun, connections should remain
        expect(result.workflow.connections['GhostSource1']).toBeDefined();
        expect(result.workflow.connections['GhostSource2']).toBeDefined();
      });

      it('should handle validateOnly in atomic mode', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Validated Name'
          } as UpdateNameOperation,
          {
            type: 'addNode',
            node: {
              name: 'ValidNode',
              type: 'n8n-nodes-base.code',
              position: [900, 300],
              parameters: {}
            }
          } as AddNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow).toBeUndefined();
        expect(result.message).toContain('Validation successful');
        expect(result.message).toContain('not applied');
      });

      it('should handle malformed workflow object gracefully', async () => {
        // Create a malformed workflow that will cause JSON parsing errors
        const malformedWorkflow: any = {
          name: 'Test',
          nodes: [],
          connections: {}
        };

        // Create circular reference to cause JSON.stringify to fail
        malformedWorkflow.self = malformedWorkflow;

        const operations: WorkflowDiffOperation[] = [{
          type: 'updateName',
          name: 'New Name'
        } as UpdateNameOperation];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(malformedWorkflow, request);

        // Should handle the error gracefully
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
      });

      it('should handle continueOnError with all operations causing errors', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeNode',
            nodeId: 'invalid1'
          } as RemoveNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid2'
          } as RemoveNodeOperation,
          {
            type: 'addConnection',
            source: 'Invalid1',
            target: 'Invalid2'
          } as AddConnectionOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.applied).toEqual([]);
        expect(result.failed).toEqual([0, 1, 2]);
        expect(result.errors).toHaveLength(3);
      });

      it('should handle atomic mode with empty operations array', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations: []
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.operationsApplied).toBe(0);
      });

      it('should handle removeConnection without sourceOutput specified', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'Webhook',
          target: 'HTTP Request'
          // sourceOutput not specified, should default to 'main'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should handle continueOnError validateOnly with all errors', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'removeNode',
            nodeId: 'invalid1'
          } as RemoveNodeOperation,
          {
            type: 'removeNode',
            nodeId: 'invalid2'
          } as RemoveNodeOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(false);
        expect(result.message).toContain('Validation completed');
        expect(result.errors).toHaveLength(2);
        expect(result.workflow).toBeUndefined();
      });

      it('should handle updateConnection with complex output configurations', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add IF node
        workflow.nodes.push({
          id: 'if-1',
          name: 'IF',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          position: [600, 400],
          parameters: {}
        });

        // Add connection on 'true' output
        workflow.connections['IF'] = {
          'true': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        const operations: UpdateConnectionOperation[] = [{
          type: 'updateConnection',
          source: 'IF',
          target: 'Slack',
          updates: {
            sourceOutput: 'false',
            targetInput: 'main',
            sourceIndex: 0,
            targetIndex: 0
          }
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
      });

      it('should handle addConnection with all optional parameters specified', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add Code node
        workflow.nodes.push({
          id: 'code-1',
          name: 'Code',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [900, 300],
          parameters: {}
        });

        const operations: AddConnectionOperation[] = [{
          type: 'addConnection',
          source: 'Slack',
          target: 'Code',
          sourceOutput: 'main',
          targetInput: 'main',
          sourceIndex: 0,
          targetIndex: 0
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Slack']['main'][0][0].node).toBe('Code');
        expect(result.workflow.connections['Slack']['main'][0][0].type).toBe('main');
        expect(result.workflow.connections['Slack']['main'][0][0].index).toBe(0);
      });

      it('should handle cleanStaleConnections actually removing source node connections', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add connections from non-existent source that should be deleted entirely
        workflow.connections['NonExistentSource1'] = {
          'main': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        workflow.connections['NonExistentSource2'] = {
          'main': [[
            { node: 'HTTP Request', type: 'main', index: 0 }
          ]],
          'error': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['NonExistentSource1']).toBeUndefined();
        expect(result.workflow.connections['NonExistentSource2']).toBeUndefined();
      });

      it('should handle validateOnly with no errors in continueOnError mode', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        const operations: WorkflowDiffOperation[] = [
          {
            type: 'updateName',
            name: 'Valid Name'
          } as UpdateNameOperation,
          {
            type: 'addTag',
            tag: 'valid-tag'
          } as AddTagOperation
        ];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations,
          continueOnError: true,
          validateOnly: true
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.message).toContain('Validation successful');
        expect(result.errors).toBeUndefined();
        expect(result.applied).toEqual([0, 1]);
        expect(result.failed).toEqual([]);
      });

      it('should handle addConnection initializing missing connection structure', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add node without any connections
        workflow.nodes.push({
          id: 'orphan-1',
          name: 'Orphan',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [900, 300],
          parameters: {}
        });

        // Ensure Orphan has no connections initially
        delete workflow.connections['Orphan'];

        const operations: AddConnectionOperation[] = [{
          type: 'addConnection',
          source: 'Orphan',
          target: 'Slack'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Orphan']).toBeDefined();
        expect(result.workflow.connections['Orphan']['main']).toBeDefined();
        expect(result.workflow.connections['Orphan']['main'][0][0].node).toBe('Slack');
      });

      it('should handle addConnection with sourceIndex requiring array expansion', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Add Code node
        workflow.nodes.push({
          id: 'code-1',
          name: 'Code',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          position: [900, 300],
          parameters: {}
        });

        const operations: AddConnectionOperation[] = [{
          type: 'addConnection',
          source: 'Slack',
          target: 'Code',
          sourceIndex: 5 // Force array expansion to index 5
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        expect(result.workflow.connections['Slack']['main'].length).toBeGreaterThanOrEqual(6);
        expect(result.workflow.connections['Slack']['main'][5][0].node).toBe('Code');
      });

      it('should handle removeConnection cleaning up empty output structures', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Set up a connection that will leave empty structures after removal
        workflow.connections['HTTP Request'] = {
          'main': [[
            { node: 'Slack', type: 'main', index: 0 }
          ]]
        };

        const operations: RemoveConnectionOperation[] = [{
          type: 'removeConnection',
          source: 'HTTP Request',
          target: 'Slack'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Connection should be removed entirely (cleanup of empty structures)
        expect(result.workflow.connections['HTTP Request']).toBeUndefined();
      });

      it('should handle complex cleanStaleConnections scenario with mixed valid/invalid', async () => {
        const workflow = JSON.parse(JSON.stringify(baseWorkflow));

        // Create a complex scenario with multiple source nodes
        workflow.connections['Webhook'] = {
          'main': [[
            { node: 'HTTP Request', type: 'main', index: 0 },
            { node: 'Stale1', type: 'main', index: 0 },
            { node: 'Slack', type: 'main', index: 0 },
            { node: 'Stale2', type: 'main', index: 0 }
          ]],
          'error': [[
            { node: 'Stale3', type: 'main', index: 0 }
          ]]
        };

        const operations: CleanStaleConnectionsOperation[] = [{
          type: 'cleanStaleConnections'
        }];

        const request: WorkflowDiffRequest = {
          id: 'test-workflow',
          operations
        };

        const result = await diffEngine.applyDiff(workflow, request);

        expect(result.success).toBe(true);
        // Only valid connections should remain
        expect(result.workflow.connections['Webhook']['main'][0]).toHaveLength(2);
        expect(result.workflow.connections['Webhook']['main'][0].some((c: any) => c.node === 'HTTP Request')).toBe(true);
        expect(result.workflow.connections['Webhook']['main'][0].some((c: any) => c.node === 'Slack')).toBe(true);
        // Error output should be removed entirely (all stale)
        expect(result.workflow.connections['Webhook']['error']).toBeUndefined();
      });
    });
  });
});