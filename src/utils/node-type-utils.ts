/**
 * Utility functions for working with n8n node types
 * Provides consistent normalization and transformation of node type strings
 */

/**
 * Normalize a node type to the standard short form
 * Handles both old-style (n8n-nodes-base.) and new-style (nodes-base.) prefixes
 *
 * @example
 * normalizeNodeType('n8n-nodes-base.httpRequest') // 'nodes-base.httpRequest'
 * normalizeNodeType('@n8n/n8n-nodes-langchain.openAi') // 'nodes-langchain.openAi'
 * normalizeNodeType('nodes-base.webhook') // 'nodes-base.webhook' (unchanged)
 */
export function normalizeNodeType(type: string): string {
  if (!type) return type;

  return type
    .replace(/^n8n-nodes-base\./, 'nodes-base.')
    .replace(/^@n8n\/n8n-nodes-langchain\./, 'nodes-langchain.');
}

/**
 * Convert a short-form node type to the full package name
 *
 * @example
 * denormalizeNodeType('nodes-base.httpRequest', 'base') // 'n8n-nodes-base.httpRequest'
 * denormalizeNodeType('nodes-langchain.openAi', 'langchain') // '@n8n/n8n-nodes-langchain.openAi'
 */
export function denormalizeNodeType(type: string, packageType: 'base' | 'langchain'): string {
  if (!type) return type;

  if (packageType === 'base') {
    return type.replace(/^nodes-base\./, 'n8n-nodes-base.');
  }

  return type.replace(/^nodes-langchain\./, '@n8n/n8n-nodes-langchain.');
}

/**
 * Extract the node name from a full node type
 *
 * @example
 * extractNodeName('nodes-base.httpRequest') // 'httpRequest'
 * extractNodeName('n8n-nodes-base.webhook') // 'webhook'
 */
export function extractNodeName(type: string): string {
  if (!type) return '';

  // First normalize the type
  const normalized = normalizeNodeType(type);

  // Extract everything after the last dot
  const parts = normalized.split('.');
  return parts[parts.length - 1] || '';
}

/**
 * Get the package prefix from a node type
 *
 * @example
 * getNodePackage('nodes-base.httpRequest') // 'nodes-base'
 * getNodePackage('nodes-langchain.openAi') // 'nodes-langchain'
 */
export function getNodePackage(type: string): string | null {
  if (!type || !type.includes('.')) return null;

  // First normalize the type
  const normalized = normalizeNodeType(type);

  // Extract everything before the first dot
  const parts = normalized.split('.');
  return parts[0] || null;
}

/**
 * Check if a node type is from the base package
 */
export function isBaseNode(type: string): boolean {
  const normalized = normalizeNodeType(type);
  return normalized.startsWith('nodes-base.');
}

/**
 * Check if a node type is from the langchain package
 */
export function isLangChainNode(type: string): boolean {
  const normalized = normalizeNodeType(type);
  return normalized.startsWith('nodes-langchain.');
}

/**
 * Validate if a string looks like a valid node type
 * (has package prefix and node name)
 */
export function isValidNodeTypeFormat(type: string): boolean {
  if (!type || typeof type !== 'string') return false;

  // Must contain at least one dot
  if (!type.includes('.')) return false;

  const parts = type.split('.');

  // Must have exactly 2 parts (package and node name)
  if (parts.length !== 2) return false;

  // Both parts must be non-empty
  return parts[0].length > 0 && parts[1].length > 0;
}

/**
 * Try multiple variations of a node type to find a match
 * Returns an array of variations to try in order
 *
 * @example
 * getNodeTypeVariations('httpRequest')
 * // ['nodes-base.httpRequest', 'n8n-nodes-base.httpRequest', 'nodes-langchain.httpRequest', ...]
 */
export function getNodeTypeVariations(type: string): string[] {
  const variations: string[] = [];

  // If it already has a package prefix, try normalized version first
  if (type.includes('.')) {
    variations.push(normalizeNodeType(type));

    // Also try the denormalized versions
    const normalized = normalizeNodeType(type);
    if (normalized.startsWith('nodes-base.')) {
      variations.push(denormalizeNodeType(normalized, 'base'));
    } else if (normalized.startsWith('nodes-langchain.')) {
      variations.push(denormalizeNodeType(normalized, 'langchain'));
    }
  } else {
    // No package prefix, try common packages
    variations.push(`nodes-base.${type}`);
    variations.push(`n8n-nodes-base.${type}`);
    variations.push(`nodes-langchain.${type}`);
    variations.push(`@n8n/n8n-nodes-langchain.${type}`);
  }

  // Remove duplicates while preserving order
  return [...new Set(variations)];
}