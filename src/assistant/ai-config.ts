/** Credentials are selected with the provider, never reused across hosts.
 *  `aiApi` picks the request/response shape: OpenAI speaks the Responses API,
 *  OpenRouter the OpenAI-compatible Chat Completions API. */
export function aiConfig(env: NodeJS.ProcessEnv) {
  const provider = env.AI_PROVIDER || 'openai';
  if (provider === 'openrouter') {
    return {
      aiProvider: 'openrouter' as const,
      aiApi: 'chat' as const,
      aiKey: env.OPENROUTER_API_KEY ?? '',
      aiModel: env.OPENROUTER_MODEL ?? '',
      aiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    };
  }
  if (provider !== 'openai') throw new Error('AI_PROVIDER must be openai or openrouter');
  return {
    aiProvider: 'openai' as const,
    aiApi: 'responses' as const,
    aiKey: env.OPENAI_API_KEY ?? '',
    aiModel: env.OPENAI_MODEL ?? '',
    aiEndpoint: 'https://api.openai.com/v1/responses',
  };
}
