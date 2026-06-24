import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPTracker } from '../src/tracker';
import { instrumentServer } from '../src/instrument';
import type { MCPRawHandler, MCPServerLike, MCPHighLevelServerLike } from '../src/types';

// ============================================================================
// Mock helpers
// ============================================================================

function createMockSchema(method: string) {
  return { shape: { method: { value: method } } };
}

function createMockServer(): MCPServerLike & { _handlers: Map<string, MCPRawHandler> } {
  const handlers = new Map<string, MCPRawHandler>();
  return {
    _handlers: handlers,
    setRequestHandler: vi.fn((schema: any, handler: MCPRawHandler) => {
      const method = schema?.shape?.method?.value ?? schema;
      handlers.set(method, handler);
    }),
    removeRequestHandler: vi.fn((method: string) => {
      handlers.delete(method);
    }),
  };
}

function createMockMcpServer(): MCPHighLevelServerLike & {
  server: ReturnType<typeof createMockServer>;
  _toolHandlersInitialized: boolean;
  _resourceHandlersInitialized: boolean;
  _promptHandlersInitialized: boolean;
  setToolRequestHandlers: ReturnType<typeof vi.fn>;
  setResourceRequestHandlers: ReturnType<typeof vi.fn>;
  setPromptRequestHandlers: ReturnType<typeof vi.fn>;
} {
  const server = createMockServer();
  const mcpServer = {
    server,
    _toolHandlersInitialized: false,
    _resourceHandlersInitialized: false,
    _promptHandlersInitialized: false,
    setToolRequestHandlers: vi.fn(),
    setResourceRequestHandlers: vi.fn(),
    setPromptRequestHandlers: vi.fn(),
  };
  return mcpServer;
}

// ============================================================================
// Helpers
// ============================================================================

/** Wait for fire-and-forget promises to settle */
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// ============================================================================
// Tests
// ============================================================================

