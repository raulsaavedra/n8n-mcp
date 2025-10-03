import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema,
  InitializeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { n8nDocumentationToolsFinal } from './tools';
import { n8nManagementTools } from './tools-n8n-manager';
import { makeToolsN8nFriendly } from './tools-n8n-friendly';
import { getWorkflowExampleString } from './workflow-examples';
import { isN8nApiConfigured } from '../config/n8n-api';
import { logger } from '../utils/logger';
import { NodeRepository } from '../database/node-repository';
import { DatabaseAdapter, createDatabaseAdapter } from '../database/database-adapter';
import { PropertyFilter } from '../services/property-filter';
import { ConfigValidator } from '../services/config-validator';
import { EnhancedConfigValidator, ValidationMode, ValidationProfile } from '../services/enhanced-config-validator';
import { PropertyDependencies } from '../services/property-dependencies';
import { SimpleCache } from '../utils/simple-cache';
import { WorkflowValidator } from '../services/workflow-validator';
import * as n8nHandlers from './handlers-n8n-manager';
import { handleUpdatePartialWorkflow } from './handlers-workflow-diff';
import { getToolDocumentation, getToolsOverview } from './tools-documentation';
import { PROJECT_VERSION } from '../utils/version';
import { getNodeTypeAlternatives, getWorkflowNodeType } from '../utils/node-utils';
import { NodeTypeNormalizer } from '../utils/node-type-normalizer';
import { ToolValidation, Validator, ValidationError } from '../utils/validation-schemas';
import {
  negotiateProtocolVersion,
  logProtocolNegotiation,
  STANDARD_PROTOCOL_VERSION
} from '../utils/protocol-version';
import { InstanceContext } from '../types/instance-context';

interface NodeRow {
  node_type: string;
  package_name: string;
  display_name: string;
  description?: string;
  category?: string;
  development_style?: string;
  is_ai_tool: number;
  is_trigger: number;
  is_webhook: number;
  is_versioned: number;
  version?: string;
  documentation?: string;
  properties_schema?: string;
  operations?: string;
  credentials_required?: string;
}

export class N8NDocumentationMCPServer {
  private server: Server;
  private db: DatabaseAdapter | null = null;
  private repository: NodeRepository | null = null;
  private initialized: Promise<void>;
  private cache = new SimpleCache();
  private clientInfo: any = null;
  private instanceContext?: InstanceContext;
  private previousTool: string | null = null;
  private previousToolTimestamp: number = Date.now();

