/**
 * Enhanced Configuration Validator Service
 * 
 * Provides operation-aware validation for n8n nodes with reduced false positives.
 * Supports multiple validation modes and node-specific logic.
 */

import { ConfigValidator, ValidationResult, ValidationError, ValidationWarning } from './config-validator';
import { NodeSpecificValidators, NodeValidationContext } from './node-specific-validators';
import { FixedCollectionValidator } from '../utils/fixed-collection-validator';
import { OperationSimilarityService } from './operation-similarity-service';
import { ResourceSimilarityService } from './resource-similarity-service';
import { NodeRepository } from '../database/node-repository';
import { DatabaseAdapter } from '../database/database-adapter';
import { NodeTypeNormalizer } from '../utils/node-type-normalizer';

export type ValidationMode = 'full' | 'operation' | 'minimal';
export type ValidationProfile = 'strict' | 'runtime' | 'ai-friendly' | 'minimal';

export interface EnhancedValidationResult extends ValidationResult {
  mode: ValidationMode;
  profile?: ValidationProfile;
  operation?: {
    resource?: string;
    operation?: string;
    action?: string;
  };
  examples?: Array<{
    description: string;
    config: Record<string, any>;
  }>;
  nextSteps?: string[];
}

export interface OperationContext {
  resource?: string;
  operation?: string;
  action?: string;
  mode?: string;
}

export class EnhancedConfigValidator extends ConfigValidator {
  private static operationSimilarityService: OperationSimilarityService | null = null;
  private static resourceSimilarityService: ResourceSimilarityService | null = null;
  private static nodeRepository: NodeRepository | null = null;

  /**
   * Initialize similarity services (called once at startup)
   */
  static initializeSimilarityServices(repository: NodeRepository): void {
    this.nodeRepository = repository;
    this.operationSimilarityService = new OperationSimilarityService(repository);
    this.resourceSimilarityService = new ResourceSimilarityService(repository);
  }
  /**
   * Validate with operation awareness
   */
  static validateWithMode(
    nodeType: string,
    config: Record<string, any>,
    properties: any[],
    mode: ValidationMode = 'operation',
    profile: ValidationProfile = 'ai-friendly'
  ): EnhancedValidationResult {
    // Input validation - ensure parameters are valid
    if (typeof nodeType !== 'string') {
      throw new Error(`Invalid nodeType: expected string, got ${typeof nodeType}`);
    }
    
    if (!config || typeof config !== 'object') {
      throw new Error(`Invalid config: expected object, got ${typeof config}`);
    }
    
    if (!Array.isArray(properties)) {
      throw new Error(`Invalid properties: expected array, got ${typeof properties}`);
    }
    
    // Extract operation context from config
    const operationContext = this.extractOperationContext(config);

    // Filter properties based on mode and operation, and get config with defaults
    const { properties: filteredProperties, configWithDefaults } = this.filterPropertiesByMode(
      properties,
      config,
      mode,
      operationContext
    );

    // Perform base validation on filtered properties with defaults applied
    const baseResult = super.validate(nodeType, configWithDefaults, filteredProperties);
    
    // Enhance the result
    const enhancedResult: EnhancedValidationResult = {
      ...baseResult,
      mode,
      profile,
      operation: operationContext,
      examples: [],
      nextSteps: [],
      // Ensure arrays are initialized (in case baseResult doesn't have them)
      errors: baseResult.errors || [],
      warnings: baseResult.warnings || [],
      suggestions: baseResult.suggestions || []
    };
    
    // Apply profile-based filtering
    this.applyProfileFilters(enhancedResult, profile);
    
    // Add operation-specific enhancements
    this.addOperationSpecificEnhancements(nodeType, config, enhancedResult);
    
    // Deduplicate errors
    enhancedResult.errors = this.deduplicateErrors(enhancedResult.errors);
    
    // Examples removed - use validate_node_operation for configuration guidance
    
    // Generate next steps based on errors
    enhancedResult.nextSteps = this.generateNextSteps(enhancedResult);
    
    // Recalculate validity after all enhancements (crucial for fixedCollection validation)
    enhancedResult.valid = enhancedResult.errors.length === 0;
    
    return enhancedResult;
  }
  
  /**
   * Extract operation context from configuration
   */
  private static extractOperationContext(config: Record<string, any>): OperationContext {
    return {
      resource: config.resource,
      operation: config.operation,
      action: config.action,
      mode: config.mode
    };
  }
  