describe('instrumentServer', () => {
  let tracker: MCPTracker;

  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    tracker = new MCPTracker({ apiKey: 'test-key' });
  });

  describe('server resolution', () => {
    it('should accept a v1 Server (direct setRequestHandler)', () => {
      const server = createMockServer();
      expect(() => instrumentServer(server, tracker)).not.toThrow();
    });

    it('should accept a v2 McpServer (with .server property)', () => {
      const mcpServer = createMockMcpServer();
      expect(() => instrumentServer(mcpServer, tracker)).not.toThrow();
    });

    it('should throw for invalid objects', () => {
      expect(() => instrumentServer({} as any, tracker)).toThrow('neither a v1 Server');
    });
  });

  describe('double-instrumentation guard', () => {
    it('should be a no-op when instrumenting same server twice', () => {
      const server = createMockServer();
      const result1 = instrumentServer(server, tracker);
      const result2 = instrumentServer(server, tracker);

      // First returns a real uninstrument, second returns no-op
      expect(result1.uninstrument).toBeDefined();
      expect(result2.uninstrument).toBeDefined();
    });
  });

  describe('handler wrapping', () => {
    it('should wrap handlers for tracked methods', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker);

      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      server.setRequestHandler(createMockSchema('tools/call'), originalHandler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      const result = await wrappedHandler(
        { method: 'tools/call', params: { name: 'my_tool', arguments: { q: 'test' } } },
        {},
      );
      await tick();

      expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
      expect(originalHandler).toHaveBeenCalled();
      // invocation (fire-and-forget) + success = 2 fetch calls
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should NOT wrap handlers for untracked methods', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker);

      const handler = vi.fn().mockResolvedValue({});
      server.setRequestHandler(createMockSchema('ping'), handler);

      const storedHandler = server._handlers.get('ping')!;
      await storedHandler({ method: 'ping' }, {});

      expect(handler).toHaveBeenCalled();
      // No tracking calls
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should track tool name from request params', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker);

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await wrappedHandler(
        { method: 'tools/call', params: { name: 'search_products' } },
        {},
      );
      await tick();

      const calls = (global.fetch as any).mock.calls;
      const invocationBody = JSON.parse(calls[0][1].body);
      expect(invocationBody.tool_name).toBe('search_products');
      expect(invocationBody.event_type).toBe('invocation');

      const successBody = JSON.parse(calls[1][1].body);
      expect(successBody.tool_name).toBe('search_products');
      expect(successBody.event_type).toBe('success');
      expect(successBody.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track failure and rethrow on error', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker);

      const handler = vi.fn().mockRejectedValue(new Error('boom'));
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await expect(
        wrappedHandler({ method: 'tools/call', params: { name: 'bad_tool' } }, {}),
      ).rejects.toThrow('boom');
      await tick();

      const calls = (global.fetch as any).mock.calls;
      expect(calls).toHaveLength(2); // invocation (fire-and-forget) + failure

      const failureBody = JSON.parse(calls[1][1].body);
      expect(failureBody.event_type).toBe('failure');
      expect(failureBody.tool_name).toBe('bad_tool');
    });
  });

  describe('exclude list', () => {
    it('should skip tracking for excluded tools', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, { exclude: ['debug_tool'] });

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await wrappedHandler(
        { method: 'tools/call', params: { name: 'debug_tool' } },
        {},
      );

      expect(handler).toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should still track non-excluded tools', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, { exclude: ['debug_tool'] });

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await wrappedHandler(
        { method: 'tools/call', params: { name: 'search_products' } },
        {},
      );
      await tick();

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('per-handler overrides', () => {
    it('should use custom getMetadata from override', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, {
        overrides: {
          'my_tool': {
            getMetadata: (req) => ({ custom: 'metadata', tool: req.params?.name }),
          },
        },
      });

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await wrappedHandler(
        { method: 'tools/call', params: { name: 'my_tool', arguments: { q: 'test' } } },
        {},
      );
      await tick();

      const calls = (global.fetch as any).mock.calls;
      const invocationBody = JSON.parse(calls[0][1].body);
      expect(invocationBody.metadata).toHaveProperty('custom', 'metadata');
      expect(invocationBody.metadata).toHaveProperty('tool', 'my_tool');
    });

    it('should use custom getOutputMetadata from override', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, {
        overrides: {
          'my_tool': {
            getOutputMetadata: (res) => ({ items: (res as any)?.content?.length }),
          },
        },
      });

      const handler = vi.fn().mockResolvedValue({ content: [1, 2, 3] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await wrappedHandler(
        { method: 'tools/call', params: { name: 'my_tool' } },
        {},
      );
      await tick();

      const calls = (global.fetch as any).mock.calls;
      const successBody = JSON.parse(calls[1][1].body);
      expect(successBody.metadata).toHaveProperty('items', 3);
    });

    it('should suppress invocation tracking when override.trackInvocation is false', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, {
        overrides: {
          'my_tool': { trackInvocation: false },
        },
      });

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await wrappedHandler(
        { method: 'tools/call', params: { name: 'my_tool' } },
        {},
      );
      await tick();

      // Only success, no invocation
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.event_type).toBe('success');
    });
  });

  describe('getGlobalMetadata', () => {
    it('should merge global metadata into all events', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, {
        getGlobalMetadata: () => ({ session_id: 'sess_123', env: 'prod' }),
      });

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      const wrappedHandler = server._handlers.get('tools/call')!;
      await wrappedHandler(
        { method: 'tools/call', params: { name: 'my_tool' } },
        {},
      );
      await tick();

      const calls = (global.fetch as any).mock.calls;
      const invocationBody = JSON.parse(calls[0][1].body);
      expect(invocationBody.metadata).toHaveProperty('session_id', 'sess_123');
      expect(invocationBody.metadata).toHaveProperty('env', 'prod');
    });
  });

  describe('uninstrument', () => {
    it('should restore original setRequestHandler', async () => {
      const server = createMockServer();
      const originalSetHandler = server.setRequestHandler;

      const { uninstrument } = instrumentServer(server, tracker);

      // Verify it was patched
      expect(server.setRequestHandler).not.toBe(originalSetHandler);

      uninstrument();

      // Now register a handler - should NOT be wrapped
      server.setRequestHandler(createMockSchema('tools/call'), vi.fn().mockResolvedValue({}));
      const handler = server._handlers.get('tools/call')!;
      await handler({ method: 'tools/call', params: { name: 'test' } }, {});

      // No tracking calls since we uninstrumented
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('McpServer v2 refresh', () => {
    it('should refresh pre-registered handlers for McpServer v2', () => {
      const mcpServer = createMockMcpServer();

      // Simulate tools already registered before instrument()
      mcpServer._toolHandlersInitialized = true;
      mcpServer._resourceHandlersInitialized = true;
      mcpServer._promptHandlersInitialized = true;

      instrumentServer(mcpServer, tracker);

      // Should have reset the guards and called the re-initializers
      expect(mcpServer.setToolRequestHandlers).toHaveBeenCalled();
      expect(mcpServer.setResourceRequestHandlers).toHaveBeenCalled();
      expect(mcpServer.setPromptRequestHandlers).toHaveBeenCalled();
    });

    it('should not call re-initializers if handlers were not initialized', () => {
      const mcpServer = createMockMcpServer();
      // All guards are false by default
      instrumentServer(mcpServer, tracker);

      expect(mcpServer.setToolRequestHandlers).not.toHaveBeenCalled();
      expect(mcpServer.setResourceRequestHandlers).not.toHaveBeenCalled();
      expect(mcpServer.setPromptRequestHandlers).not.toHaveBeenCalled();
    });

    it('should NOT remove completion/complete handler during refresh (no reinit path)', () => {
      const mcpServer = createMockMcpServer();
      mcpServer._toolHandlersInitialized = true;

      // Pre-register a completion handler that no reinit function re-registers
      const completionHandler = vi.fn();
      mcpServer.server._handlers.set('completion/complete', completionHandler);

      instrumentServer(mcpServer, tracker);

      // completion/complete must survive (was being dropped before the fix)
      expect(mcpServer.server._handlers.get('completion/complete')).toBe(completionHandler);
      expect(mcpServer.setToolRequestHandlers).toHaveBeenCalled();
    });
  });

  describe('captureArguments', () => {
    it('should capture only argument keys by default (no raw values)', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker);

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      await server._handlers.get('tools/call')!(
        { method: 'tools/call', params: { name: 'my_tool', arguments: { query: 'secret', token: 'abc' } } },
        {},
      );
      await tick();

      const invocationBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(invocationBody.metadata.input).toEqual({ argument_keys: ['query', 'token'] });
      expect(invocationBody.metadata.input).not.toHaveProperty('arguments');
    });

    it('should capture raw arguments when captureArguments=true', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, { captureArguments: true });

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      await server._handlers.get('tools/call')!(
        { method: 'tools/call', params: { name: 'my_tool', arguments: { query: 'shoes' } } },
        {},
      );
      await tick();

      const invocationBody = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(invocationBody.metadata.input).toHaveProperty('query', 'shoes');
      expect(invocationBody.metadata.input).toHaveProperty('arguments', { query: 'shoes' });
    });
  });

  describe('flush', () => {
    it('should await in-flight fire-and-forget tracking requests', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker);

      const handler = vi.fn().mockResolvedValue({ content: [] });
      server.setRequestHandler(createMockSchema('tools/call'), handler);

      await server._handlers.get('tools/call')!(
        { method: 'tools/call', params: { name: 'my_tool' } },
        {},
      );

      // No tick(): flush must drain both invocation + success POSTs itself
      await tracker.flush();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('methods filtering', () => {
    it('should only wrap specified methods when methods option is provided', async () => {
      const server = createMockServer();
      instrumentServer(server, tracker, { methods: ['tools/call'] });

      const toolHandler = vi.fn().mockResolvedValue({ content: [] });
      const listHandler = vi.fn().mockResolvedValue({ tools: [] });

      server.setRequestHandler(createMockSchema('tools/call'), toolHandler);
      server.setRequestHandler(createMockSchema('tools/list'), listHandler);

      // tools/call should be wrapped
      await server._handlers.get('tools/call')!(
        { method: 'tools/call', params: { name: 'test' } },
        {},
      );
      await tick();
      expect(global.fetch).toHaveBeenCalledTimes(2);

      vi.mocked(global.fetch).mockClear();

      // tools/list should NOT be wrapped
      await server._handlers.get('tools/list')!(
        { method: 'tools/list' },
        {},
      );
      await tick();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('tracker.instrument() method', () => {
    it('should be available on MCPTracker instance', () => {
      expect(typeof tracker.instrument).toBe('function');
    });

    it('should instrument a server and return InstrumentResult', () => {
      const server = createMockServer();
      const result = tracker.instrument(server);
      expect(result).toHaveProperty('uninstrument');
      expect(typeof result.uninstrument).toBe('function');
    });
  });
});
