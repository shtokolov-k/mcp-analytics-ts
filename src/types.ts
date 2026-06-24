export type MCPEventType = 'invocation' | 'success' | 'failure';

export interface MCPTrackerConfig {
  apiKey?: string;           // Default: process.env.METATUNER_API_KEY
  endpoint?: string;        // Default: Supabase function URL
  timeout?: number;         // Default: 5000ms
  retries?: number;         // Default: 3
  debug?: boolean;          // Default: false
}

export type MCPMetadata = Record<string, unknown>;

// ============================================================================
// Rich Metadata Types
// ============================================================================
// These types define the structured metadata schema that the Metatuner Analytics
// dashboard uses for insights, product analytics, and geographic tracking.
// Using these types enables full dashboard functionality including:
// - Geographic distribution analysis
// - Top queries and popular filters
// - Product analytics (category distribution, price trends, in-stock rates)
// - Error tracking and debugging
// ============================================================================

/**
 * Location context for geographic analytics.
 * Used by the dashboard to show geographic distribution of tool usage.
 */
export interface MCPLocation {
  /** City name */
  city?: string;
  /** Country code or name (used for geo distribution charts) */
  country?: string;
  /** Region/state/province */
  region?: string;
  /** IANA timezone identifier */
  timezone?: string;
}

/**
 * Context for user/request tracking.
 * Provides session and user-level information for analytics.
 */
export interface MCPContext {
  /** Browser/client user agent string */
  user_agent?: string;
  /** Locale identifier (e.g., 'en-US', 'de-DE') */
  locale?: string;
  /** Geographic location information */
  location?: MCPLocation;
  /** Subject/topic of the request */
  subject?: string;
  /** Session identifier for grouping related events */
  session_id?: string;
  /** User identifier for user-level analytics */
  user_id?: string;
}

/**
 * Product data for e-commerce analytics.
 * Used by the Products tab for product performance analysis.
 */
export interface MCPProduct {
  /** Product title/name */
  title?: string;
  /** Brand name (used for brand distribution analysis) */
  brand?: string;
  /** Product price (used for price trends and distribution) */
  price?: number;
  /** Currency code (e.g., 'USD', 'EUR') */
  currency?: string;
  /** Product category (used for category distribution charts) */
  category?: string;
  /** Whether product is in stock (used for in-stock rate metrics) */
  inStock?: boolean;
  /** Product image URL */
  imageUrl?: string;
  /** Product page URL */
  url?: string;
}

/**
 * Structured content for rich response data.
 * Contains product results and API performance metrics.
 */
export interface MCPStructuredContent {
  /** Total number of results available */
  total?: number;
  /** Catalog/data source identifier */
  source?: string;
  /** Whether results are exclusive to this source */
  exclusive?: boolean;
  /** API response time in milliseconds (used for performance metrics) */
  searchTime?: number;
  /** Array of product results */
  products?: MCPProduct[];
}

/**
 * Input metadata for tracking queries and filters.
 * Used by the Insights tab for top queries and popular filters analysis.
 */
export interface MCPInputMetadata {
  /** Search query string (used for top queries analysis) */
  query?: string;
  /** Additional filter parameters (used for popular filters analysis) */
  [key: string]: unknown;
}

/**
 * Output metadata for tracking results.
 * Used for result count metrics, empty result rate, and response analysis.
 */
export interface MCPOutputMetadata {
  /** Number of results returned (used for result count metrics and empty result rate) */
  result_count?: number;
  /** Brands included in results */
  brands_returned?: string[];
  /** Price range of returned results */
  price_range_returned?: {
    min?: number;
    max?: number;
  };
  /** Full response payload containing structured content */
  response_payload?: {
    /** Response with nested result structure */
    result?: {
      structuredContent?: MCPStructuredContent;
    };
    /** Direct structured content */
    structuredContent?: MCPStructuredContent;
  };
  /** Additional output fields */
  [key: string]: unknown;
}

/**
 * Error metadata for failure tracking.
 * Used by the Tools table to display recent errors.
 */
export interface MCPErrorMetadata {
  /** Error message (displayed in recent errors) */
  message?: string;
  /** Error code for categorization */
  code?: string;
  /** Error type/class name */
  type?: string;
  /** Stack trace for debugging */
  stack?: string;
}

/**
 * Rich metadata structure for full dashboard functionality.
 * This is a typed alternative to the generic MCPMetadata type.
 *
 * Using this structure enables all dashboard features:
 * - Insights Tab: Top queries, popular filters, geographic distribution,
 *   result metrics, API performance, category distribution
 * - Products Tab: Product rankings, price trends, category performance,
 *   price distribution, in-stock rates
 * - Tools Table: Recent errors display
 *
 * @example
 * ```typescript
 * const metadata: MCPRichMetadata = {
 *   input: {
 *     query: 'wireless headphones',
 *     brand: 'Sony',
 *     price_max: 200,
 *   },
 *   output: {
 *     result_count: 42,
 *     brands_returned: ['Sony', 'Bose', 'JBL'],
 *     price_range_returned: { min: 49.99, max: 199.99 },
 *   },
 *   context: {
 *     locale: 'en-US',
 *     location: { country: 'US', region: 'CA', city: 'San Francisco' },
 *     session_id: 'sess_abc123',
 *   },
 * };
 * ```
 */