  /**
   * Filter properties based on validation mode and operation
   * Returns both filtered properties and config with defaults
   */
  private static filterPropertiesByMode(
    properties: any[],
    config: Record<string, any>,
    mode: ValidationMode,
    operation: OperationContext
  ): { properties: any[], configWithDefaults: Record<string, any> } {
    // Apply defaults for visibility checking
    const configWithDefaults = this.applyNodeDefaults(properties, config);

    let filteredProperties: any[];
    switch (mode) {
      case 'minimal':
        // Only required properties that are visible
        filteredProperties = properties.filter(prop =>
          prop.required && this.isPropertyVisible(prop, configWithDefaults)
        );
        break;

      case 'operation':
        // Only properties relevant to the current operation
        filteredProperties = properties.filter(prop =>
          this.isPropertyRelevantToOperation(prop, configWithDefaults, operation)
        );
        break;

      case 'full':
      default:
        // All properties (current behavior)
        filteredProperties = properties;
        break;
    }

    return { properties: filteredProperties, configWithDefaults };
  }

  /**
   * Apply node defaults to configuration for accurate visibility checking
   */
  private static applyNodeDefaults(properties: any[], config: Record<string, any>): Record<string, any> {
    const result = { ...config };

    for (const prop of properties) {
      if (prop.name && prop.default !== undefined && result[prop.name] === undefined) {
        result[prop.name] = prop.default;
      }
    }

    return result;
  }
  
