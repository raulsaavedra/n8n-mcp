import { ToolDocumentation } from '../types';

export const n8nAutofixWorkflowDoc: ToolDocumentation = {
  name: 'n8n_autofix_workflow',
  category: 'workflow_management',
  essentials: {
    description: 'Automatically fix common workflow validation errors - expression formats, typeVersions, error outputs, webhook paths',
    keyParameters: ['id', 'applyFixes'],
    example: 'n8n_autofix_workflow({id: "wf_abc123", applyFixes: false})',
    performance: 'Network-dependent (200-1000ms) - fetches, validates, and optionally updates workflow',
    tips: [
      'Use applyFixes: false to preview changes before applying',
      'Set confidenceThreshold to control fix aggressiveness (high/medium/low)',
      'Supports fixing expression formats, typeVersion issues, error outputs, node type corrections, and webhook paths',
      'High-confidence fixes (≥90%) are safe for auto-application'
    ]
  },
  full: {
    description: `Automatically detects and fixes common workflow validation errors in n8n workflows. This tool:

- Fetches the workflow from your n8n instance
- Runs comprehensive validation to detect issues
- Generates targeted fixes for common problems
- Optionally applies the fixes back to the workflow

The auto-fixer can resolve:
1. **Expression Format Issues**: Missing '=' prefix in n8n expressions (e.g., {{ $json.field }} → ={{ $json.field }})
2. **TypeVersion Corrections**: Downgrades nodes with unsupported typeVersions to maximum supported
3. **Error Output Configuration**: Removes conflicting onError settings when error connections are missing
4. **Node Type Corrections**: Intelligently fixes unknown node types using similarity matching:
   - Handles deprecated package prefixes (n8n-nodes-base. → nodes-base.)
   - Corrects capitalization mistakes (HttpRequest → httpRequest)
   - Suggests correct packages (nodes-base.openai → nodes-langchain.openAi)
   - Uses multi-factor scoring: name similarity, category match, package match, pattern match
   - Only auto-fixes suggestions with ≥90% confidence
   - Leverages NodeSimilarityService with 5-minute caching for performance
5. **Webhook Path Generation**: Automatically generates UUIDs for webhook nodes missing path configuration:
   - Generates a unique UUID for webhook path
   - Sets both 'path' parameter and 'webhookId' field to the same UUID
   - Ensures webhook nodes become functional with valid endpoints
   - High confidence fix as UUID generation is deterministic

The tool uses a confidence-based system to ensure safe fixes:
- **High (≥90%)**: Safe to auto-apply (exact matches, known patterns)
- **Medium (70-89%)**: Generally safe but review recommended
- **Low (<70%)**: Manual review strongly recommended

Requires N8N_API_URL and N8N_API_KEY environment variables to be configured.`,
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The workflow ID to fix in your n8n instance'
      },
      applyFixes: {
        type: 'boolean',
        required: false,
        description: 'Whether to apply fixes to the workflow (default: false - preview mode). When false, returns proposed fixes without modifying the workflow.'
      },
      fixTypes: {
        type: 'array',
        required: false,
        description: 'Types of fixes to apply. Options: ["expression-format", "typeversion-correction", "error-output-config", "node-type-correction", "webhook-missing-path"]. Default: all types.'
      },
      confidenceThreshold: {
        type: 'string',
        required: false,
        description: 'Minimum confidence level for fixes: "high" (≥90%), "medium" (≥70%), "low" (any). Default: "medium".'
      },
      maxFixes: {
        type: 'number',
        required: false,
        description: 'Maximum number of fixes to apply (default: 50). Useful for limiting scope of changes.'
      }
    },
    returns: `AutoFixResult object containing:
- operations: Array of diff operations that will be/were applied
- fixes: Detailed list of individual fixes with before/after values
- summary: Human-readable summary of fixes
- stats: Statistics by fix type and confidence level
- applied: Boolean indicating if fixes were applied (when applyFixes: true)`,
    examples: [
      'n8n_autofix_workflow({id: "wf_abc123"}) - Preview all possible fixes',
      'n8n_autofix_workflow({id: "wf_abc123", applyFixes: true}) - Apply all medium+ confidence fixes',
      'n8n_autofix_workflow({id: "wf_abc123", applyFixes: true, confidenceThreshold: "high"}) - Only apply high-confidence fixes',
      'n8n_autofix_workflow({id: "wf_abc123", fixTypes: ["expression-format"]}) - Only fix expression format issues',
      'n8n_autofix_workflow({id: "wf_abc123", fixTypes: ["webhook-missing-path"]}) - Only fix webhook path issues',
      'n8n_autofix_workflow({id: "wf_abc123", applyFixes: true, maxFixes: 10}) - Apply up to 10 fixes'
    ],
    useCases: [
      'Fixing workflows imported from older n8n versions',
      'Correcting expression syntax after manual edits',
      'Resolving typeVersion conflicts after n8n upgrades',
      'Cleaning up workflows before production deployment',
      'Batch fixing common issues across multiple workflows',
      'Migrating workflows between n8n instances with different versions',
      'Repairing webhook nodes that lost their path configuration'
    ],
    performance: 'Depends on workflow size and number of issues. Preview mode: 200-500ms. Apply mode: 500-1000ms for medium workflows. Node similarity matching is cached for 5 minutes for improved performance on repeated validations.',
    bestPractices: [
      'Always preview fixes first (applyFixes: false) before applying',
      'Start with high confidence threshold for production workflows',
      'Review the fix summary to understand what changed',
      'Test workflows after auto-fixing to ensure expected behavior',
      'Use fixTypes parameter to target specific issue categories',
      'Keep maxFixes reasonable to avoid too many changes at once'
    ],
    pitfalls: [
      'Some fixes may change workflow behavior - always test after fixing',
      'Low confidence fixes might not be the intended solution',
      'Expression format fixes assume standard n8n syntax requirements',
      'Node type corrections only work for known node types in the database',
      'Cannot fix structural issues like missing nodes or invalid connections',
      'TypeVersion downgrades might remove node features added in newer versions',
      'Generated webhook paths are new UUIDs - existing webhook URLs will change'
    ],
    relatedTools: [
      'n8n_validate_workflow',
      'validate_workflow',
      'n8n_update_partial_workflow',
      'validate_workflow_expressions',
      'validate_node_operation'
    ]
  }
};