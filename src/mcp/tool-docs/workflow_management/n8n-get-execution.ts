import { ToolDocumentation } from '../types';

export const n8nGetExecutionDoc: ToolDocumentation = {
  name: 'n8n_get_execution',
  category: 'workflow_management',
  essentials: {
    description: 'Get execution details with smart filtering to avoid token limits. Use preview mode first to assess data size, then fetch appropriately.',
    keyParameters: ['id', 'mode', 'itemsLimit', 'nodeNames'],
    example: `
// RECOMMENDED WORKFLOW:
// 1. Preview first
n8n_get_execution({id: "12345", mode: "preview"})
// Returns: structure, counts, size estimate, recommendation

// 2. Based on recommendation, fetch data:
n8n_get_execution({id: "12345", mode: "summary"}) // 2 items per node
n8n_get_execution({id: "12345", mode: "filtered", itemsLimit: 5}) // 5 items
n8n_get_execution({id: "12345", nodeNames: ["HTTP Request"]}) // Specific node
`,
    performance: 'Preview: <50ms, Summary: <200ms, Full: depends on data size',
    tips: [
      'ALWAYS use preview mode first for large datasets',
      'Preview shows structure + counts without consuming tokens for data',
      'Summary mode (2 items per node) is safe default',
      'Use nodeNames to focus on specific nodes only',
      'itemsLimit: 0 = structure only, -1 = unlimited',
      'Check recommendation.suggestedMode from preview'
    ]
  },
  full: {
    description: `Retrieves and intelligently filters execution data to enable inspection without exceeding token limits. This tool provides multiple modes for different use cases, from quick previews to complete data retrieval.

**The Problem**: Workflows processing large datasets (50+ database records) generate execution data that exceeds token/response limits, making traditional full-data fetching impossible.

**The Solution**: Four retrieval modes with smart filtering:
1. **Preview**: Structure + counts only (no actual data)
2. **Summary**: 2 sample items per node (safe default)
3. **Filtered**: Custom limits and node selection
4. **Full**: Complete data (use with caution)

**Recommended Workflow**:
1. Start with preview mode to assess size
2. Use recommendation to choose appropriate mode
3. Fetch filtered data as needed`,

    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The execution ID to retrieve. Obtained from list_executions or webhook trigger responses'
      },
      mode: {
        type: 'string',
        required: false,
        description: `Retrieval mode (default: auto-detect from other params):
- 'preview': Structure, counts, size estimates - NO actual data (fastest)
- 'summary': Metadata + 2 sample items per node (safe default)
- 'filtered': Custom filtering with itemsLimit/nodeNames
- 'full': Complete execution data (use with caution)`
      },
      nodeNames: {
        type: 'array',
        required: false,
        description: 'Filter to specific nodes by name. Example: ["HTTP Request", "Filter"]. Useful when you only need to inspect specific nodes.'
      },
      itemsLimit: {
        type: 'number',
        required: false,
        description: `Items to return per node (default: 2):
- 0: Structure only (see data shape without values)
- 1-N: Return N items per node
- -1: Unlimited (return all items)

Note: Structure-only mode (0) shows JSON schema without actual values.`
      },
      includeInputData: {
        type: 'boolean',
        required: false,
        description: 'Include input data in addition to output data (default: false). Useful for debugging data transformations.'
      },
      includeData: {
        type: 'boolean',
        required: false,
        description: 'DEPRECATED: Legacy parameter. Use mode instead. If true, maps to mode="summary" for backward compatibility.'
      }
    },

    returns: `**Preview Mode Response**:
{
  mode: 'preview',
  preview: {
    totalNodes: number,
    executedNodes: number,
    estimatedSizeKB: number,
    nodes: {
      [nodeName]: {
        status: 'success' | 'error',
        itemCounts: { input: number, output: number },
        dataStructure: {...}, // JSON schema
        estimatedSizeKB: number
      }
    }
  },
  recommendation: {
    canFetchFull: boolean,
    suggestedMode: 'preview'|'summary'|'filtered'|'full',
    suggestedItemsLimit?: number,
    reason: string
  }
}

**Summary/Filtered/Full Mode Response**:
{
  mode: 'summary' | 'filtered' | 'full',
  summary: {
    totalNodes: number,
    executedNodes: number,
    totalItems: number,
    hasMoreData: boolean  // true if truncated
  },
  nodes: {
    [nodeName]: {
      executionTime: number,
      itemsInput: number,
      itemsOutput: number,
      status: 'success' | 'error',
      error?: string,
      data: {
        output: [...],  // Actual data items
        metadata: {
          totalItems: number,
          itemsShown: number,
          truncated: boolean
        }
      }
    }
  }
}`,

    examples: [
      `// Example 1: Preview workflow (RECOMMENDED FIRST STEP)
n8n_get_execution({id: "exec_123", mode: "preview"})
// Returns structure, counts, size, recommendation
// Use this to decide how to fetch data`,

      `// Example 2: Follow recommendation
const preview = n8n_get_execution({id: "exec_123", mode: "preview"});
if (preview.recommendation.canFetchFull) {
  n8n_get_execution({id: "exec_123", mode: "full"});
} else {
  n8n_get_execution({
    id: "exec_123",
    mode: "filtered",
    itemsLimit: preview.recommendation.suggestedItemsLimit
  });
}`,

      `// Example 3: Summary mode (safe default for unknown datasets)
n8n_get_execution({id: "exec_123", mode: "summary"})
// Gets 2 items per node - safe for most cases`,

      `// Example 4: Filter to specific node
n8n_get_execution({
  id: "exec_123",
  mode: "filtered",
  nodeNames: ["HTTP Request"],
  itemsLimit: 5
})
// Gets only HTTP Request node, 5 items`,

      `// Example 5: Structure only (see data shape)
n8n_get_execution({
  id: "exec_123",
  mode: "filtered",
  itemsLimit: 0
})
// Returns JSON schema without actual values`,

      `// Example 6: Debug with input data
n8n_get_execution({
  id: "exec_123",
  mode: "filtered",
  nodeNames: ["Transform"],
  itemsLimit: 2,
  includeInputData: true
})
// See both input and output for debugging`,

      `// Example 7: Backward compatibility (legacy)
n8n_get_execution({id: "exec_123"}) // Minimal data
n8n_get_execution({id: "exec_123", includeData: true}) // Maps to summary mode`
    ],

    useCases: [
      'Monitor status of triggered workflows',
      'Debug failed workflows by examining error messages and partial data',
      'Inspect large datasets without exceeding token limits',
      'Validate data transformations between nodes',
      'Understand execution flow and timing',
      'Track workflow performance metrics',
      'Verify successful completion before proceeding',
      'Extract specific data from execution results'
    ],

    performance: `**Response Times** (approximate):
- Preview mode: <50ms (no data, just structure)
- Summary mode: <200ms (2 items per node)
- Filtered mode: 50-500ms (depends on filters)
- Full mode: 200ms-5s (depends on data size)

**Token Consumption**:
- Preview: ~500 tokens (no data values)
- Summary (2 items): ~2-5K tokens
- Filtered (5 items): ~5-15K tokens
- Full (50+ items): 50K+ tokens (may exceed limits)

**Optimization Tips**:
- Use preview for all large datasets
- Use nodeNames to focus on relevant nodes only
- Start with small itemsLimit and increase if needed
- Use itemsLimit: 0 to see structure without data`,

    bestPractices: [
      'ALWAYS use preview mode first for unknown datasets',
      'Trust the recommendation.suggestedMode from preview',
      'Use nodeNames to filter to relevant nodes only',
      'Start with summary mode if preview indicates moderate size',
      'Use itemsLimit: 0 to understand data structure',
      'Check hasMoreData to know if results are truncated',
      'Store execution IDs from triggers for later inspection',
      'Use mode="filtered" with custom limits for large datasets',
      'Include input data only when debugging transformations',
      'Monitor summary.totalItems to understand dataset size'
    ],

    pitfalls: [
      'DON\'T fetch full mode without previewing first - may timeout',
      'DON\'T assume all data fits - always check hasMoreData',
      'DON\'T ignore the recommendation from preview mode',
      'Execution data is retained based on n8n settings - old executions may be purged',
      'Binary data (files, images) is not fully included - only metadata',
      'Status "waiting" indicates execution is still running',
      'Error executions may have partial data from successful nodes',
      'Very large individual items (>1MB) may be truncated',
      'Preview mode estimates may be off by 10-20% for complex structures',
      'Node names are case-sensitive in nodeNames filter'
    ],

    modeComparison: `**When to use each mode**:

**Preview**:
- ALWAYS use first for unknown datasets
- When you need to know if data is safe to fetch
- To see data structure without consuming tokens
- To get size estimates and recommendations

**Summary** (default):
- Safe default for most cases
- When you need representative samples
- When preview recommends it
- For quick data inspection

**Filtered**:
- When you need specific nodes only
- When you need more than 2 items but not all
- When preview recommends it with itemsLimit
- For targeted data extraction

**Full**:
- ONLY when preview says canFetchFull: true
- For small executions (< 20 items total)
- When you genuinely need all data
- When you're certain data fits in token limit`,

    relatedTools: [
      'n8n_list_executions - Find execution IDs',
      'n8n_trigger_webhook_workflow - Trigger and get execution ID',
      'n8n_delete_execution - Clean up old executions',
      'n8n_get_workflow - Get workflow structure',
      'validate_workflow - Validate before executing'
    ]
  }
};
