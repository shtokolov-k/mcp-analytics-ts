import { MCPTrackerConfig, MCPEventType, MCPMetadata, WrapOptions, TrackingResult, AnyMCPServer, MCPHighLevelServerLike, InstrumentOptions, InstrumentResult } from './types';
import { APIClient } from './client';
import { instrumentServer } from './instrument';
import { mergeMetadata, debugLog } from './utils';

const DEFAULT_ENDPOINT = 'https://dersubrqatbvvmzwkmsj.supabase.co/functions/v1/track-mcp-event';

export class MCPTracker {
  private client: APIClient;
  private config: Required<MCPTrackerConfig>;
  private pending = new Set<Promise<TrackingResult>>();

  constructor(config: MCPTrackerConfig = {}) {
    const apiKey = config.apiKey || process.env.METATUNER_API_KEY;
    if (!apiKey) {
      throw new Error(
        '[MCPTracker] API key is required. Either pass { apiKey } in config ' +
        'or set the METATUNER_API_KEY environment variable.',
      );
    }

    this.config = {
      apiKey,
      endpoint: config.endpoint || DEFAULT_ENDPOINT,
      timeout: config.timeout ?? 5000,
      retries: config.retries ?? 3,
      debug: config.debug ?? false,
    };

    this.client = new APIClient(this.config);
  }

