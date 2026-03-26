// api/posthog.js — PostHog analytics reads
// Alias for analytics.js — dashboard calls /api/posthog for funnel + event data.
// All actions forwarded: dashboard, funnel, events, trends, persons, feature_flags, etc.
export { default } from './analytics.js';