  constructor(instanceContext?: InstanceContext) {
    this.instanceContext = instanceContext;
    // Check for test environment first
    const envDbPath = process.env.NODE_DB_PATH;
    let dbPath: string | null = null;
    
    let possiblePaths: string[] = [];
    
    if (envDbPath && (envDbPath === ':memory:' || existsSync(envDbPath))) {
      dbPath = envDbPath;
    } else {
      // Try multiple database paths
      possiblePaths = [
        path.join(process.cwd(), 'data', 'nodes.db'),
        path.join(__dirname, '../../data', 'nodes.db'),
        './data/nodes.db'
      ];
      
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          dbPath = p;
          break;
        }
      }
    }
    
    if (!dbPath) {
      logger.error('Database not found in any of the expected locations:', possiblePaths);
      throw new Error('Database nodes.db not found. Please run npm run rebuild first.');
    }
    
    // Initialize database asynchronously
    this.initialized = this.initializeDatabase(dbPath);
    
    logger.info('Initializing n8n Documentation MCP server');
    
    const hasApiConfig = isN8nApiConfigured() || !!(instanceContext?.n8nApiUrl && instanceContext?.n8nApiKey);
    const totalTools = hasApiConfig
      ? n8nDocumentationToolsFinal.length + n8nManagementTools.length
      : n8nDocumentationToolsFinal.length;
    logger.info(`MCP server initialized with ${totalTools} tools (n8n API ${hasApiConfig ? 'configured' : 'not configured'})`);
    
    this.server = new Server(
      {
        name: 'n8n-documentation-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }
  
  private async initializeDatabase(dbPath: string): Promise<void> {
    try {
      this.db = await createDatabaseAdapter(dbPath);
      
      // If using in-memory database for tests, initialize schema
      if (dbPath === ':memory:') {
        await this.initializeInMemorySchema();
      }
      
      this.repository = new NodeRepository(this.db);

      // Initialize similarity services for enhanced validation
      EnhancedConfigValidator.initializeSimilarityServices(this.repository);

      logger.info(`Initialized database from: ${dbPath}`);
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw new Error(`Failed to open database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async initializeInMemorySchema(): Promise<void> {
    if (!this.db) return;
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, '../../src/database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    
    // Execute schema statements
    const statements = schema.split(';').filter(stmt => stmt.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        this.db.exec(statement);
      }
    }
  }
  
  private async ensureInitialized(): Promise<void> {
    await this.initialized;
    if (!this.db || !this.repository) {
      throw new Error('Database not initialized');
    }
  }

  private setupHandlers(): void {
    // Handle initialization
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const clientVersion = request.params.protocolVersion;
      const clientCapabilities = request.params.capabilities;
      const clientInfo = request.params.clientInfo;
      
      logger.info('MCP Initialize request received', {
        clientVersion,
        clientCapabilities,
        clientInfo
      });

      // Track session start

      // Store client info for later use
      this.clientInfo = clientInfo;
      
      // Negotiate protocol version based on client information
      const negotiationResult = negotiateProtocolVersion(
        clientVersion,
        clientInfo,
        undefined, // no user agent in MCP protocol
        undefined  // no headers in MCP protocol
      );
      
      logProtocolNegotiation(negotiationResult, logger, 'MCP_INITIALIZE');
      
      // Warn if there's a version mismatch (for debugging)
      if (clientVersion && clientVersion !== negotiationResult.version) {
        logger.warn(`Protocol version negotiated: client requested ${clientVersion}, server will use ${negotiationResult.version}`, {
          reasoning: negotiationResult.reasoning
        });
      }
      
      const response = {
        protocolVersion: negotiationResult.version,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'n8n-documentation-mcp',
          version: PROJECT_VERSION,
        },
      };
      
      logger.info('MCP Initialize response', { response });
      return response;
    });

    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      // Combine documentation tools with management tools when API credentials are available
      let tools = [...n8nDocumentationToolsFinal];
      const hasApiConfig = isN8nApiConfigured() || !!(this.instanceContext?.n8nApiUrl && this.instanceContext?.n8nApiKey);
      if (hasApiConfig) {
        tools.push(...n8nManagementTools);
      }
      logger.debug(`Tool listing exposing ${tools.length} tools (management included: ${hasApiConfig})`);
      
      // Check if client is n8n (from initialization)
      const clientInfo = this.clientInfo;
      const isN8nClient = clientInfo?.name?.includes('n8n') || 
                         clientInfo?.name?.includes('langchain');
      
      if (isN8nClient) {
        logger.info('Detected n8n client, using n8n-friendly tool descriptions');
        tools = makeToolsN8nFriendly(tools);
      }
      
      // Log validation tools' input schemas for debugging
      const validationTools = tools.filter(t => t.name.startsWith('validate_'));
      validationTools.forEach(tool => {
        logger.info('Validation tool schema', {
          toolName: tool.name,
          inputSchema: JSON.stringify(tool.inputSchema, null, 2),
          hasOutputSchema: !!tool.outputSchema,
          description: tool.description
        });
      });
      
      return { tools };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      // Enhanced logging for debugging tool calls
      logger.info('Tool call received - DETAILED DEBUG', {
        toolName: name,
        arguments: JSON.stringify(args, null, 2),
        argumentsType: typeof args,
        argumentsKeys: args ? Object.keys(args) : [],
        hasNodeType: args && 'nodeType' in args,
        hasConfig: args && 'config' in args,
        configType: args && args.config ? typeof args.config : 'N/A',
        rawRequest: JSON.stringify(request.params)
      });
      
      // Workaround for n8n's nested output bug
      // Check if args contains nested 'output' structure from n8n's memory corruption
      let processedArgs = args;
      if (args && typeof args === 'object' && 'output' in args) {
        try {
          const possibleNestedData = args.output;
          // If output is a string that looks like JSON, try to parse it
          if (typeof possibleNestedData === 'string' && possibleNestedData.trim().startsWith('{')) {
            const parsed = JSON.parse(possibleNestedData);
            if (parsed && typeof parsed === 'object') {
              logger.warn('Detected n8n nested output bug, attempting to extract actual arguments', {
                originalArgs: args,
                extractedArgs: parsed
              });
              
              // Validate the extracted arguments match expected tool schema
              if (this.validateExtractedArgs(name, parsed)) {
                // Use the extracted data as args
                processedArgs = parsed;
              } else {
                logger.warn('Extracted arguments failed validation, using original args', {
                  toolName: name,
                  extractedArgs: parsed
                });
              }
            }
          }
        } catch (parseError) {
          logger.debug('Failed to parse nested output, continuing with original args', { 
            error: parseError instanceof Error ? parseError.message : String(parseError) 
          });
        }
      }
      
      try {
        logger.debug(`Executing tool: ${name}`, { args: processedArgs });
        const startTime = Date.now();
        const result = await this.executeTool(name, processedArgs);
        const duration = Date.now() - startTime;
        logger.debug(`Tool ${name} executed successfully`);

        // Update previous tool tracking
        this.previousTool = name;
        this.previousToolTimestamp = Date.now();
        
        // Ensure the result is properly formatted for MCP
        let responseText: string;
        let structuredContent: any = null;
        
        try {
          // For validation tools, check if we should use structured content
          if (name.startsWith('validate_') && typeof result === 'object' && result !== null) {
            // Clean up the result to ensure it matches the outputSchema
            const cleanResult = this.sanitizeValidationResult(result, name);
            structuredContent = cleanResult;
            responseText = JSON.stringify(cleanResult, null, 2);
          } else {
            responseText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          }
        } catch (jsonError) {
          logger.warn(`Failed to stringify tool result for ${name}:`, jsonError);
          responseText = String(result);
        }
        
        // Validate response size (n8n might have limits)
        if (responseText.length > 1000000) { // 1MB limit
          logger.warn(`Tool ${name} response is very large (${responseText.length} chars), truncating`);
          responseText = responseText.substring(0, 999000) + '\n\n[Response truncated due to size limits]';
          structuredContent = null; // Don't use structured content for truncated responses
        }
        
        // Build MCP response with strict schema compliance
        const mcpResponse: any = {
          content: [
            {
              type: 'text' as const,
              text: responseText,
            },
          ],
        };
        
        // For tools with outputSchema, structuredContent is REQUIRED by MCP spec
        if (name.startsWith('validate_') && structuredContent !== null) {
          mcpResponse.structuredContent = structuredContent;
        }
        
        return mcpResponse;
      } catch (error) {
        logger.error(`Error executing tool ${name}`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Update previous tool tracking (even for failed tools)
        this.previousTool = name;
        this.previousToolTimestamp = Date.now();

        // Provide more helpful error messages for common n8n issues
        let helpfulMessage = `Error executing tool ${name}: ${errorMessage}`;
        
        if (errorMessage.includes('required') || errorMessage.includes('missing')) {
          helpfulMessage += '\n\nNote: This error often occurs when the AI agent sends incomplete or incorrectly formatted parameters. Please ensure all required fields are provided with the correct types.';
        } else if (errorMessage.includes('type') || errorMessage.includes('expected')) {
          helpfulMessage += '\n\nNote: This error indicates a type mismatch. The AI agent may be sending data in the wrong format (e.g., string instead of object).';
        } else if (errorMessage.includes('Unknown category') || errorMessage.includes('not found')) {
          helpfulMessage += '\n\nNote: The requested resource or category was not found. Please check the available options.';
        }
        
        // For n8n schema errors, add specific guidance
        if (name.startsWith('validate_') && (errorMessage.includes('config') || errorMessage.includes('nodeType'))) {
          helpfulMessage += '\n\nFor validation tools:\n- nodeType should be a string (e.g., "nodes-base.webhook")\n- config should be an object (e.g., {})';
        }
        
        return {
          content: [
            {
              type: 'text',
              text: helpfulMessage,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Sanitize validation result to match outputSchema
   */
  private sanitizeValidationResult(result: any, toolName: string): any {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const sanitized = { ...result };

    // Ensure required fields exist with proper types and filter to schema-defined fields only
    if (toolName === 'validate_node_minimal') {
      // Filter to only schema-defined fields
      const filtered = {
        nodeType: String(sanitized.nodeType || ''),
        displayName: String(sanitized.displayName || ''),
        valid: Boolean(sanitized.valid),
        missingRequiredFields: Array.isArray(sanitized.missingRequiredFields) 
          ? sanitized.missingRequiredFields.map(String) 
          : []
      };
      return filtered;
    } else if (toolName === 'validate_node_operation') {
      // Ensure summary exists
      let summary = sanitized.summary;
      if (!summary || typeof summary !== 'object') {
        summary = {
          hasErrors: Array.isArray(sanitized.errors) ? sanitized.errors.length > 0 : false,
          errorCount: Array.isArray(sanitized.errors) ? sanitized.errors.length : 0,
          warningCount: Array.isArray(sanitized.warnings) ? sanitized.warnings.length : 0,
          suggestionCount: Array.isArray(sanitized.suggestions) ? sanitized.suggestions.length : 0
        };
      }
      
      // Filter to only schema-defined fields
      const filtered = {
        nodeType: String(sanitized.nodeType || ''),
        workflowNodeType: String(sanitized.workflowNodeType || sanitized.nodeType || ''),
        displayName: String(sanitized.displayName || ''),
        valid: Boolean(sanitized.valid),
        errors: Array.isArray(sanitized.errors) ? sanitized.errors : [],
        warnings: Array.isArray(sanitized.warnings) ? sanitized.warnings : [],
        suggestions: Array.isArray(sanitized.suggestions) ? sanitized.suggestions : [],
        summary: summary
      };
      return filtered;
    } else if (toolName.startsWith('validate_workflow')) {
      sanitized.valid = Boolean(sanitized.valid);
      
      // Ensure arrays exist
      sanitized.errors = Array.isArray(sanitized.errors) ? sanitized.errors : [];
      sanitized.warnings = Array.isArray(sanitized.warnings) ? sanitized.warnings : [];
      
      // Ensure statistics/summary exists
      if (toolName === 'validate_workflow') {
        if (!sanitized.summary || typeof sanitized.summary !== 'object') {
          sanitized.summary = {
            totalNodes: 0,
            enabledNodes: 0,
            triggerNodes: 0,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0,
            errorCount: sanitized.errors.length,
            warningCount: sanitized.warnings.length
          };
        }
      } else {
        if (!sanitized.statistics || typeof sanitized.statistics !== 'object') {
          sanitized.statistics = {
            totalNodes: 0,
            triggerNodes: 0,
            validConnections: 0,
            invalidConnections: 0,
            expressionsValidated: 0
          };
        }
      }
    }

    // Remove undefined values to ensure clean JSON
    return JSON.parse(JSON.stringify(sanitized));
  }

  /**
   * Enhanced parameter validation using schemas
   */
  private validateToolParams(toolName: string, args: any, legacyRequiredParams?: string[]): void {
    try {
      // If legacy required params are provided, use the new validation but fall back to basic if needed
      let validationResult;
      
      switch (toolName) {
        case 'validate_node_operation':
          validationResult = ToolValidation.validateNodeOperation(args);
          break;
        case 'validate_node_minimal':
          validationResult = ToolValidation.validateNodeMinimal(args);
          break;
        case 'validate_workflow':
        case 'validate_workflow_connections':
        case 'validate_workflow_expressions':
          validationResult = ToolValidation.validateWorkflow(args);
          break;
      case 'search_nodes':
        validationResult = ToolValidation.validateSearchNodes(args);
        break;
      case 'n8n_create_workflow':
        validationResult = ToolValidation.validateCreateWorkflow(args);
        break;
      case 'n8n_get_workflow':
      case 'n8n_get_workflow_details':
      case 'n8n_get_workflow_structure':
      case 'n8n_get_workflow_minimal':
      case 'n8n_update_full_workflow':
      case 'n8n_delete_workflow':
      case 'n8n_validate_workflow':
      case 'n8n_autofix_workflow':
      case 'n8n_get_execution':
      case 'n8n_delete_execution':
        validationResult = ToolValidation.validateWorkflowId(args);
        break;
      default:
        // For tools not yet migrated to schema validation, use basic validation
        return this.validateToolParamsBasic(toolName, args, legacyRequiredParams || []);
      }
      
      if (!validationResult.valid) {
        const errorMessage = Validator.formatErrors(validationResult, toolName);
        logger.error(`Parameter validation failed for ${toolName}:`, errorMessage);
        throw new ValidationError(errorMessage);
      }
    } catch (error) {
      // Handle validation errors properly
      if (error instanceof ValidationError) {
        throw error; // Re-throw validation errors as-is
      }
      
      // Handle unexpected errors from validation system
      logger.error(`Validation system error for ${toolName}:`, error);
      
      // Provide a user-friendly error message
      const errorMessage = error instanceof Error 
        ? `Internal validation error: ${error.message}`
        : `Internal validation error while processing ${toolName}`;
      
      throw new Error(errorMessage);
    }
  }
  
  /**
   * Legacy parameter validation (fallback)
   */
  private validateToolParamsBasic(toolName: string, args: any, requiredParams: string[]): void {
    const missing: string[] = [];
    
    for (const param of requiredParams) {
      if (!(param in args) || args[param] === undefined || args[param] === null) {
        missing.push(param);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(`Missing required parameters for ${toolName}: ${missing.join(', ')}. Please provide the required parameters to use this tool.`);
    }
  }

  /**
   * Validate extracted arguments match expected tool schema
   */
  private validateExtractedArgs(toolName: string, args: any): boolean {
    if (!args || typeof args !== 'object') {
      return false;
    }

    // Get all available tools
    const allTools = [...n8nDocumentationToolsFinal, ...n8nManagementTools];
    const tool = allTools.find(t => t.name === toolName);
    if (!tool || !tool.inputSchema) {
      return true; // If no schema, assume valid
    }

    const schema = tool.inputSchema;
    const required = schema.required || [];
    const properties = schema.properties || {};

    // Check all required fields are present
    for (const requiredField of required) {
      if (!(requiredField in args)) {
        logger.debug(`Extracted args missing required field: ${requiredField}`, {
          toolName,
          extractedArgs: args,
          required
        });
        return false;
      }
    }

    // Check field types match schema
    for (const [fieldName, fieldValue] of Object.entries(args)) {
      if (properties[fieldName]) {
        const expectedType = properties[fieldName].type;
        const actualType = Array.isArray(fieldValue) ? 'array' : typeof fieldValue;

        // Basic type validation
        if (expectedType && expectedType !== actualType) {
          // Special case: number can be coerced from string
          if (expectedType === 'number' && actualType === 'string' && !isNaN(Number(fieldValue))) {
            continue;
          }
          
          logger.debug(`Extracted args field type mismatch: ${fieldName}`, {
            toolName,
            expectedType,
            actualType,
            fieldValue
          });
          return false;
        }
      }
    }

    // Check for extraneous fields if additionalProperties is false
    if (schema.additionalProperties === false) {
      const allowedFields = Object.keys(properties);
      const extraFields = Object.keys(args).filter(field => !allowedFields.includes(field));
      
      if (extraFields.length > 0) {
        logger.debug(`Extracted args have extra fields`, {
          toolName,
          extraFields,
          allowedFields
        });
        // For n8n compatibility, we'll still consider this valid but log it
      }
    }

    return true;
  }

  async executeTool(name: string, args: any): Promise<any> {
    // Ensure args is an object and validate it
    args = args || {};
    
    // Log the tool call for debugging n8n issues
    logger.info(`Tool execution: ${name}`, { 
      args: typeof args === 'object' ? JSON.stringify(args) : args,
      argsType: typeof args,
      argsKeys: typeof args === 'object' ? Object.keys(args) : 'not-object'
    });
    
    // Validate that args is actually an object
    if (typeof args !== 'object' || args === null) {
      throw new Error(`Invalid arguments for tool ${name}: expected object, got ${typeof args}`);
    }
    
    switch (name) {
      case 'tools_documentation':
        // No required parameters
        return this.getToolsDocumentation(args.topic, args.depth);
      case 'list_nodes':
        // No required parameters
        return this.listNodes(args);
      case 'get_node_info':
        this.validateToolParams(name, args, ['nodeType']);
        return this.getNodeInfo(args.nodeType);
      case 'search_nodes':
        this.validateToolParams(name, args, ['query']);
        // Convert limit to number if provided, otherwise use default
        const limit = args.limit !== undefined ? Number(args.limit) || 20 : 20;
        return this.searchNodes(args.query, limit, { mode: args.mode });
      case 'list_ai_tools':
        // No required parameters
        return this.listAITools();
      case 'get_node_documentation':
        this.validateToolParams(name, args, ['nodeType']);
        return this.getNodeDocumentation(args.nodeType);
      case 'get_database_statistics':
        // No required parameters
        return this.getDatabaseStatistics();
      case 'get_node_essentials':
        this.validateToolParams(name, args, ['nodeType']);
        return this.getNodeEssentials(args.nodeType);
      case 'search_node_properties':
        this.validateToolParams(name, args, ['nodeType', 'query']);
        const maxResults = args.maxResults !== undefined ? Number(args.maxResults) || 20 : 20;
        return this.searchNodeProperties(args.nodeType, args.query, maxResults);
      case 'validate_node_operation':
        this.validateToolParams(name, args, ['nodeType', 'config']);
        // Ensure config is an object
        if (typeof args.config !== 'object' || args.config === null) {
          logger.warn(`validate_node_operation called with invalid config type: ${typeof args.config}`);
          return {
            nodeType: args.nodeType || 'unknown',
            workflowNodeType: args.nodeType || 'unknown',
            displayName: 'Unknown Node',
            valid: false,
            errors: [{
              type: 'config',
              property: 'config',
              message: 'Invalid config format - expected object',
              fix: 'Provide config as an object with node properties'
            }],
            warnings: [],
            suggestions: [
              '🔧 RECOVERY: Invalid config detected. Fix with:',
              '   • Ensure config is an object: { "resource": "...", "operation": "..." }',
              '   • Use get_node_essentials to see required fields for this node type',
              '   • Check if the node type is correct before configuring it'
            ],
            summary: {
              hasErrors: true,
              errorCount: 1,
              warningCount: 0,
              suggestionCount: 3
            }
          };
        }
        return this.validateNodeConfig(args.nodeType, args.config, 'operation', args.profile);
      case 'validate_node_minimal':
        this.validateToolParams(name, args, ['nodeType', 'config']);
        // Ensure config is an object
        if (typeof args.config !== 'object' || args.config === null) {
          logger.warn(`validate_node_minimal called with invalid config type: ${typeof args.config}`);
          return {
            nodeType: args.nodeType || 'unknown',
            displayName: 'Unknown Node',
            valid: false,
            missingRequiredFields: [
              'Invalid config format - expected object',
              '🔧 RECOVERY: Use format { "resource": "...", "operation": "..." } or {} for empty config'
            ]
          };
        }
        return this.validateNodeMinimal(args.nodeType, args.config);
      case 'get_property_dependencies':
        this.validateToolParams(name, args, ['nodeType']);
        return this.getPropertyDependencies(args.nodeType, args.config);
      case 'get_node_as_tool_info':
        this.validateToolParams(name, args, ['nodeType']);
        return this.getNodeAsToolInfo(args.nodeType);
      case 'validate_workflow':
        this.validateToolParams(name, args, ['workflow']);
        return this.validateWorkflow(args.workflow, args.options);
      case 'validate_workflow_connections':
        this.validateToolParams(name, args, ['workflow']);
        return this.validateWorkflowConnections(args.workflow);
      case 'validate_workflow_expressions':
        this.validateToolParams(name, args, ['workflow']);
        return this.validateWorkflowExpressions(args.workflow);
      
      // n8n Management Tools (if API is configured)
      case 'n8n_create_workflow':
        this.validateToolParams(name, args, ['market', 'name', 'nodes', 'connections']);
        return n8nHandlers.handleCreateWorkflow(args, this.instanceContext);
      case 'n8n_get_workflow':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleGetWorkflow(args, this.instanceContext);
      case 'n8n_get_workflow_details':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleGetWorkflowDetails(args, this.instanceContext);
      case 'n8n_get_workflow_structure':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleGetWorkflowStructure(args, this.instanceContext);
      case 'n8n_get_workflow_minimal':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleGetWorkflowMinimal(args, this.instanceContext);
      case 'n8n_update_full_workflow':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleUpdateWorkflow(args, this.instanceContext);
      case 'n8n_update_partial_workflow':
        this.validateToolParams(name, args, ['market', 'id', 'operations']);
        return handleUpdatePartialWorkflow(args, this.instanceContext);
      case 'n8n_delete_workflow':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleDeleteWorkflow(args, this.instanceContext);
      case 'n8n_list_workflows':
        this.validateToolParams(name, args, ['market']);
        return n8nHandlers.handleListWorkflows(args, this.instanceContext);
      case 'n8n_validate_workflow':
        this.validateToolParams(name, args, ['market', 'id']);
        await this.ensureInitialized();
        if (!this.repository) throw new Error('Repository not initialized');
        return n8nHandlers.handleValidateWorkflow(args, this.repository, this.instanceContext);
      case 'n8n_autofix_workflow':
        this.validateToolParams(name, args, ['market', 'id']);
        await this.ensureInitialized();
        if (!this.repository) throw new Error('Repository not initialized');
        return n8nHandlers.handleAutofixWorkflow(args, this.repository, this.instanceContext);
      case 'n8n_trigger_webhook_workflow':
        this.validateToolParams(name, args, ['market', 'webhookUrl']);
        return n8nHandlers.handleTriggerWebhookWorkflow(args, this.instanceContext);
      case 'n8n_get_execution':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleGetExecution(args, this.instanceContext);
      case 'n8n_list_executions':
        this.validateToolParams(name, args, ['market']);
        return n8nHandlers.handleListExecutions(args, this.instanceContext);
      case 'n8n_delete_execution':
        this.validateToolParams(name, args, ['market', 'id']);
        return n8nHandlers.handleDeleteExecution(args, this.instanceContext);
      case 'n8n_health_check':
        this.validateToolParams(name, args, ['market']);
        return n8nHandlers.handleHealthCheck(args, this.instanceContext);
      case 'n8n_list_available_tools':
        this.validateToolParams(name, args, ['market']);
        return n8nHandlers.handleListAvailableTools(args, this.instanceContext);
      case 'n8n_diagnostic':
        this.validateToolParams(name, args, ['market']);
        return n8nHandlers.handleDiagnostic({ params: { arguments: args } }, this.instanceContext);
        
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async listNodes(filters: any = {}): Promise<any> {
    await this.ensureInitialized();
    
    let query = 'SELECT * FROM nodes WHERE 1=1';
    const params: any[] = [];
    
    // console.log('DEBUG list_nodes:', { filters, query, params }); // Removed to prevent stdout interference

    if (filters.package) {
      // Handle both formats
      const packageVariants = [
        filters.package,
        `@n8n/${filters.package}`,
        filters.package.replace('@n8n/', '')
      ];
      query += ' AND package_name IN (' + packageVariants.map(() => '?').join(',') + ')';
      params.push(...packageVariants);
    }

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.developmentStyle) {
      query += ' AND development_style = ?';
      params.push(filters.developmentStyle);
    }

    if (filters.isAITool !== undefined) {
      query += ' AND is_ai_tool = ?';
      params.push(filters.isAITool ? 1 : 0);
    }

    query += ' ORDER BY display_name';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const nodes = this.db!.prepare(query).all(...params) as NodeRow[];
    
    return {
      nodes: nodes.map(node => ({
        nodeType: node.node_type,
        displayName: node.display_name,
        description: node.description,
        category: node.category,
        package: node.package_name,
        developmentStyle: node.development_style,
        isAITool: Number(node.is_ai_tool) === 1,
        isTrigger: Number(node.is_trigger) === 1,
        isVersioned: Number(node.is_versioned) === 1,
      })),
      totalCount: nodes.length,
    };
  }

  private async getNodeInfo(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // First try with normalized type (repository will also normalize internally)
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Add AI tool capabilities information with null safety
    const aiToolCapabilities = {
      canBeUsedAsTool: true, // Any node can be used as a tool in n8n
      hasUsableAsToolProperty: node.isAITool ?? false,
      requiresEnvironmentVariable: !(node.isAITool ?? false) && node.package !== 'n8n-nodes-base',
      toolConnectionType: 'ai_tool',
      commonToolUseCases: this.getCommonAIToolUseCases(node.nodeType),
      environmentRequirement: node.package && node.package !== 'n8n-nodes-base' ?
        'N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true' :
        null
    };

    // Process outputs to provide clear mapping with null safety
    let outputs = undefined;
    if (node.outputNames && Array.isArray(node.outputNames) && node.outputNames.length > 0) {
      outputs = node.outputNames.map((name: string, index: number) => {
        // Special handling for loop nodes like SplitInBatches
        const descriptions = this.getOutputDescriptions(node.nodeType, name, index);
        return {
          index,
          name,
          description: descriptions?.description ?? '',
          connectionGuidance: descriptions?.connectionGuidance ?? ''
        };
      });
    }

    return {
      ...node,
      workflowNodeType: getWorkflowNodeType(node.package ?? 'n8n-nodes-base', node.nodeType),
      aiToolCapabilities,
      outputs
    };
  }

  private async searchNodes(
    query: string,
    limit: number = 20,
    options?: {
      mode?: 'OR' | 'AND' | 'FUZZY';
      includeSource?: boolean;
    }
  ): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');
    
    // Normalize the query if it looks like a full node type
    let normalizedQuery = query;
    
    // Check if query contains node type patterns and normalize them
    if (query.includes('n8n-nodes-base.') || query.includes('@n8n/n8n-nodes-langchain.')) {
      normalizedQuery = query
        .replace(/n8n-nodes-base\./g, 'nodes-base.')
        .replace(/@n8n\/n8n-nodes-langchain\./g, 'nodes-langchain.');
    }
    
    const searchMode = options?.mode || 'OR';
    
    // Check if FTS5 table exists
    const ftsExists = this.db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='nodes_fts'
    `).get();
    
    if (ftsExists) {
      // Use FTS5 search with normalized query
      logger.debug('Using FTS5 search');
      return this.searchNodesFTS(normalizedQuery, limit, searchMode, options);
    } else {
      // Fallback to LIKE search with normalized query
      logger.debug('Using LIKE search (no FTS5)');
      return this.searchNodesLIKE(normalizedQuery, limit, options);
    }
  }

  private async searchNodesFTS(
    query: string,
    limit: number,
    mode: 'OR' | 'AND' | 'FUZZY',
    options?: { includeSource?: boolean; }
  ): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');

    // Clean and prepare the query
    const cleanedQuery = query.trim();
    if (!cleanedQuery) {
      return { query, results: [], totalCount: 0 };
    }
    
    // For FUZZY mode, use LIKE search with typo patterns
    if (mode === 'FUZZY') {
      return this.searchNodesFuzzy(cleanedQuery, limit);
    }
    
    let ftsQuery: string;
    
    // Handle exact phrase searches with quotes
    if (cleanedQuery.startsWith('"') && cleanedQuery.endsWith('"')) {
      // Keep exact phrase as is for FTS5
      ftsQuery = cleanedQuery;
    } else {
      // Split into words and handle based on mode
      const words = cleanedQuery.split(/\s+/).filter(w => w.length > 0);
      
      switch (mode) {
        case 'AND':
          // All words must be present
          ftsQuery = words.join(' AND ');
          break;
          
        case 'OR':
        default:
          // Any word can match (default)
          ftsQuery = words.join(' OR ');
          break;
      }
    }
    
    try {
      // Use FTS5 with ranking
      const nodes = this.db.prepare(`
        SELECT 
          n.*,
          rank
        FROM nodes n
        JOIN nodes_fts ON n.rowid = nodes_fts.rowid
        WHERE nodes_fts MATCH ?
        ORDER BY 
          rank,
          CASE 
            WHEN n.display_name = ? THEN 0
            WHEN n.display_name LIKE ? THEN 1
            WHEN n.node_type LIKE ? THEN 2
            ELSE 3
          END,
          n.display_name
        LIMIT ?
      `).all(ftsQuery, cleanedQuery, `%${cleanedQuery}%`, `%${cleanedQuery}%`, limit) as (NodeRow & { rank: number })[];
      
      // Apply additional relevance scoring for better results
      const scoredNodes = nodes.map(node => {
        const relevanceScore = this.calculateRelevanceScore(node, cleanedQuery);
        return { ...node, relevanceScore };
      });
      
      // Sort by combined score (FTS rank + relevance score)
      scoredNodes.sort((a, b) => {
        // Prioritize exact matches
        if (a.display_name.toLowerCase() === cleanedQuery.toLowerCase()) return -1;
        if (b.display_name.toLowerCase() === cleanedQuery.toLowerCase()) return 1;
        
        // Then by relevance score
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        
        // Then by FTS rank
        return a.rank - b.rank;
      });
      
      // If FTS didn't find key primary nodes, augment with LIKE search
      const hasHttpRequest = scoredNodes.some(n => n.node_type === 'nodes-base.httpRequest');
      if (cleanedQuery.toLowerCase().includes('http') && !hasHttpRequest) {
        // FTS missed HTTP Request, fall back to LIKE search
        logger.debug('FTS missed HTTP Request node, augmenting with LIKE search');
        return this.searchNodesLIKE(query, limit);
      }
      
      const result: any = {
        query,
        results: scoredNodes.map(node => ({
          nodeType: node.node_type,
          workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
          displayName: node.display_name,
          description: node.description,
          category: node.category,
          package: node.package_name,
          relevance: this.calculateRelevance(node, cleanedQuery)
        })),
        totalCount: scoredNodes.length
      };

      // Only include mode if it's not the default
      if (mode !== 'OR') {
        result.mode = mode;
      }

      return result;
      
    } catch (error: any) {
      // If FTS5 query fails, fallback to LIKE search
      logger.warn('FTS5 search failed, falling back to LIKE search:', error.message);
      
      // Special handling for syntax errors
      if (error.message.includes('syntax error') || error.message.includes('fts5')) {
        logger.warn(`FTS5 syntax error for query "${query}" in mode ${mode}`);
        
        // For problematic queries, use LIKE search with mode info
        const likeResult = await this.searchNodesLIKE(query, limit);

        return {
          ...likeResult,
          mode
        };
      }
      
      return this.searchNodesLIKE(query, limit);
    }
  }
  
  private async searchNodesFuzzy(query: string, limit: number): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Split into words for fuzzy matching
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    
    if (words.length === 0) {
      return { query, results: [], totalCount: 0, mode: 'FUZZY' };
    }
    
    // For fuzzy search, get ALL nodes to ensure we don't miss potential matches
    // We'll limit results after scoring
    const candidateNodes = this.db!.prepare(`
      SELECT * FROM nodes
    `).all() as NodeRow[];
    
    // Calculate fuzzy scores for candidate nodes
    const scoredNodes = candidateNodes.map(node => {
      const score = this.calculateFuzzyScore(node, query);
      return { node, score };
    });
    
    // Filter and sort by score
    const matchingNodes = scoredNodes
      .filter(item => item.score >= 200) // Lower threshold for better typo tolerance
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.node);
    
    // Debug logging
    if (matchingNodes.length === 0) {
      const topScores = scoredNodes
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      logger.debug(`FUZZY search for "${query}" - no matches above 400. Top scores:`, 
        topScores.map(s => ({ name: s.node.display_name, score: s.score })));
    }
    
    return {
      query,
      mode: 'FUZZY',
      results: matchingNodes.map(node => ({
        nodeType: node.node_type,
        workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
        displayName: node.display_name,
        description: node.description,
        category: node.category,
        package: node.package_name
      })),
      totalCount: matchingNodes.length
    };
  }
  
  private calculateFuzzyScore(node: NodeRow, query: string): number {
    const queryLower = query.toLowerCase();
    const displayNameLower = node.display_name.toLowerCase();
    const nodeTypeLower = node.node_type.toLowerCase();
    const nodeTypeClean = nodeTypeLower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
    
    // Exact match gets highest score
    if (displayNameLower === queryLower || nodeTypeClean === queryLower) {
      return 1000;
    }
    
    // Calculate edit distances for different parts
    const nameDistance = this.getEditDistance(queryLower, displayNameLower);
    const typeDistance = this.getEditDistance(queryLower, nodeTypeClean);
    
    // Also check individual words in the display name
    const nameWords = displayNameLower.split(/\s+/);
    let minWordDistance = Infinity;
    for (const word of nameWords) {
      const distance = this.getEditDistance(queryLower, word);
      if (distance < minWordDistance) {
        minWordDistance = distance;
      }
    }
    
    // Calculate best match score
    const bestDistance = Math.min(nameDistance, typeDistance, minWordDistance);
    
    // Use the length of the matched word for similarity calculation
    let matchedLen = queryLower.length;
    if (minWordDistance === bestDistance) {
      // Find which word matched best
      for (const word of nameWords) {
        if (this.getEditDistance(queryLower, word) === minWordDistance) {
          matchedLen = Math.max(queryLower.length, word.length);
          break;
        }
      }
    } else if (typeDistance === bestDistance) {
      matchedLen = Math.max(queryLower.length, nodeTypeClean.length);
    } else {
      matchedLen = Math.max(queryLower.length, displayNameLower.length);
    }
    
    const similarity = 1 - (bestDistance / matchedLen);
    
    // Boost if query is a substring
    if (displayNameLower.includes(queryLower) || nodeTypeClean.includes(queryLower)) {
      return 800 + (similarity * 100);
    }
    
    // Check if it's a prefix match
    if (displayNameLower.startsWith(queryLower) || 
        nodeTypeClean.startsWith(queryLower) ||
        nameWords.some(w => w.startsWith(queryLower))) {
      return 700 + (similarity * 100);
    }
    
    // Allow up to 1-2 character differences for typos
    if (bestDistance <= 2) {
      return 500 + ((2 - bestDistance) * 100) + (similarity * 50);
    }
    
    // Allow up to 3 character differences for longer words
    if (bestDistance <= 3 && queryLower.length >= 4) {
      return 400 + ((3 - bestDistance) * 50) + (similarity * 50);
    }
    
    // Base score on similarity
    return similarity * 300;
  }
  
  private getEditDistance(s1: string, s2: string): number {
    // Simple Levenshtein distance implementation
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (s1[i - 1] === s2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }
    
    return dp[m][n];
  }
  
  private async searchNodesLIKE(
    query: string,
    limit: number,
    options?: { includeSource?: boolean; }
  ): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');

    // This is the existing LIKE-based implementation
    // Handle exact phrase searches with quotes
    if (query.startsWith('"') && query.endsWith('"')) {
      const exactPhrase = query.slice(1, -1);
      const nodes = this.db!.prepare(`
        SELECT * FROM nodes
        WHERE node_type LIKE ? OR display_name LIKE ? OR description LIKE ?
        LIMIT ?
      `).all(`%${exactPhrase}%`, `%${exactPhrase}%`, `%${exactPhrase}%`, limit * 3) as NodeRow[];

      // Apply relevance ranking for exact phrase search
      const rankedNodes = this.rankSearchResults(nodes, exactPhrase, limit);

      const result: any = {
        query,
        results: rankedNodes.map(node => ({
          nodeType: node.node_type,
          workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
          displayName: node.display_name,
          description: node.description,
          category: node.category,
          package: node.package_name
        })),
        totalCount: rankedNodes.length
      };

      return result;
    }
    
    // Split into words for normal search
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    
    if (words.length === 0) {
      return { query, results: [], totalCount: 0 };
    }
    
    // Build conditions for each word
    const conditions = words.map(() => 
      '(node_type LIKE ? OR display_name LIKE ? OR description LIKE ?)'
    ).join(' OR ');
    
    const params: any[] = words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`]);
    // Fetch more results initially to ensure we get the best matches after ranking
    params.push(limit * 3);
    
    const nodes = this.db!.prepare(`
      SELECT DISTINCT * FROM nodes 
      WHERE ${conditions}
      LIMIT ?
    `).all(...params) as NodeRow[];
    
    // Apply relevance ranking
    const rankedNodes = this.rankSearchResults(nodes, query, limit);

    const result: any = {
      query,
      results: rankedNodes.map(node => ({
        nodeType: node.node_type,
        workflowNodeType: getWorkflowNodeType(node.package_name, node.node_type),
        displayName: node.display_name,
        description: node.description,
        category: node.category,
        package: node.package_name
      })),
      totalCount: rankedNodes.length
    };

    return result;
  }

  private calculateRelevance(node: NodeRow, query: string): string {
    const lowerQuery = query.toLowerCase();
    if (node.node_type.toLowerCase().includes(lowerQuery)) return 'high';
    if (node.display_name.toLowerCase().includes(lowerQuery)) return 'high';
    if (node.description?.toLowerCase().includes(lowerQuery)) return 'medium';
    return 'low';
  }
  
  private calculateRelevanceScore(node: NodeRow, query: string): number {
    const query_lower = query.toLowerCase();
    const name_lower = node.display_name.toLowerCase();
    const type_lower = node.node_type.toLowerCase();
    const type_without_prefix = type_lower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
    
    let score = 0;
    
    // Exact match in display name (highest priority)
    if (name_lower === query_lower) {
      score = 1000;
    }
    // Exact match in node type (without prefix)
    else if (type_without_prefix === query_lower) {
      score = 950;
    }
    // Special boost for common primary nodes
    else if (query_lower === 'webhook' && node.node_type === 'nodes-base.webhook') {
      score = 900;
    }
    else if ((query_lower === 'http' || query_lower === 'http request' || query_lower === 'http call') && node.node_type === 'nodes-base.httpRequest') {
      score = 900;
    }
    // Additional boost for multi-word queries matching primary nodes
    else if (query_lower.includes('http') && query_lower.includes('call') && node.node_type === 'nodes-base.httpRequest') {
      score = 890;
    }
    else if (query_lower.includes('http') && node.node_type === 'nodes-base.httpRequest') {
      score = 850;
    }
    // Boost for webhook queries
    else if (query_lower.includes('webhook') && node.node_type === 'nodes-base.webhook') {
      score = 850;
    }
    // Display name starts with query
    else if (name_lower.startsWith(query_lower)) {
      score = 800;
    }
    // Word boundary match in display name
    else if (new RegExp(`\\b${query_lower}\\b`, 'i').test(node.display_name)) {
      score = 700;
    }
    // Contains in display name
    else if (name_lower.includes(query_lower)) {
      score = 600;
    }
    // Type contains query (without prefix)
    else if (type_without_prefix.includes(query_lower)) {
      score = 500;
    }
    // Contains in description
    else if (node.description?.toLowerCase().includes(query_lower)) {
      score = 400;
    }
    
    return score;
  }

  private rankSearchResults(nodes: NodeRow[], query: string, limit: number): NodeRow[] {
    const query_lower = query.toLowerCase();
    
    // Calculate relevance scores for each node
    const scoredNodes = nodes.map(node => {
      const name_lower = node.display_name.toLowerCase();
      const type_lower = node.node_type.toLowerCase();
      const type_without_prefix = type_lower.replace(/^nodes-base\./, '').replace(/^nodes-langchain\./, '');
      
      let score = 0;
      
      // Exact match in display name (highest priority)
      if (name_lower === query_lower) {
        score = 1000;
      }
      // Exact match in node type (without prefix)
      else if (type_without_prefix === query_lower) {
        score = 950;
      }
      // Special boost for common primary nodes
      else if (query_lower === 'webhook' && node.node_type === 'nodes-base.webhook') {
        score = 900;
      }
      else if ((query_lower === 'http' || query_lower === 'http request' || query_lower === 'http call') && node.node_type === 'nodes-base.httpRequest') {
        score = 900;
      }
      // Boost for webhook queries
      else if (query_lower.includes('webhook') && node.node_type === 'nodes-base.webhook') {
        score = 850;
      }
      // Additional boost for http queries
      else if (query_lower.includes('http') && node.node_type === 'nodes-base.httpRequest') {
        score = 850;
      }
      // Display name starts with query
      else if (name_lower.startsWith(query_lower)) {
        score = 800;
      }
      // Word boundary match in display name
      else if (new RegExp(`\\b${query_lower}\\b`, 'i').test(node.display_name)) {
        score = 700;
      }
      // Contains in display name
      else if (name_lower.includes(query_lower)) {
        score = 600;
      }
      // Type contains query (without prefix)
      else if (type_without_prefix.includes(query_lower)) {
        score = 500;
      }
      // Contains in description
      else if (node.description?.toLowerCase().includes(query_lower)) {
        score = 400;
      }
      
      // For multi-word queries, check if all words are present
      const words = query_lower.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 1) {
        const allWordsInName = words.every(word => name_lower.includes(word));
        const allWordsInDesc = words.every(word => node.description?.toLowerCase().includes(word));
        
        if (allWordsInName) score += 200;
        else if (allWordsInDesc) score += 100;
        
        // Special handling for common multi-word queries
        if (query_lower === 'http call' && name_lower === 'http request') {
          score = 920; // Boost HTTP Request for "http call" query
        }
      }
      
      return { node, score };
    });
    
    // Sort by score (descending) and then by display name (ascending)
    scoredNodes.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.node.display_name.localeCompare(b.node.display_name);
    });
    
    // Return only the requested number of results
    return scoredNodes.slice(0, limit).map(item => item.node);
  }

  private async listAITools(): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    const tools = this.repository.getAITools();
    
    // Debug: Check if is_ai_tool column is populated
    const aiCount = this.db!.prepare('SELECT COUNT(*) as ai_count FROM nodes WHERE is_ai_tool = 1').get() as any;
    // console.log('DEBUG list_ai_tools:', { 
    //   toolsLength: tools.length, 
    //   aiCountInDB: aiCount.ai_count,
    //   sampleTools: tools.slice(0, 3)
    // }); // Removed to prevent stdout interference
    
    return {
      tools,
      totalCount: tools.length,
      requirements: {
        environmentVariable: 'N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true',
        nodeProperty: 'usableAsTool: true',
      },
      usage: {
        description: 'These nodes have the usableAsTool property set to true, making them optimized for AI agent usage.',
        note: 'ANY node in n8n can be used as an AI tool by connecting it to the ai_tool port of an AI Agent node.',
        examples: [
          'Regular nodes like Slack, Google Sheets, or HTTP Request can be used as tools',
          'Connect any node to an AI Agent\'s tool port to make it available for AI-driven automation',
          'Community nodes require the environment variable to be set'
        ]
      }
    };
  }

  private async getNodeDocumentation(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');

    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.db!.prepare(`
      SELECT node_type, display_name, documentation, description 
      FROM nodes 
      WHERE node_type = ?
    `).get(normalizedType) as NodeRow | undefined;
    
    // If not found and normalization changed the type, try original
    if (!node && normalizedType !== nodeType) {
      node = this.db!.prepare(`
        SELECT node_type, display_name, documentation, description 
        FROM nodes 
        WHERE node_type = ?
      `).get(nodeType) as NodeRow | undefined;
    }
    
    // If still not found, try alternatives
    if (!node) {
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        node = this.db!.prepare(`
          SELECT node_type, display_name, documentation, description 
          FROM nodes 
          WHERE node_type = ?
        `).get(alt) as NodeRow | undefined;
        
        if (node) break;
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // If no documentation, generate fallback with null safety
    if (!node.documentation) {
      const essentials = await this.getNodeEssentials(nodeType);

      return {
        nodeType: node.node_type,
        displayName: node.display_name || 'Unknown Node',
        documentation: `
