/** Feature flags read at build time.
 *
 * AI_CLEANUP_ENABLED gates every user-facing surface of region-based object
 * removal (the homepage upload tool, /image-cleanup, the editor's AI Cleanup
 * action, its guides and marketing copy) and the API routes that run it. The
 * code stays in place; set NEXT_PUBLIC_ENABLE_AI_CLEANUP=true to turn it back on.
 */
export const AI_CLEANUP_ENABLED = process.env.NEXT_PUBLIC_ENABLE_AI_CLEANUP === "true";
