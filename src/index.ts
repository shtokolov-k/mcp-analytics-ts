export { MCPTracker, createMCPTracker } from './tracker';
export type {
  MCPEventType,
  MCPTrackerConfig,
  MCPMetadata,
  MCPEventPayload,
  WrapOptions,
  TrackingResult,
  // Rich metadata types for full dashboard functionality
  MCPLocation,
  MCPContext,
  MCPProduct,
  MCPStructuredContent,
  MCPInputMetadata,
  MCPOutputMetadata,
  MCPErrorMetadata,
  MCPRichMetadata,
  // SDK instrumentation types
  MCPMethod,
  MCPRawRequest,
  MCPRawHandler,
  MCPServerLike,
  MCPHighLevelServerLike,
  AnyMCPServer,
  InstrumentOptions,
  InstrumentResult,
  MCPHandlerOverride,
  MCPRequestMetadataExtractor,
  MCPResponseMetadataExtractor,
  MCPErrorMetadataExtractor,
} from './types';
export type { MethodExtractor } from './extractors';