# ${node.display_name || 'Unknown Node'}

${node.description || 'No description available.'}

## Common Properties

${essentials?.commonProperties?.length > 0 ?
  essentials.commonProperties.map((p: any) =>
    `### ${p.displayName || 'Property'}\n${p.description || `Type: ${p.type || 'unknown'}`}`
  ).join('\n\n') :
  'No common properties available.'}

## Note
Full documentation is being prepared. For now, use get_node_essentials for configuration help.
`,
        hasDocumentation: false
      };
    }

    return {
      nodeType: node.node_type,
      displayName: node.display_name || 'Unknown Node',
      documentation: node.documentation,
      hasDocumentation: true,
    };
  }

  private async getDatabaseStatistics(): Promise<any> {
    await this.ensureInitialized();
    if (!this.db) throw new Error('Database not initialized');
    const stats = this.db!.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(is_ai_tool) as ai_tools,
        SUM(is_trigger) as triggers,
        SUM(is_versioned) as versioned,
        SUM(CASE WHEN documentation IS NOT NULL THEN 1 ELSE 0 END) as with_docs,
        COUNT(DISTINCT package_name) as packages,
        COUNT(DISTINCT category) as categories
      FROM nodes
    `).get() as any;
    
    const packages = this.db!.prepare(`
      SELECT package_name, COUNT(*) as count 
      FROM nodes 
      GROUP BY package_name
    `).all() as any[];
        return {
      totalNodes: stats.total,
      statistics: {
        aiTools: stats.ai_tools,
        triggers: stats.triggers,
        versionedNodes: stats.versioned,
        nodesWithDocumentation: stats.with_docs,
        documentationCoverage: Math.round((stats.with_docs / stats.total) * 100) + '%',
        uniquePackages: stats.packages,
        uniqueCategories: stats.categories,
      },
      packageBreakdown: packages.map(pkg => ({
        package: pkg.package_name,
        nodeCount: pkg.count,
      })),
    };
  }

  private async getNodeEssentials(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Check cache first
    const cacheKey = `essentials:${nodeType}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    
    // Get the full node information
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties (already parsed by repository)
    const allProperties = node.properties || [];
    
    // Get essential properties
    const essentials = PropertyFilter.getEssentials(allProperties, node.nodeType);
    
    // Get operations (already parsed by repository)
    const operations = node.operations || [];
    
    const result = {
      nodeType: node.nodeType,
      workflowNodeType: getWorkflowNodeType(node.package ?? 'n8n-nodes-base', node.nodeType),
      displayName: node.displayName,
      description: node.description,
      category: node.category,
      version: node.version ?? '1',
      isVersioned: node.isVersioned ?? false,
      requiredProperties: essentials.required,
      commonProperties: essentials.common,
      operations: operations.map((op: any) => ({
        name: op.name || op.operation,
        description: op.description,
        action: op.action,
        resource: op.resource
      })),
      // Examples removed - use validate_node_operation for working configurations
      metadata: {
        totalProperties: allProperties.length,
        isAITool: node.isAITool ?? false,
        isTrigger: node.isTrigger ?? false,
        isWebhook: node.isWebhook ?? false,
        hasCredentials: node.credentials ? true : false,
        package: node.package ?? 'n8n-nodes-base',
        developmentStyle: node.developmentStyle ?? 'programmatic'
      }
    };

    // Cache for 1 hour
    this.cache.set(cacheKey, result, 3600);

    return result;
  }

  private async searchNodeProperties(nodeType: string, query: string, maxResults: number = 20): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get the node
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties and search (already parsed by repository)
    const allProperties = node.properties || [];
    const matches = PropertyFilter.searchProperties(allProperties, query, maxResults);
    
    return {
      nodeType: node.nodeType,
      query,
      matches: matches.map((match: any) => ({
        name: match.name,
        displayName: match.displayName,
        type: match.type,
        description: match.description,
        path: match.path || match.name,
        required: match.required,
        default: match.default,
        options: match.options,
        showWhen: match.showWhen
      })),
      totalMatches: matches.length,
      searchedIn: allProperties.length + ' properties'
    };
  }

  private getPropertyValue(config: any, path: string): any {
    const parts = path.split('.');
    let value = config;
    
    for (const part of parts) {
      // Handle array notation like parameters[0]
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        value = value?.[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
      } else {
        value = value?.[part];
      }
    }
    
    return value;
  }
  
  private async validateNodeConfig(
    nodeType: string, 
    config: Record<string, any>, 
    mode: ValidationMode = 'operation',
    profile: ValidationProfile = 'ai-friendly'
  ): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info to access properties
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);

    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }

    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties
    const properties = node.properties || [];
    
    // Use enhanced validator with operation mode by default
    const validationResult = EnhancedConfigValidator.validateWithMode(
      node.nodeType, 
      config, 
      properties, 
      mode,
      profile
    );
    
    // Add node context to result
    return {
      nodeType: node.nodeType,
      workflowNodeType: getWorkflowNodeType(node.package, node.nodeType),
      displayName: node.displayName,
      ...validationResult,
      summary: {
        hasErrors: !validationResult.valid,
        errorCount: validationResult.errors.length,
        warningCount: validationResult.warnings.length,
        suggestionCount: validationResult.suggestions.length
      }
    };
  }
  
  private async getPropertyDependencies(nodeType: string, config?: Record<string, any>): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info to access properties
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties
    const properties = node.properties || [];
    
    // Analyze dependencies
    const analysis = PropertyDependencies.analyze(properties);
    
    // If config provided, check visibility impact
    let visibilityImpact = null;
    if (config) {
      visibilityImpact = PropertyDependencies.getVisibilityImpact(properties, config);
    }
    
    return {
      nodeType: node.nodeType,
      displayName: node.displayName,
      ...analysis,
      currentConfig: config ? {
        providedValues: config,
        visibilityImpact
      } : undefined
    };
  }
  
  private async getNodeAsToolInfo(nodeType: string): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Determine common AI tool use cases based on node type
    const commonUseCases = this.getCommonAIToolUseCases(node.nodeType);
    
    // Build AI tool capabilities info
    const aiToolCapabilities = {
      canBeUsedAsTool: true, // In n8n, ANY node can be used as a tool when connected to AI Agent
      hasUsableAsToolProperty: node.isAITool,
      requiresEnvironmentVariable: !node.isAITool && node.package !== 'n8n-nodes-base',
      connectionType: 'ai_tool',
      commonUseCases,
      requirements: {
        connection: 'Connect to the "ai_tool" port of an AI Agent node',
        environment: node.package !== 'n8n-nodes-base' ? 
          'Set N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true for community nodes' : 
          'No special environment variables needed for built-in nodes'
      },
      examples: this.getAIToolExamples(node.nodeType),
      tips: [
        'Give the tool a clear, descriptive name in the AI Agent settings',
        'Write a detailed tool description to help the AI understand when to use it',
        'Test the node independently before connecting it as a tool',
        node.isAITool ? 
          'This node is optimized for AI tool usage' : 
          'This is a regular node that can be used as an AI tool'
      ]
    };
    
    return {
      nodeType: node.nodeType,
      workflowNodeType: getWorkflowNodeType(node.package, node.nodeType),
      displayName: node.displayName,
      description: node.description,
      package: node.package,
      isMarkedAsAITool: node.isAITool,
      aiToolCapabilities
    };
  }
  
  private getOutputDescriptions(nodeType: string, outputName: string, index: number): { description: string, connectionGuidance: string } {
    // Special handling for loop nodes
    if (nodeType === 'nodes-base.splitInBatches') {
      if (outputName === 'done' && index === 0) {
        return {
          description: 'Final processed data after all iterations complete',
          connectionGuidance: 'Connect to nodes that should run AFTER the loop completes'
        };
      } else if (outputName === 'loop' && index === 1) {
        return {
          description: 'Current batch data for this iteration',
          connectionGuidance: 'Connect to nodes that process items INSIDE the loop (and connect their output back to this node)'
        };
      }
    }
    
    // Special handling for IF node
    if (nodeType === 'nodes-base.if') {
      if (outputName === 'true' && index === 0) {
        return {
          description: 'Items that match the condition',
          connectionGuidance: 'Connect to nodes that handle the TRUE case'
        };
      } else if (outputName === 'false' && index === 1) {
        return {
          description: 'Items that do not match the condition',
          connectionGuidance: 'Connect to nodes that handle the FALSE case'
        };
      }
    }
    
    // Special handling for Switch node
    if (nodeType === 'nodes-base.switch') {
      return {
        description: `Output ${index}: ${outputName || 'Route ' + index}`,
        connectionGuidance: `Connect to nodes for the "${outputName || 'route ' + index}" case`
      };
    }
    
    // Default handling
    return {
      description: outputName || `Output ${index}`,
      connectionGuidance: `Connect to downstream nodes`
    };
  }

  private getCommonAIToolUseCases(nodeType: string): string[] {
    const useCaseMap: Record<string, string[]> = {
      'nodes-base.slack': [
        'Send notifications about task completion',
        'Post updates to channels',
        'Send direct messages',
        'Create alerts and reminders'
      ],
      'nodes-base.googleSheets': [
        'Read data for analysis',
        'Log results and outputs',
        'Update spreadsheet records',
        'Create reports'
      ],
      'nodes-base.gmail': [
        'Send email notifications',
        'Read and process emails',
        'Send reports and summaries',
        'Handle email-based workflows'
      ],
      'nodes-base.httpRequest': [
        'Call external APIs',
        'Fetch data from web services',
        'Send webhooks',
        'Integrate with any REST API'
      ],
      'nodes-base.postgres': [
        'Query database for information',
        'Store analysis results',
        'Update records based on AI decisions',
        'Generate reports from data'
      ],
      'nodes-base.webhook': [
        'Receive external triggers',
        'Create callback endpoints',
        'Handle incoming data',
        'Integrate with external systems'
      ]
    };
    
    // Check for partial matches
    for (const [key, useCases] of Object.entries(useCaseMap)) {
      if (nodeType.includes(key)) {
        return useCases;
      }
    }
    
    // Generic use cases for unknown nodes
    return [
      'Perform automated actions',
      'Integrate with external services',
      'Process and transform data',
      'Extend AI agent capabilities'
    ];
  }
  
  private getAIToolExamples(nodeType: string): any {
    const exampleMap: Record<string, any> = {
      'nodes-base.slack': {
        toolName: 'Send Slack Message',
        toolDescription: 'Sends a message to a specified Slack channel or user. Use this to notify team members about important events or results.',
        nodeConfig: {
          resource: 'message',
          operation: 'post',
          channel: '={{ $fromAI("channel", "The Slack channel to send to, e.g. #general") }}',
          text: '={{ $fromAI("message", "The message content to send") }}'
        }
      },
      'nodes-base.googleSheets': {
        toolName: 'Update Google Sheet',
        toolDescription: 'Reads or updates data in a Google Sheets spreadsheet. Use this to log information, retrieve data, or update records.',
        nodeConfig: {
          operation: 'append',
          sheetId: 'your-sheet-id',
          range: 'A:Z',
          dataMode: 'autoMap'
        }
      },
      'nodes-base.httpRequest': {
        toolName: 'Call API',
        toolDescription: 'Makes HTTP requests to external APIs. Use this to fetch data, trigger webhooks, or integrate with any web service.',
        nodeConfig: {
          method: '={{ $fromAI("method", "HTTP method: GET, POST, PUT, DELETE") }}',
          url: '={{ $fromAI("url", "The complete API endpoint URL") }}',
          sendBody: true,
          bodyContentType: 'json',
          jsonBody: '={{ $fromAI("body", "Request body as JSON object") }}'
        }
      }
    };
    
    // Check for exact match or partial match
    for (const [key, example] of Object.entries(exampleMap)) {
      if (nodeType.includes(key)) {
        return example;
      }
    }
    
    // Generic example
    return {
      toolName: 'Custom Tool',
      toolDescription: 'Performs specific operations. Describe what this tool does and when to use it.',
      nodeConfig: {
        note: 'Configure the node based on its specific requirements'
      }
    };
  }
  
  private async validateNodeMinimal(nodeType: string, config: Record<string, any>): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');

    // Get node info
    // First try with normalized type
    const normalizedType = NodeTypeNormalizer.normalizeToFullForm(nodeType);
    let node = this.repository.getNode(normalizedType);
    
    if (!node && normalizedType !== nodeType) {
      // Try original if normalization changed it
      node = this.repository.getNode(nodeType);
    }
    
    if (!node) {
      // Fallback to other alternatives for edge cases
      const alternatives = getNodeTypeAlternatives(normalizedType);
      
      for (const alt of alternatives) {
        const found = this.repository!.getNode(alt);
        if (found) {
          node = found;
          break;
        }
      }
    }
    
    if (!node) {
      throw new Error(`Node ${nodeType} not found`);
    }
    
    // Get properties  
    const properties = node.properties || [];
    
    // Extract operation context (safely handle undefined config properties)
    const operationContext = {
      resource: config?.resource,
      operation: config?.operation,
      action: config?.action,
      mode: config?.mode
    };
    
    // Find missing required fields
    const missingFields: string[] = [];
    
    for (const prop of properties) {
      // Skip if not required
      if (!prop.required) continue;
      
      // Skip if not visible based on current config
      if (prop.displayOptions) {
        let isVisible = true;
        
        // Check show conditions
        if (prop.displayOptions.show) {
          for (const [key, values] of Object.entries(prop.displayOptions.show)) {
            const configValue = config?.[key];
            const expectedValues = Array.isArray(values) ? values : [values];
            
            if (!expectedValues.includes(configValue)) {
              isVisible = false;
              break;
            }
          }
        }
        
        // Check hide conditions
        if (isVisible && prop.displayOptions.hide) {
          for (const [key, values] of Object.entries(prop.displayOptions.hide)) {
            const configValue = config?.[key];
            const expectedValues = Array.isArray(values) ? values : [values];
            
            if (expectedValues.includes(configValue)) {
              isVisible = false;
              break;
            }
          }
        }
        
        if (!isVisible) continue;
      }
      
      // Check if field is missing (safely handle null/undefined config)
      if (!config || !(prop.name in config)) {
        missingFields.push(prop.displayName || prop.name);
      }
    }
    
    return {
      nodeType: node.nodeType,
      displayName: node.displayName,
      valid: missingFields.length === 0,
      missingRequiredFields: missingFields
    };
  }

  private async getToolsDocumentation(topic?: string, depth: 'essentials' | 'full' = 'essentials'): Promise<string> {
    if (!topic || topic === 'overview') {
      return getToolsOverview(depth);
    }
    
    return getToolDocumentation(topic, depth);
  }

  // Add connect method to accept any transport
  async connect(transport: any): Promise<void> {
    await this.ensureInitialized();
    await this.server.connect(transport);
    logger.info('MCP Server connected', { 
      transportType: transport.constructor.name 
    });
  }
  
  private async validateWorkflow(workflow: any, options?: any): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    
    // Enhanced logging for workflow validation
    logger.info('Workflow validation requested', {
      hasWorkflow: !!workflow,
      workflowType: typeof workflow,
      hasNodes: workflow?.nodes !== undefined,
      nodesType: workflow?.nodes ? typeof workflow.nodes : 'undefined',
      nodesIsArray: Array.isArray(workflow?.nodes),
      nodesCount: Array.isArray(workflow?.nodes) ? workflow.nodes.length : 0,
      hasConnections: workflow?.connections !== undefined,
      connectionsType: workflow?.connections ? typeof workflow.connections : 'undefined',
      options: options
    });
    
    // Help n8n AI agents with common mistakes
    if (!workflow || typeof workflow !== 'object') {
      return {
        valid: false,
        errors: [{
          node: 'workflow',
          message: 'Workflow must be an object with nodes and connections',
          details: 'Expected format: ' + getWorkflowExampleString()
        }],
        summary: { errorCount: 1 }
      };
    }
    
    if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
      return {
        valid: false,
        errors: [{
          node: 'workflow',
          message: 'Workflow must have a nodes array',
          details: 'Expected: workflow.nodes = [array of node objects]. ' + getWorkflowExampleString()
        }],
        summary: { errorCount: 1 }
      };
    }
    
    if (!workflow.connections || typeof workflow.connections !== 'object') {
      return {
        valid: false,
        errors: [{
          node: 'workflow',
          message: 'Workflow must have a connections object',
          details: 'Expected: workflow.connections = {} (can be empty object). ' + getWorkflowExampleString()
        }],
        summary: { errorCount: 1 }
      };
    }
    
    // Create workflow validator instance
    const validator = new WorkflowValidator(
      this.repository,
      EnhancedConfigValidator
    );
    
    try {
      const result = await validator.validateWorkflow(workflow, options);
      
      // Format the response for better readability
      const response: any = {
        valid: result.valid,
        summary: {
          totalNodes: result.statistics.totalNodes,
          enabledNodes: result.statistics.enabledNodes,
          triggerNodes: result.statistics.triggerNodes,
          validConnections: result.statistics.validConnections,
          invalidConnections: result.statistics.invalidConnections,
          expressionsValidated: result.statistics.expressionsValidated,
          errorCount: result.errors.length,
          warningCount: result.warnings.length
        },
        // Always include errors and warnings arrays for consistent API response
        errors: result.errors.map(e => ({
          node: e.nodeName || 'workflow',
          message: e.message,
          details: e.details
        })),
        warnings: result.warnings.map(w => ({
          node: w.nodeName || 'workflow',
          message: w.message,
          details: w.details
        }))
      };
      
      if (result.suggestions.length > 0) {
        response.suggestions = result.suggestions;
      }

      return response;
    } catch (error) {
      logger.error('Error validating workflow:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error validating workflow',
        tip: 'Ensure the workflow JSON includes nodes array and connections object'
      };
    }
  }

  private async validateWorkflowConnections(workflow: any): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    
    // Create workflow validator instance
    const validator = new WorkflowValidator(
      this.repository,
      EnhancedConfigValidator
    );
    
    try {
      // Validate only connections
      const result = await validator.validateWorkflow(workflow, {
        validateNodes: false,
        validateConnections: true,
        validateExpressions: false
      });
      
      const response: any = {
        valid: result.errors.length === 0,
        statistics: {
          totalNodes: result.statistics.totalNodes,
          triggerNodes: result.statistics.triggerNodes,
          validConnections: result.statistics.validConnections,
          invalidConnections: result.statistics.invalidConnections
        }
      };
      
      // Filter to only connection-related issues
      const connectionErrors = result.errors.filter(e => 
        e.message.includes('connection') || 
        e.message.includes('cycle') ||
        e.message.includes('orphaned')
      );
      
      const connectionWarnings = result.warnings.filter(w => 
        w.message.includes('connection') || 
        w.message.includes('orphaned') ||
        w.message.includes('trigger')
      );
      
      if (connectionErrors.length > 0) {
        response.errors = connectionErrors.map(e => ({
          node: e.nodeName || 'workflow',
          message: e.message
        }));
      }
      
      if (connectionWarnings.length > 0) {
        response.warnings = connectionWarnings.map(w => ({
          node: w.nodeName || 'workflow',
          message: w.message
        }));
      }
      
      return response;
    } catch (error) {
      logger.error('Error validating workflow connections:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error validating connections'
      };
    }
  }

  private async validateWorkflowExpressions(workflow: any): Promise<any> {
    await this.ensureInitialized();
    if (!this.repository) throw new Error('Repository not initialized');
    
    // Create workflow validator instance
    const validator = new WorkflowValidator(
      this.repository,
      EnhancedConfigValidator
    );
    
    try {
      // Validate only expressions
      const result = await validator.validateWorkflow(workflow, {
        validateNodes: false,
        validateConnections: false,
        validateExpressions: true
      });
      
      const response: any = {
        valid: result.errors.length === 0,
        statistics: {
          totalNodes: result.statistics.totalNodes,
          expressionsValidated: result.statistics.expressionsValidated
        }
      };
      
      // Filter to only expression-related issues
      const expressionErrors = result.errors.filter(e => 
        e.message.includes('Expression') || 
        e.message.includes('$') ||
        e.message.includes('{{')
      );
      
      const expressionWarnings = result.warnings.filter(w => 
        w.message.includes('Expression') || 
        w.message.includes('$') ||
        w.message.includes('{{')
      );
      
      if (expressionErrors.length > 0) {
        response.errors = expressionErrors.map(e => ({
          node: e.nodeName || 'workflow',
          message: e.message
        }));
      }
      
      if (expressionWarnings.length > 0) {
        response.warnings = expressionWarnings.map(w => ({
          node: w.nodeName || 'workflow',
          message: w.message
        }));
      }
      
      // Add tips for common expression issues
      if (expressionErrors.length > 0 || expressionWarnings.length > 0) {
        response.tips = [
          'Use {{ }} to wrap expressions',
          'Reference data with $json.propertyName',
          'Reference other nodes with $node["Node Name"].json',
          'Use $input.item for input data in loops'
        ];
      }
      
      return response;
    } catch (error) {
      logger.error('Error validating workflow expressions:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error validating expressions'
      };
    }
  }

  async run(): Promise<void> {
    // Ensure database is initialized before starting server
    await this.ensureInitialized();
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    // Force flush stdout for Docker environments
    // Docker uses block buffering which can delay MCP responses
    if (!process.stdout.isTTY || process.env.IS_DOCKER) {
      // Override write to auto-flush
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = function(chunk: any, encoding?: any, callback?: any) {
        const result = originalWrite(chunk, encoding, callback);
        // Force immediate flush
        process.stdout.emit('drain');
        return result;
      };
    }
    
    logger.info('n8n Documentation MCP Server running on stdio transport');
    
    // Keep the process alive and listening
    process.stdin.resume();
  }
  
  async shutdown(): Promise<void> {
    logger.info('Shutting down MCP server...');
    
    // Clean up cache timers to prevent memory leaks
    if (this.cache) {
      try {
        this.cache.destroy();
        logger.info('Cache timers cleaned up');
      } catch (error) {
        logger.error('Error cleaning up cache:', error);
      }
    }
    
    // Close database connection if it exists
    if (this.db) {
      try {
        await this.db.close();
        logger.info('Database connection closed');
      } catch (error) {
        logger.error('Error closing database:', error);
      }
    }
  }
}
