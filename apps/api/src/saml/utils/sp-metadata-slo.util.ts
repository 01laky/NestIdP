/**
 * SLO-only SP-metadata extraction (v0.7.0 contract). Kept as a stable import path; the implementation
 * now lives in `sp-metadata.util.ts` (Prompt 42 generalized it into a full SP-metadata parser), so
 * there is a single source of truth for the XPath/namespace logic.
 */
export { extractSloUrlFromSpMetadata } from './sp-metadata.util';
