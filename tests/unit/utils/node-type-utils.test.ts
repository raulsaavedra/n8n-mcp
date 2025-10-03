import { describe, it, expect } from 'vitest';
import {
  normalizeNodeType,
  denormalizeNodeType,
  extractNodeName,
  getNodePackage,
  isBaseNode,
  isLangChainNode,
  isValidNodeTypeFormat,
  getNodeTypeVariations
} from '@/utils/node-type-utils';

describe('node-type-utils', () => {
  describe('normalizeNodeType', () => {
    it('should normalize n8n-nodes-base to nodes-base', () => {
      expect(normalizeNodeType('n8n-nodes-base.httpRequest')).toBe('nodes-base.httpRequest');
      expect(normalizeNodeType('n8n-nodes-base.webhook')).toBe('nodes-base.webhook');
    });

    it('should normalize @n8n/n8n-nodes-langchain to nodes-langchain', () => {
      expect(normalizeNodeType('@n8n/n8n-nodes-langchain.openAi')).toBe('nodes-langchain.openAi');
      expect(normalizeNodeType('@n8n/n8n-nodes-langchain.chatOpenAi')).toBe('nodes-langchain.chatOpenAi');
    });

    it('should leave already normalized types unchanged', () => {
      expect(normalizeNodeType('nodes-base.httpRequest')).toBe('nodes-base.httpRequest');
      expect(normalizeNodeType('nodes-langchain.openAi')).toBe('nodes-langchain.openAi');
    });

    it('should handle empty or null inputs', () => {
      expect(normalizeNodeType('')).toBe('');
      expect(normalizeNodeType(null as any)).toBe(null);
      expect(normalizeNodeType(undefined as any)).toBe(undefined);
    });
  });

  describe('denormalizeNodeType', () => {
    it('should denormalize nodes-base to n8n-nodes-base', () => {
      expect(denormalizeNodeType('nodes-base.httpRequest', 'base')).toBe('n8n-nodes-base.httpRequest');
      expect(denormalizeNodeType('nodes-base.webhook', 'base')).toBe('n8n-nodes-base.webhook');
    });

    it('should denormalize nodes-langchain to @n8n/n8n-nodes-langchain', () => {
      expect(denormalizeNodeType('nodes-langchain.openAi', 'langchain')).toBe('@n8n/n8n-nodes-langchain.openAi');
      expect(denormalizeNodeType('nodes-langchain.chatOpenAi', 'langchain')).toBe('@n8n/n8n-nodes-langchain.chatOpenAi');
    });

    it('should handle already denormalized types', () => {
      expect(denormalizeNodeType('n8n-nodes-base.httpRequest', 'base')).toBe('n8n-nodes-base.httpRequest');
      expect(denormalizeNodeType('@n8n/n8n-nodes-langchain.openAi', 'langchain')).toBe('@n8n/n8n-nodes-langchain.openAi');
    });

    it('should handle empty or null inputs', () => {
      expect(denormalizeNodeType('', 'base')).toBe('');
      expect(denormalizeNodeType(null as any, 'base')).toBe(null);
      expect(denormalizeNodeType(undefined as any, 'base')).toBe(undefined);
    });
  });

  describe('extractNodeName', () => {
    it('should extract node name from normalized types', () => {
      expect(extractNodeName('nodes-base.httpRequest')).toBe('httpRequest');
      expect(extractNodeName('nodes-langchain.openAi')).toBe('openAi');
    });

    it('should extract node name from denormalized types', () => {
      expect(extractNodeName('n8n-nodes-base.httpRequest')).toBe('httpRequest');
      expect(extractNodeName('@n8n/n8n-nodes-langchain.openAi')).toBe('openAi');
    });

    it('should handle types without package prefix', () => {
      expect(extractNodeName('httpRequest')).toBe('httpRequest');
    });

    it('should handle empty or null inputs', () => {
      expect(extractNodeName('')).toBe('');
      expect(extractNodeName(null as any)).toBe('');
      expect(extractNodeName(undefined as any)).toBe('');
    });
  });

  describe('getNodePackage', () => {
    it('should extract package from normalized types', () => {
      expect(getNodePackage('nodes-base.httpRequest')).toBe('nodes-base');
      expect(getNodePackage('nodes-langchain.openAi')).toBe('nodes-langchain');
    });

    it('should extract package from denormalized types', () => {
      expect(getNodePackage('n8n-nodes-base.httpRequest')).toBe('nodes-base');
      expect(getNodePackage('@n8n/n8n-nodes-langchain.openAi')).toBe('nodes-langchain');
    });

    it('should return null for types without package', () => {
      expect(getNodePackage('httpRequest')).toBeNull();
      expect(getNodePackage('')).toBeNull();
    });

    it('should handle null inputs', () => {
      expect(getNodePackage(null as any)).toBeNull();
      expect(getNodePackage(undefined as any)).toBeNull();
    });
  });

  describe('isBaseNode', () => {
    it('should identify base nodes correctly', () => {
      expect(isBaseNode('nodes-base.httpRequest')).toBe(true);
      expect(isBaseNode('n8n-nodes-base.webhook')).toBe(true);
      expect(isBaseNode('nodes-base.slack')).toBe(true);
    });

    it('should reject non-base nodes', () => {
      expect(isBaseNode('nodes-langchain.openAi')).toBe(false);
      expect(isBaseNode('@n8n/n8n-nodes-langchain.chatOpenAi')).toBe(false);
      expect(isBaseNode('httpRequest')).toBe(false);
    });
  });

  describe('isLangChainNode', () => {
    it('should identify langchain nodes correctly', () => {
      expect(isLangChainNode('nodes-langchain.openAi')).toBe(true);
      expect(isLangChainNode('@n8n/n8n-nodes-langchain.chatOpenAi')).toBe(true);
      expect(isLangChainNode('nodes-langchain.vectorStore')).toBe(true);
    });

    it('should reject non-langchain nodes', () => {
      expect(isLangChainNode('nodes-base.httpRequest')).toBe(false);
      expect(isLangChainNode('n8n-nodes-base.webhook')).toBe(false);
      expect(isLangChainNode('openAi')).toBe(false);
    });
  });

  describe('isValidNodeTypeFormat', () => {
    it('should validate correct node type formats', () => {
      expect(isValidNodeTypeFormat('nodes-base.httpRequest')).toBe(true);
      expect(isValidNodeTypeFormat('n8n-nodes-base.webhook')).toBe(true);
      expect(isValidNodeTypeFormat('nodes-langchain.openAi')).toBe(true);
      // @n8n/n8n-nodes-langchain.chatOpenAi actually has a slash in the first part, so it appears as 2 parts when split by dot
      expect(isValidNodeTypeFormat('@n8n/n8n-nodes-langchain.chatOpenAi')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidNodeTypeFormat('httpRequest')).toBe(false); // No package
      expect(isValidNodeTypeFormat('nodes-base.')).toBe(false); // No node name
      expect(isValidNodeTypeFormat('.httpRequest')).toBe(false); // No package
      expect(isValidNodeTypeFormat('nodes.base.httpRequest')).toBe(false); // Too many parts
      expect(isValidNodeTypeFormat('')).toBe(false);
    });

    it('should handle invalid types', () => {
      expect(isValidNodeTypeFormat(null as any)).toBe(false);
      expect(isValidNodeTypeFormat(undefined as any)).toBe(false);
      expect(isValidNodeTypeFormat(123 as any)).toBe(false);
    });
  });

  describe('getNodeTypeVariations', () => {
    it('should generate variations for node name without package', () => {
      const variations = getNodeTypeVariations('httpRequest');
      expect(variations).toContain('nodes-base.httpRequest');
      expect(variations).toContain('n8n-nodes-base.httpRequest');
      expect(variations).toContain('nodes-langchain.httpRequest');
      expect(variations).toContain('@n8n/n8n-nodes-langchain.httpRequest');
    });

    it('should generate variations for normalized base node', () => {
      const variations = getNodeTypeVariations('nodes-base.httpRequest');
      expect(variations).toContain('nodes-base.httpRequest');
      expect(variations).toContain('n8n-nodes-base.httpRequest');
      expect(variations.length).toBe(2);
    });

    it('should generate variations for denormalized base node', () => {
      const variations = getNodeTypeVariations('n8n-nodes-base.webhook');
      expect(variations).toContain('nodes-base.webhook');
      expect(variations).toContain('n8n-nodes-base.webhook');
      expect(variations.length).toBe(2);
    });

    it('should generate variations for normalized langchain node', () => {
      const variations = getNodeTypeVariations('nodes-langchain.openAi');
      expect(variations).toContain('nodes-langchain.openAi');
      expect(variations).toContain('@n8n/n8n-nodes-langchain.openAi');
      expect(variations.length).toBe(2);
    });

    it('should generate variations for denormalized langchain node', () => {
      const variations = getNodeTypeVariations('@n8n/n8n-nodes-langchain.chatOpenAi');
      expect(variations).toContain('nodes-langchain.chatOpenAi');
      expect(variations).toContain('@n8n/n8n-nodes-langchain.chatOpenAi');
      expect(variations.length).toBe(2);
    });

    it('should remove duplicates from variations', () => {
      const variations = getNodeTypeVariations('nodes-base.httpRequest');
      const uniqueVariations = [...new Set(variations)];
      expect(variations.length).toBe(uniqueVariations.length);
    });
  });
});