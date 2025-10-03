import { ToolDocumentation } from '../types';

export const n8nUpdatePartialWorkflowDoc: ToolDocumentation = {
  name: 'n8n_update_partial_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Update workflow incrementally with diff operations. Types: addNode, removeNode, updateNode, moveNode, enable/disableNode, addConnection, removeConnection, cleanStaleConnections, replaceConnections, updateSettings, updateName, add/removeTag.',
    keyParameters: ['id', 'operations', 'continueOnError'],
    example: 'n8n_update_partial_workflow({id: "wf_123", operations: [{type: "cleanStaleConnections"}]})',
    performance: 'Fast (50-200ms)',
    tips: [
      'Use cleanStaleConnections to auto-remove broken connections',
      'Set ignoreErrors:true on removeConnection for cleanup',
      'Use continueOnError mode for best-effort bulk operations',
      'Validate with validateOnly first'
    ]
  },
  full: {
    description: `Updates workflows using surgical diff operations instead of full replacement. Supports 15 operation types for precise modifications. Operations are validated and applied atomically by default - all succeed or none are applied. v2.14.4 adds cleanup operations and best-effort mode for workflow recovery scenarios.

## Available Operations:

### Node Operations (6 types):
- **addNode**: Add a new node with name, type, and position (required)
- **removeNode**: Remove a node by ID or name
- **updateNode**: Update node properties using dot notation (e.g., 'parameters.url')
- **moveNode**: Change node position [x, y]
- **enableNode**: Enable a disabled node
- **disableNode**: Disable an active node

### Connection Operations (5 types):
- **addConnection**: Connect nodes (source→target)
- **removeConnection**: Remove connection between nodes (supports ignoreErrors flag)
- **updateConnection**: Modify connection properties
- **cleanStaleConnections**: Auto-remove all connections referencing non-existent nodes (NEW in v2.14.4)
- **replaceConnections**: Replace entire connections object (NEW in v2.14.4)

### Metadata Operations (4 types):
- **updateSettings**: Modify workflow settings
- **updateName**: Rename the workflow
- **addTag**: Add a workflow tag
- **removeTag**: Remove a workflow tag

## New in v2.14.4: Cleanup & Recovery Features

### Automatic Cleanup
The **cleanStaleConnections** operation automatically removes broken connection references after node renames/deletions. Essential for workflow recovery.

### Best-Effort Mode
Set **continueOnError: true** to apply valid operations even if some fail. Returns detailed results showing which operations succeeded/failed. Perfect for bulk cleanup operations.

### Graceful Error Handling
Add **ignoreErrors: true** to removeConnection operations to prevent failures when connections don't exist.`,
    parameters: {
      id: { type: 'string', required: true, description: 'Workflow ID to update' },
      operations: {
        type: 'array',
        required: true,
        description: 'Array of diff operations. Each must have "type" field and operation-specific properties. Nodes can be referenced by ID or name.'
      },
      validateOnly: { type: 'boolean', description: 'If true, only validate operations without applying them' },
      continueOnError: { type: 'boolean', description: 'If true, apply valid operations even if some fail (best-effort mode). Returns applied and failed operation indices. Default: false (atomic)' }
    },
    returns: 'Updated workflow object or validation results if validateOnly=true',
    examples: [
      '// Clean up stale connections after node renames/deletions\nn8n_update_partial_workflow({id: "abc", operations: [{type: "cleanStaleConnections"}]})',
      '// Remove connection gracefully (no error if it doesn\'t exist)\nn8n_update_partial_workflow({id: "xyz", operations: [{type: "removeConnection", source: "Old Node", target: "Target", ignoreErrors: true}]})',
      '// Best-effort mode: apply what works, report what fails\nn8n_update_partial_workflow({id: "123", operations: [\n  {type: "updateName", name: "Fixed Workflow"},\n  {type: "removeConnection", source: "Broken", target: "Node"},\n  {type: "cleanStaleConnections"}\n], continueOnError: true})',
      '// Replace entire connections object\nn8n_update_partial_workflow({id: "456", operations: [{type: "replaceConnections", connections: {"Webhook": {"main": [[{node: "Slack", type: "main", index: 0}]]}}}]})',
      '// Update node parameter (classic atomic mode)\nn8n_update_partial_workflow({id: "789", operations: [{type: "updateNode", nodeName: "HTTP Request", updates: {"parameters.url": "https://api.example.com"}}]})',
      '// Validate before applying\nn8n_update_partial_workflow({id: "012", operations: [{type: "removeNode", nodeName: "Old Process"}], validateOnly: true})'
    ],
    useCases: [
      'Clean up broken workflows after node renames/deletions',
      'Bulk connection cleanup with best-effort mode',
      'Update single node parameters',
      'Replace all connections at once',
      'Graceful cleanup operations that don\'t fail',
      'Enable/disable nodes',
      'Rename workflows or nodes',
      'Manage tags efficiently'
    ],
    performance: 'Very fast - typically 50-200ms. Much faster than full updates as only changes are processed.',
    bestPractices: [
      'Use cleanStaleConnections after renaming/removing nodes',
      'Use continueOnError for bulk cleanup operations',
      'Set ignoreErrors:true on removeConnection for graceful cleanup',
      'Use validateOnly to test operations before applying',
      'Group related changes in one call',
      'Check operation order for dependencies',
      'Use atomic mode (default) for critical updates'
    ],
    pitfalls: [
      '**REQUIRES N8N_API_URL and N8N_API_KEY environment variables** - will not work without n8n API access',
      'Atomic mode (default): all operations must succeed or none are applied',
      'continueOnError breaks atomic guarantees - use with caution',
      'Order matters for dependent operations (e.g., must add node before connecting to it)',
      'Node references accept ID or name, but name must be unique',
      'Use "updates" property for updateNode operations: {type: "updateNode", updates: {...}}',
      'cleanStaleConnections removes ALL broken connections - cannot be selective',
      'replaceConnections overwrites entire connections object - all previous connections lost'
    ],
    relatedTools: ['n8n_update_full_workflow', 'n8n_get_workflow', 'validate_workflow', 'tools_documentation']
  }
};