  /**
   * Track an MCP event.
   *
   * The returned promise is also registered internally so that fire-and-forget
   * callers can be awaited later via flush(). Never rejects.
   */
  track(
    toolName: string,
    eventType: MCPEventType,
    metadata?: MCPMetadata,
    durationMs?: number
  ): Promise<TrackingResult> {
    const promise = this.doTrack(toolName, eventType, metadata, durationMs);
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise));
    return promise;
  }

  private async doTrack(
    toolName: string,
    eventType: MCPEventType,
    metadata?: MCPMetadata,
    durationMs?: number
  ): Promise<TrackingResult> {
    try {
      const payload = {
        tool_name: toolName,
        event_type: eventType,
        ...(durationMs !== undefined && { duration_ms: durationMs }),
        ...(metadata && { metadata }),
      };

      await this.client.sendEvent(payload);
      return { success: true };
    } catch (error: any) {
      debugLog(this.config.debug, `Failed to track ${eventType} event for ${toolName}:`, error);
      return { success: false, error };
    }
  }

  /**
   * Track an invocation event
   */
  async trackInvocation(toolName: string, metadata?: MCPMetadata): Promise<TrackingResult> {
    return this.track(toolName, 'invocation', metadata);
  }

  /**
   * Track a success event
   */
  async trackSuccess(
    toolName: string,
    metadata?: MCPMetadata,
    durationMs?: number
  ): Promise<TrackingResult> {
    return this.track(toolName, 'success', metadata, durationMs);
  }

  /**
   * Track a failure event
   */
  async trackFailure(
    toolName: string,
    metadata?: MCPMetadata,
    durationMs?: number
  ): Promise<TrackingResult> {
    return this.track(toolName, 'failure', metadata, durationMs);
  }

  /**
   * Whether debug logging is enabled.
   */
  get isDebug(): boolean {
    return this.config.debug;
  }

  /**
   * Await all in-flight (fire-and-forget) tracking requests.
   *
   * Call before a short-lived/serverless process exits, otherwise pending
   * analytics POSTs may be dropped. Safe to call repeatedly; resolves when no
   * tracking requests are outstanding.
   */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /**
   * Wrap a function with automatic MCP event tracking
   */
  wrap<TParams = any, TResult = any, TMeta = any>(
    toolName: string,
    fn: (params: TParams, meta?: TMeta) => Promise<TResult>,
    options: WrapOptions<TParams, TResult, TMeta> = {}
  ): (params: TParams, meta?: TMeta) => Promise<TResult> {
    const {
      getMetadata,
      getOutputMetadata,
      getErrorMetadata,
      trackInvocation: shouldTrackInvocation = true,
      rethrowErrors = true,
    } = options;

    return async (params: TParams, meta?: TMeta): Promise<TResult> => {
      const startTime = Date.now();
      let invocationMetadata: MCPMetadata | undefined;

      try {
        // Get initial metadata
        if (getMetadata) {
          try {
            invocationMetadata = getMetadata(params, meta);
          } catch (error: any) {
            debugLog(this.config.debug, `Error getting metadata for ${toolName}:`, error);
          }
        }

        // Track invocation (fire-and-forget)
        if (shouldTrackInvocation) {
          this.trackInvocation(toolName, invocationMetadata).catch(err =>
            debugLog(this.config.debug, `Unhandled tracking error (invocation) for "${toolName}":`, err),
          );
        }

        // Execute the function
        const result = await fn(params, meta);
        const duration = Date.now() - startTime;

        // Get output metadata
        let outputMetadata: MCPMetadata | undefined;
        if (getOutputMetadata) {
          try {
            outputMetadata = getOutputMetadata(result);
          } catch (error: any) {
            debugLog(this.config.debug, `Error getting output metadata for ${toolName}:`, error);
          }
        }

        // Track success (fire-and-forget)
        const successMetadata = mergeMetadata(invocationMetadata, outputMetadata);
        this.trackSuccess(toolName, successMetadata, duration).catch(err =>
          debugLog(this.config.debug, `Unhandled tracking error (success) for "${toolName}":`, err),
        );

        return result;
      } catch (error: any) {
        const duration = Date.now() - startTime;

        // Get error metadata
        let errorMetadata: MCPMetadata | undefined;
        if (getErrorMetadata) {
          try {
            errorMetadata = getErrorMetadata(error);
          } catch (metaError: any) {
            debugLog(this.config.debug, `Error getting error metadata for ${toolName}:`, metaError);
          }
        }

        // Track failure (fire-and-forget)
        const failureMetadata = mergeMetadata(invocationMetadata, errorMetadata);
        this.trackFailure(toolName, failureMetadata, duration).catch(err =>
          debugLog(this.config.debug, `Unhandled tracking error (failure) for "${toolName}":`, err),
        );

        // Rethrow the original error
        if (rethrowErrors) {
          throw error;
        }

        // If not rethrowing, return undefined (caller must handle this)
        return undefined as any;
      }
    };
  }

  /**
   * Instrument an existing MCP Server or McpServer instance with analytics.
   *
   * Monkey-patches setRequestHandler on the underlying Server so that all
   * handlers registered now or in the future are wrapped with analytics.
   * Calling this twice on the same server instance is a safe no-op.
   *
   * Supports both v1 (Server) and v2 (McpServer with .server property).
   * Requires @modelcontextprotocol/sdk to be installed as a peer dependency.
   *
   * @param target - A McpServer (v2) or Server (v1) instance
   * @param options - Tracking options: exclude list, per-tool overrides, extra methods
   * @returns InstrumentResult with uninstrument() for cleanup
   */
  instrument(target: AnyMCPServer, options?: InstrumentOptions): InstrumentResult {
    return instrumentServer(target, this, options, this.config.debug);
  }

  /**
   * Create a new McpServer that is pre-instrumented with analytics tracking.
   *
   * Equivalent to creating a McpServer and calling instrument() on it.
   * Requires @modelcontextprotocol/sdk v2 to be installed.
   *
   * @param info - Server implementation info { name, version }
   * @param instrumentOptions - Analytics tracking options
   * @returns The new McpServer instance (already instrumented). Cast to McpServer
   *          from @modelcontextprotocol/sdk for full type access.
   */
  async createInstrumentedServer(
    info: { name: string; version: string },
    instrumentOptions?: InstrumentOptions,
  ): Promise<MCPHighLevelServerLike> {
    let McpServerClass: any;
    try {
      // Use a variable to prevent TypeScript from resolving the optional dependency
      const sdkModule = '@modelcontextprotocol/sdk/server/mcp.js';
      const sdk = await import(/* webpackIgnore: true */ sdkModule);
      McpServerClass = sdk.McpServer;
    } catch {
      throw new Error(
        '[MCPTracker] createInstrumentedServer() requires @modelcontextprotocol/sdk. ' +
        'Install it with: npm install @modelcontextprotocol/sdk',
      );
    }

    const mcpServer = new McpServerClass(info);
    this.instrument(mcpServer, instrumentOptions);
    return mcpServer;
  }
}

/**
 * Factory function to create an MCPTracker instance
 */
export function createMCPTracker(config: MCPTrackerConfig = {}): MCPTracker {
  return new MCPTracker(config);
}
