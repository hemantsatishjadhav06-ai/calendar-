export * from './types.js';
export * from './counters.js';
export * from './rules.js';
export * from './validate.js';

/** Public, serialisable summary (used by the MCP resource and the API docs). */
import { RULES } from './rules.js';
export function publicRulesSummary() {
  return Object.values(RULES).map(r => ({
    network: r.network, label: r.label,
    textMax: typeof r.text.max === 'number' ? r.text.max : 'dynamic',
    thread: r.thread?.maxParts ?? null,
    maxImages: r.media.maxImages, maxVideos: r.media.maxVideos, altTextMax: r.media.altTextMax ?? null,
    postTypes: r.postTypes?.map(p => p.id) ?? [], features: r.features, quota: r.quota,
  }));
}
