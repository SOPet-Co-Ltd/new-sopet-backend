import { registerAs } from '@nestjs/config';

export default registerAs('search', () => ({
  smartEnabled: process.env.SEARCH_SMART_ENABLED === 'true',
  openAiApiKey: process.env.OPENAI_API_KEY,
  semanticLegLimit: parseInt(process.env.SEARCH_SEMANTIC_LEG_LIMIT ?? '100', 10),
  rrfCandidateLimit: parseInt(process.env.SEARCH_RRF_CANDIDATE_LIMIT ?? '100', 10),
}));