  /**
   * Check if property is relevant to current operation
   */
  private static isPropertyRelevantToOperation(
    prop: any,
    config: Record<string, any>,
    operation: OperationContext
  ): boolean {
    // First check if visible
    if (!this.isPropertyVisible(prop, config)) {
      return false;
    }
    
    // If no operation context, include all visible
    if (!operation.resource && !operation.operation && !operation.action) {
      return true;
    }
    
    // Check if property has operation-specific display options
    if (prop.displayOptions?.show) {
      const show = prop.displayOptions.show;
      
      // Check each operation field
      if (operation.resource && show.resource) {
        const expectedResources = Array.isArray(show.resource) ? show.resource : [show.resource];
        if (!expectedResources.includes(operation.resource)) {
          return false;
        }
      }
      
      if (operation.operation && show.operation) {
        const expectedOps = Array.isArray(show.operation) ? show.operation : [show.operation];
        if (!expectedOps.includes(operation.operation)) {
          return false;
        }
      }
      
      if (operation.action && show.action) {
        const expectedActions = Array.isArray(show.action) ? show.action : [show.action];
        if (!expectedActions.includes(operation.action)) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Add operation-specific enhancements to validation result
   */
  private static addOperationSpecificEnhancements(
    nodeType: string,
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    // Type safety check - this should never happen with proper validation
    if (typeof nodeType !== 'string') {
      result.errors.push({
        type: 'invalid_type',
        property: 'nodeType',
        message: `Invalid nodeType: expected string, got ${typeof nodeType}`,
        fix: 'Provide a valid node type string (e.g., "nodes-base.webhook")'
      });
      return;
    }

    // Validate resource and operation using similarity services
    this.validateResourceAndOperation(nodeType, config, result);

    // First, validate fixedCollection properties for known problematic nodes
    this.validateFixedCollectionStructures(nodeType, config, result);
    
    // Create context for node-specific validators
    const context: NodeValidationContext = {
      config,
      errors: result.errors,
      warnings: result.warnings,
      suggestions: result.suggestions,
      autofix: result.autofix || {}
    };
    
    // Normalize node type (handle both 'n8n-nodes-base.x' and 'nodes-base.x' formats)
    const normalizedNodeType = nodeType.replace('n8n-nodes-base.', 'nodes-base.');
    
    // Use node-specific validators
    switch (normalizedNodeType) {
      case 'nodes-base.slack':
        NodeSpecificValidators.validateSlack(context);
        this.enhanceSlackValidation(config, result);
        break;
        
      case 'nodes-base.googleSheets':
        NodeSpecificValidators.validateGoogleSheets(context);
        this.enhanceGoogleSheetsValidation(config, result);
        break;
        
      case 'nodes-base.httpRequest':
        // Use existing HTTP validation from base class
        this.enhanceHttpRequestValidation(config, result);
        break;
        
      case 'nodes-base.code':
        NodeSpecificValidators.validateCode(context);
        break;
        
      case 'nodes-base.openAi':
        NodeSpecificValidators.validateOpenAI(context);
        break;
        
      case 'nodes-base.mongoDb':
        NodeSpecificValidators.validateMongoDB(context);
        break;
        
      case 'nodes-base.webhook':
        NodeSpecificValidators.validateWebhook(context);
        break;
        
      case 'nodes-base.postgres':
        NodeSpecificValidators.validatePostgres(context);
        break;
        
      case 'nodes-base.mysql':
        NodeSpecificValidators.validateMySQL(context);
        break;
        
      case 'nodes-base.switch':
        this.validateSwitchNodeStructure(config, result);
        break;
        
      case 'nodes-base.if':
        this.validateIfNodeStructure(config, result);
        break;
        
      case 'nodes-base.filter':
        this.validateFilterNodeStructure(config, result);
        break;
        
      // Additional nodes handled by FixedCollectionValidator
      // No need for specific validators as the generic utility handles them
    }
    
    // Update autofix if changes were made
    if (Object.keys(context.autofix).length > 0) {
      result.autofix = context.autofix;
    }
  }
  
  /**
   * Enhanced Slack validation with operation awareness
   */
  private static enhanceSlackValidation(
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    const { resource, operation } = result.operation || {};
    
    if (resource === 'message' && operation === 'send') {
      // Examples removed - validation focuses on error detection
      
      // Check for common issues
      if (!config.channel && !config.channelId) {
        const channelError = result.errors.find(e => 
          e.property === 'channel' || e.property === 'channelId'
        );
        if (channelError) {
          channelError.message = 'To send a Slack message, specify either a channel name (e.g., "#general") or channel ID';
          channelError.fix = 'Add channel: "#general" or use a channel ID like "C1234567890"';
        }
      }
    }
  }
  
  /**
   * Enhanced Google Sheets validation
   */
  private static enhanceGoogleSheetsValidation(
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    const { operation } = result.operation || {};
    
    if (operation === 'append') {
      // Examples removed - validation focuses on configuration correctness
      
      // Validate range format
      if (config.range && !config.range.includes('!')) {
        result.warnings.push({
          type: 'inefficient',
          property: 'range',
          message: 'Range should include sheet name (e.g., "Sheet1!A:B")',
          suggestion: 'Format: "SheetName!A1:B10" or "SheetName!A:B" for entire columns'
        });
      }
    }
  }
  
  /**
   * Enhanced HTTP Request validation
   */
  private static enhanceHttpRequestValidation(
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    // Examples removed - validation provides error messages and fixes instead
  }
  
  /**
   * Generate actionable next steps based on validation results
   */
  private static generateNextSteps(result: EnhancedValidationResult): string[] {
    const steps: string[] = [];
    
    // Group errors by type
    const requiredErrors = result.errors.filter(e => e.type === 'missing_required');
    const typeErrors = result.errors.filter(e => e.type === 'invalid_type');
    const valueErrors = result.errors.filter(e => e.type === 'invalid_value');
    
    if (requiredErrors.length > 0) {
      steps.push(`Add required fields: ${requiredErrors.map(e => e.property).join(', ')}`);
    }
    
    if (typeErrors.length > 0) {
      steps.push(`Fix type mismatches: ${typeErrors.map(e => `${e.property} should be ${e.fix}`).join(', ')}`);
    }
    
    if (valueErrors.length > 0) {
      steps.push(`Correct invalid values: ${valueErrors.map(e => e.property).join(', ')}`);
    }
    
    if (result.warnings.length > 0 && result.errors.length === 0) {
      steps.push('Consider addressing warnings for better reliability');
    }
    
    if (result.errors.length > 0) {
      steps.push('Fix the errors above following the provided suggestions');
    }
    
    return steps;
  }
  
  
  /**
   * Deduplicate errors based on property and type
   * Prefers more specific error messages over generic ones
   */
  private static deduplicateErrors(errors: ValidationError[]): ValidationError[] {
    const seen = new Map<string, ValidationError>();
    
    for (const error of errors) {
      const key = `${error.property}-${error.type}`;
      const existing = seen.get(key);
      
      if (!existing) {
        seen.set(key, error);
      } else {
        // Keep the error with more specific message or fix
        const existingLength = (existing.message?.length || 0) + (existing.fix?.length || 0);
        const newLength = (error.message?.length || 0) + (error.fix?.length || 0);
        
        if (newLength > existingLength) {
          seen.set(key, error);
        }
      }
    }
    
    return Array.from(seen.values());
  }
  
  /**
   * Apply profile-based filtering to validation results
   */
  private static applyProfileFilters(
    result: EnhancedValidationResult,
    profile: ValidationProfile
  ): void {
    switch (profile) {
      case 'minimal':
        // Only keep missing required errors
        result.errors = result.errors.filter(e => e.type === 'missing_required');
        result.warnings = [];
        result.suggestions = [];
        break;
        
      case 'runtime':
        // Keep critical runtime errors only
        result.errors = result.errors.filter(e => 
          e.type === 'missing_required' || 
          e.type === 'invalid_value' ||
          (e.type === 'invalid_type' && e.message.includes('undefined'))
        );
        // Keep only security warnings
        result.warnings = result.warnings.filter(w => w.type === 'security');
        result.suggestions = [];
        break;
        
      case 'strict':
        // Keep everything, add more suggestions
        if (result.warnings.length === 0 && result.errors.length === 0) {
          result.suggestions.push('Consider adding error handling with onError property and timeout configuration');
          result.suggestions.push('Add authentication if connecting to external services');
        }
        // Require error handling for external service nodes
        this.enforceErrorHandlingForProfile(result, profile);
        break;
        
      case 'ai-friendly':
      default:
        // Current behavior - balanced for AI agents
        // Filter out noise but keep helpful warnings
        result.warnings = result.warnings.filter(w => 
          w.type !== 'inefficient' || !w.property?.startsWith('_')
        );
        // Add error handling suggestions for AI-friendly profile
        this.addErrorHandlingSuggestions(result);
        break;
    }
  }
  
  /**
   * Enforce error handling requirements based on profile
   */
  private static enforceErrorHandlingForProfile(
    result: EnhancedValidationResult,
    profile: ValidationProfile
  ): void {
    // Only enforce for strict profile on external service nodes
    if (profile !== 'strict') return;
    
    const nodeType = result.operation?.resource || '';
    const errorProneTypes = ['httpRequest', 'webhook', 'database', 'api', 'slack', 'email', 'openai'];
    
    if (errorProneTypes.some(type => nodeType.toLowerCase().includes(type))) {
      // Add general warning for strict profile
      // The actual error handling validation is done in node-specific validators
      result.warnings.push({
        type: 'best_practice',
        property: 'errorHandling',
        message: 'External service nodes should have error handling configured',
        suggestion: 'Add onError: "continueRegularOutput" or "stopWorkflow" with retryOnFail: true for resilience'
      });
    }
  }
  
  /**
   * Add error handling suggestions for AI-friendly profile
   */
  private static addErrorHandlingSuggestions(
    result: EnhancedValidationResult
  ): void {
    // Check if there are any network/API related errors
    const hasNetworkErrors = result.errors.some(e => 
      e.message.toLowerCase().includes('url') || 
      e.message.toLowerCase().includes('endpoint') ||
      e.message.toLowerCase().includes('api')
    );
    
    if (hasNetworkErrors) {
      result.suggestions.push(
        'For API calls, consider adding onError: "continueRegularOutput" with retryOnFail: true and maxTries: 3'
      );
    }
    
    // Check for webhook configurations
    const isWebhook = result.operation?.resource === 'webhook' || 
                     result.errors.some(e => e.message.toLowerCase().includes('webhook'));
    
    if (isWebhook) {
      result.suggestions.push(
        'Webhooks should use onError: "continueRegularOutput" to ensure responses are always sent'
      );
    }
  }
  
  /**
   * Validate fixedCollection structures for known problematic nodes
   * This prevents the "propertyValues[itemName] is not iterable" error
   */
  private static validateFixedCollectionStructures(
    nodeType: string,
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    // Use the generic FixedCollectionValidator
    const validationResult = FixedCollectionValidator.validate(nodeType, config);
    
    if (!validationResult.isValid) {
      // Add errors to the result
      for (const error of validationResult.errors) {
        result.errors.push({
          type: 'invalid_value',
          property: error.pattern.split('.')[0], // Get the root property
          message: error.message,
          fix: error.fix
        });
      }
      
      // Apply autofix if available
      if (validationResult.autofix) {
        // For nodes like If/Filter where the entire config might be replaced,
        // we need to handle it specially
        if (typeof validationResult.autofix === 'object' && !Array.isArray(validationResult.autofix)) {
          result.autofix = {
            ...result.autofix,
            ...validationResult.autofix
          };
        } else {
          // If the autofix is an array (like for If/Filter nodes), wrap it properly
          const firstError = validationResult.errors[0];
          if (firstError) {
            const rootProperty = firstError.pattern.split('.')[0];
            result.autofix = {
              ...result.autofix,
              [rootProperty]: validationResult.autofix
            };
          }
        }
      }
    }
  }
  
  
  /**
   * Validate Switch node structure specifically
   */
  private static validateSwitchNodeStructure(
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    if (!config.rules) return;
    
    // Skip if already caught by validateFixedCollectionStructures
    const hasFixedCollectionError = result.errors.some(e => 
      e.property === 'rules' && e.message.includes('propertyValues[itemName] is not iterable')
    );
    
    if (hasFixedCollectionError) return;
    
    // Validate rules.values structure if present
    if (config.rules.values && Array.isArray(config.rules.values)) {
      config.rules.values.forEach((rule: any, index: number) => {
        if (!rule.conditions) {
          result.warnings.push({
            type: 'missing_common',
            property: 'rules',
            message: `Switch rule ${index + 1} is missing "conditions" property`,
            suggestion: 'Each rule in the values array should have a "conditions" property'
          });
        }
        if (!rule.outputKey && rule.renameOutput !== false) {
          result.warnings.push({
            type: 'missing_common',
            property: 'rules',
            message: `Switch rule ${index + 1} is missing "outputKey" property`,
            suggestion: 'Add "outputKey" to specify which output to use when this rule matches'
          });
        }
      });
    }
  }
  
  /**
   * Validate If node structure specifically
   */
  private static validateIfNodeStructure(
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    if (!config.conditions) return;
    
    // Skip if already caught by validateFixedCollectionStructures
    const hasFixedCollectionError = result.errors.some(e => 
      e.property === 'conditions' && e.message.includes('propertyValues[itemName] is not iterable')
    );
    
    if (hasFixedCollectionError) return;
    
    // Add any If-node-specific validation here in the future
  }
  
  /**
   * Validate Filter node structure specifically
   */
  private static validateFilterNodeStructure(
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    if (!config.conditions) return;
    
    // Skip if already caught by validateFixedCollectionStructures
    const hasFixedCollectionError = result.errors.some(e => 
      e.property === 'conditions' && e.message.includes('propertyValues[itemName] is not iterable')
    );
    
    if (hasFixedCollectionError) return;
    
    // Add any Filter-node-specific validation here in the future
  }

  /**
   * Validate resource and operation values using similarity services
   */
  private static validateResourceAndOperation(
    nodeType: string,
    config: Record<string, any>,
    result: EnhancedValidationResult
  ): void {
    // Skip if similarity services not initialized
    if (!this.operationSimilarityService || !this.resourceSimilarityService || !this.nodeRepository) {
      return;
    }

    // Normalize the node type for repository lookups
    const normalizedNodeType = NodeTypeNormalizer.normalizeToFullForm(nodeType);

    // Apply defaults for validation
    const configWithDefaults = { ...config };

    // If operation is undefined but resource is set, get the default operation for that resource
    if (configWithDefaults.operation === undefined && configWithDefaults.resource !== undefined) {
      const defaultOperation = this.nodeRepository.getDefaultOperationForResource(normalizedNodeType, configWithDefaults.resource);
      if (defaultOperation !== undefined) {
        configWithDefaults.operation = defaultOperation;
      }
    }

    // Validate resource field if present
    if (config.resource !== undefined) {
      // Remove any existing resource error from base validator to replace with our enhanced version
      result.errors = result.errors.filter(e => e.property !== 'resource');
      const validResources = this.nodeRepository.getNodeResources(normalizedNodeType);
      const resourceIsValid = validResources.some(r => {
        const resourceValue = typeof r === 'string' ? r : r.value;
        return resourceValue === config.resource;
      });

      if (!resourceIsValid && config.resource !== '') {
        // Find similar resources
        let suggestions: any[] = [];
        try {
          suggestions = this.resourceSimilarityService.findSimilarResources(
            normalizedNodeType,
            config.resource,
            3
          );
        } catch (error) {
          // If similarity service fails, continue with validation without suggestions
          console.error('Resource similarity service error:', error);
        }

        // Build error message with suggestions
        let errorMessage = `Invalid resource "${config.resource}" for node ${nodeType}.`;
        let fix = '';

        if (suggestions.length > 0) {
          const topSuggestion = suggestions[0];
          // Always use "Did you mean" for the top suggestion
          errorMessage += ` Did you mean "${topSuggestion.value}"?`;
          if (topSuggestion.confidence >= 0.8) {
            fix = `Change resource to "${topSuggestion.value}". ${topSuggestion.reason}`;
          } else {
            // For lower confidence, still show valid resources in the fix
            fix = `Valid resources: ${validResources.slice(0, 5).map(r => {
              const val = typeof r === 'string' ? r : r.value;
              return `"${val}"`;
            }).join(', ')}${validResources.length > 5 ? '...' : ''}`;
          }
        } else {
          // No similar resources found, list valid ones
          fix = `Valid resources: ${validResources.slice(0, 5).map(r => {
            const val = typeof r === 'string' ? r : r.value;
            return `"${val}"`;
          }).join(', ')}${validResources.length > 5 ? '...' : ''}`;
        }

        const error: any = {
          type: 'invalid_value',
          property: 'resource',
          message: errorMessage,
          fix
        };

        // Add suggestion property if we have high confidence suggestions
        if (suggestions.length > 0 && suggestions[0].confidence >= 0.5) {
          error.suggestion = `Did you mean "${suggestions[0].value}"? ${suggestions[0].reason}`;
        }

        result.errors.push(error);

        // Add suggestions to result.suggestions array
        if (suggestions.length > 0) {
          for (const suggestion of suggestions) {
            result.suggestions.push(
              `Resource "${config.resource}" not found. Did you mean "${suggestion.value}"? ${suggestion.reason}`
            );
          }
        }
      }
    }

    // Validate operation field - now we check configWithDefaults which has defaults applied
    // Only validate if operation was explicitly set (not undefined) OR if we're using a default
    if (config.operation !== undefined || configWithDefaults.operation !== undefined) {
      // Remove any existing operation error from base validator to replace with our enhanced version
      result.errors = result.errors.filter(e => e.property !== 'operation');

      // Use the operation from configWithDefaults for validation (which includes the default if applied)
      const operationToValidate = configWithDefaults.operation || config.operation;
      const validOperations = this.nodeRepository.getNodeOperations(normalizedNodeType, config.resource);
      const operationIsValid = validOperations.some(op => {
        const opValue = op.operation || op.value || op;
        return opValue === operationToValidate;
      });

      // Only report error if the explicit operation is invalid (not for defaults)
      if (!operationIsValid && config.operation !== undefined && config.operation !== '') {
        // Find similar operations
        let suggestions: any[] = [];
        try {
          suggestions = this.operationSimilarityService.findSimilarOperations(
            normalizedNodeType,
            config.operation,
            config.resource,
            3
          );
        } catch (error) {
          // If similarity service fails, continue with validation without suggestions
          console.error('Operation similarity service error:', error);
        }

        // Build error message with suggestions
        let errorMessage = `Invalid operation "${config.operation}" for node ${nodeType}`;
        if (config.resource) {
          errorMessage += ` with resource "${config.resource}"`;
        }
        errorMessage += '.';

        let fix = '';

        if (suggestions.length > 0) {
          const topSuggestion = suggestions[0];
          if (topSuggestion.confidence >= 0.8) {
            errorMessage += ` Did you mean "${topSuggestion.value}"?`;
            fix = `Change operation to "${topSuggestion.value}". ${topSuggestion.reason}`;
          } else {
            errorMessage += ` Similar operations: ${suggestions.map(s => `"${s.value}"`).join(', ')}`;
            fix = `Valid operations${config.resource ? ` for resource "${config.resource}"` : ''}: ${validOperations.slice(0, 5).map(op => {
              const val = op.operation || op.value || op;
              return `"${val}"`;
            }).join(', ')}${validOperations.length > 5 ? '...' : ''}`;
          }
        } else {
          // No similar operations found, list valid ones
          fix = `Valid operations${config.resource ? ` for resource "${config.resource}"` : ''}: ${validOperations.slice(0, 5).map(op => {
            const val = op.operation || op.value || op;
            return `"${val}"`;
          }).join(', ')}${validOperations.length > 5 ? '...' : ''}`;
        }

        const error: any = {
          type: 'invalid_value',
          property: 'operation',
          message: errorMessage,
          fix
        };

        // Add suggestion property if we have high confidence suggestions
        if (suggestions.length > 0 && suggestions[0].confidence >= 0.5) {
          error.suggestion = `Did you mean "${suggestions[0].value}"? ${suggestions[0].reason}`;
        }

        result.errors.push(error);

        // Add suggestions to result.suggestions array
        if (suggestions.length > 0) {
          for (const suggestion of suggestions) {
            result.suggestions.push(
              `Operation "${config.operation}" not found. Did you mean "${suggestion.value}"? ${suggestion.reason}`
            );
          }
        }
      }
    }
  }
}
