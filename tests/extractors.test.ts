import { describe, it, expect } from 'vitest';
import { buildExtractor } from '../src/extractors';

describe('buildExtractor', () => {
  describe('tools/call', () => {
    const extractor = buildExtractor('tools/call');

    it('should extract tool name from params.name', () => {
      expect(extractor.extractName({ method: 'tools/call', params: { name: 'search_products' } }))
        .toBe('search_products');
    });

    it('should fallback to method name when params.name is missing', () => {
      expect(extractor.extractName({ method: 'tools/call' })).toBe('tools/call');
    });

    it('should extract invocation metadata with query argument', () => {
      const meta = extractor.extractInvocationMetadata({
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'shoes', limit: 10 } },
      });
      expect(meta).toEqual({
        input: {
          query: 'shoes',
          arguments: { query: 'shoes', limit: 10 },
        },
      });
    });

    it('should extract "q" as query alias', () => {
      const meta = extractor.extractInvocationMetadata({
        method: 'tools/call',
        params: { name: 'search', arguments: { q: 'shoes' } },
      });
      expect(meta?.input).toHaveProperty('query', 'shoes');
    });

    it('should return undefined for empty arguments', () => {
      const meta = extractor.extractInvocationMetadata({
        method: 'tools/call',
        params: { name: 'search', arguments: {} },
      });
      expect(meta).toBeUndefined();
    });

    it('should extract output metadata with content count', () => {
      const meta = extractor.extractOutputMetadata(
        { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
        { method: 'tools/call', params: { name: 'search' } },
      );
      expect(meta).toEqual({ output: { result_count: 2 } });
    });

    it('should include isError flag when present', () => {
      const meta = extractor.extractOutputMetadata(
        { content: [], isError: true },
        { method: 'tools/call', params: { name: 'search' } },
      );
      expect(meta?.output).toHaveProperty('is_error', true);
    });

    it('should extract error metadata', () => {
      const error = new Error('Something failed');
      const meta = extractor.extractErrorMetadata(error, { method: 'tools/call' });
      expect(meta).toEqual({
        error: { message: 'Something failed', type: 'Error' },
      });
    });
  });

  describe('resources/read', () => {
    const extractor = buildExtractor('resources/read');

    it('should extract URI as name', () => {
      expect(extractor.extractName({ method: 'resources/read', params: { uri: 'file:///test.txt' } }))
        .toBe('file:///test.txt');
    });

    it('should fallback to method name when uri is missing', () => {
      expect(extractor.extractName({ method: 'resources/read' })).toBe('resources/read');
    });

    it('should extract uri in invocation metadata', () => {
      const meta = extractor.extractInvocationMetadata({
        method: 'resources/read',
        params: { uri: 'file:///test.txt' },
      });
      expect(meta).toEqual({ input: { uri: 'file:///test.txt' } });
    });

    it('should extract output metadata with contents count', () => {
      const meta = extractor.extractOutputMetadata(
        { contents: [{ uri: 'file:///test.txt', text: 'hello' }] },
        { method: 'resources/read', params: { uri: 'file:///test.txt' } },
      );
      expect(meta).toEqual({ output: { result_count: 1 } });
    });
  });

  describe('prompts/get', () => {
    const extractor = buildExtractor('prompts/get');

    it('should extract prompt name', () => {
      expect(extractor.extractName({ method: 'prompts/get', params: { name: 'greeting' } }))
        .toBe('greeting');
    });

    it('should extract arguments in invocation metadata', () => {
      const meta = extractor.extractInvocationMetadata({
        method: 'prompts/get',
        params: { name: 'greeting', arguments: { language: 'en' } },
      });
      expect(meta).toEqual({ input: { arguments: { language: 'en' } } });
    });

    it('should extract output metadata with message count', () => {
      const meta = extractor.extractOutputMetadata(
        { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] },
        { method: 'prompts/get', params: { name: 'greeting' } },
      );
      expect(meta).toEqual({ output: { result_count: 1 } });
    });
  });

  describe('tools/list', () => {
    const extractor = buildExtractor('tools/list');

    it('should use method name as event name', () => {
      expect(extractor.extractName({ method: 'tools/list' })).toBe('tools/list');
    });

    it('should return undefined for invocation metadata', () => {
      expect(extractor.extractInvocationMetadata({ method: 'tools/list' })).toBeUndefined();
    });

    it('should extract tool count from output', () => {
      const meta = extractor.extractOutputMetadata(
        { tools: [{ name: 'a' }, { name: 'b' }] },
        { method: 'tools/list' },
      );
      expect(meta).toEqual({ output: { result_count: 2 } });
    });
  });

  describe('resources/list', () => {
    const extractor = buildExtractor('resources/list');

    it('should extract resource count from output', () => {
      const meta = extractor.extractOutputMetadata(
        { resources: [{ uri: 'file:///a' }] },
        { method: 'resources/list' },
      );
      expect(meta).toEqual({ output: { result_count: 1 } });
    });
  });

  describe('prompts/list', () => {
    const extractor = buildExtractor('prompts/list');

    it('should extract prompt count from output', () => {
      const meta = extractor.extractOutputMetadata(
        { prompts: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
        { method: 'prompts/list' },
      );
      expect(meta).toEqual({ output: { result_count: 3 } });
    });
  });

  describe('completion/complete', () => {
    const extractor = buildExtractor('completion/complete');

    it('should extract name from tool ref', () => {
      expect(extractor.extractName({
        method: 'completion/complete',
        params: { ref: { type: 'ref/tool', name: 'search' } },
      })).toBe('completion:tool:search');
    });

    it('should extract name from resource ref', () => {
      expect(extractor.extractName({
        method: 'completion/complete',
        params: { ref: { type: 'ref/resource', uri: 'file:///a' } },
      })).toBe('completion:resource:file:///a');
    });

    it('should extract name from prompt ref', () => {
      expect(extractor.extractName({
        method: 'completion/complete',
        params: { ref: { type: 'ref/prompt', name: 'greet' } },
      })).toBe('completion:prompt:greet');
    });

    it('should fallback to method name when no ref', () => {
      expect(extractor.extractName({ method: 'completion/complete' }))
        .toBe('completion/complete');
    });

    it('should extract completion values count from output', () => {
      const meta = extractor.extractOutputMetadata(
        { completion: { values: ['a', 'b'], total: 10, hasMore: true } },
        { method: 'completion/complete' },
      );
      expect(meta).toEqual({
        output: { result_count: 2, total: 10, has_more: true },
      });
    });
  });
});