export interface MCPRichMetadata {
  /** Input/query parameters */
  input?: MCPInputMetadata;
  /** Output/result data */
  output?: MCPOutputMetadata;
  /** Request context (user, location, session) */
  context?: MCPContext;
  /** Error information (for failure events) */
  error?: MCPErrorMetadata;
}

export interface MCPEventPayload {
  tool_name: string;
  event_type: MCPEventType;
  duration_ms?: number;
  metadata?: MCPMetadata;
}

export interface WrapOptions<TParams = any, TResult = any, TMeta = any> {
  getMetadata?: (params: TParams, meta?: TMeta) => MCPMetadata;
  getOutputMetadata?: (result: TResult) => MCPMetadata;
  getErrorMetadata?: (error: Error) => MCPMetadata;
  trackInvocation?: boolean;  // Default: true
  rethrowErrors?: boolean;     // Default: true
}

export interface TrackingResult {
  success: boolean;
  error?: Error;
}

// ============================================================================
// MCP SDK Instrumentation Types
// ============================================================================

/**
 * The set of MCP protocol methods that are tracked by default.
 * These correspond to the JSON-RPC method names used by the MCP protocol.
 */
export type MCPMethod =
  | 'tools/call'
  | 'resources/read'
  | 'prompts/get'
  | 'tools/list'
  | 'resources/list'
  | 'prompts/list'
  | 'completion/complete';

/**
 * Structural representation of a JSON-RPC MCP request.
 * Defined structurally so we never import from the SDK at the module level.
 */
export interface MCPRawRequest {
  method: string;
  params?: {
    name?: string;
    uri?: string;
    arguments?: Record<string, unknown>;
    ref?: { type: string; name?: string; uri?: string };
    [key: string]: unknown;
  };
}

/**
 * The raw handler function signature as defined by the MCP protocol.
 */
export type MCPRawHandler = (
  request: MCPRawRequest,
  ctx: unknown,
) => unknown | Promise<unknown>;

/**
 * A metadata extractor for a specific MCP request.
 * Receives the raw JSON-RPC request object and returns partial metadata.
 */
export type MCPRequestMetadataExtractor = (
  request: MCPRawRequest,
) => MCPMetadata | undefined;

/**
 * A metadata extractor for a specific MCP response.
 * Receives the raw response and the request for correlation.
 */
export type MCPResponseMetadataExtractor = (
  response: unknown,
  request: MCPRawRequest,
) => MCPMetadata | undefined;

/**
 * A metadata extractor for an MCP error.
 */
export type MCPErrorMetadataExtractor = (
  error: Error,
  request: MCPRawRequest,
) => MCPMetadata | undefined;

/**
 * Per-tool (or per-resource, per-prompt) tracking override.
 * Keyed by the specific name (tool name, resource URI pattern, prompt name).
 */
export interface MCPHandlerOverride {
  /** Custom invocation metadata extractor for this specific handler */
  getMetadata?: MCPRequestMetadataExtractor;
  /** Custom output metadata extractor for this specific handler */
  getOutputMetadata?: MCPResponseMetadataExtractor;
  /** Custom error metadata extractor for this specific handler */
  getErrorMetadata?: MCPErrorMetadataExtractor;
  /** Override whether invocation is tracked for this handler (default: true) */
  trackInvocation?: boolean;
}

/**
 * Configuration for the instrument() and createInstrumentedServer() APIs.
 */
export interface InstrumentOptions {
  /**
   * MCP methods to track. Defaults to all 7 standard methods.
   * Override to restrict tracking to specific methods.
   */
  methods?: MCPMethod[];

  /**
   * Tool/resource/prompt names to exclude from tracking entirely.
   * Matched against the resolved event name (tool name, URI, prompt name).
   */
  exclude?: string[];

  /**
   * Per-handler overrides for specific tools, resources, or prompts.
   * Keys are the handler names (tool name, resource URI, prompt name).
   */
  overrides?: Record<string, MCPHandlerOverride>;

  /**
   * Global metadata extractor applied to ALL requests before per-handler
   * extractors. Results are merged (per-handler values take precedence).
   * Useful for extracting session IDs or user context from every request.
   */
  getGlobalMetadata?: MCPRequestMetadataExtractor;
}

/**
 * Structural interface for the MCP Server instance (v1 and v2 inner server).
 * Defined structurally to avoid a hard import of the SDK.
 */
export interface MCPServerLike {
  setRequestHandler(schema: unknown, handler: MCPRawHandler): void;
  removeRequestHandler?(method: string): void;
}

/**
 * Structural interface for McpServer v2 (has a public `server` property).
 */
export interface MCPHighLevelServerLike {
  server: MCPServerLike;
}

/**
 * Either a low-level Server or a high-level McpServer (v2).
 * instrument() accepts both.
 */
export type AnyMCPServer = MCPServerLike | MCPHighLevelServerLike;

/**
 * Result of instrument() - allows cleanup (unpatching) if needed.
 */
export interface InstrumentResult {
  /** Restore the original setRequestHandler. Idempotent. */
  uninstrument(): void;
}
