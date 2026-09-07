/** Credentials are selected with the provider, never reused across hosts.
 *  `aiApi` picks the request/response shape: OpenAI speaks the Responses API,
 *  OpenRouter the OpenAI-compatible Chat Completions API. */
export function aiConfig(env: NodeJS.ProcessEnv) {
  const provider = env.AI_PROVIDER || 'openai';
  if (provider === 'anoman') {
    const base = new URL(env.ANOMAN_BASE_URL || 'https://api.anoman.io/v1');
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
      throw new Error('ANOMAN_BASE_URL must be an HTTPS base URL without credentials, query or fragment');
    return {
      aiProvider: 'anoman' as const,
      aiApi: 'chat' as const,
      aiKey: env.ANOMAN_API_KEY ?? '',
      aiModel: env.ANOMAN_MODEL ?? '',
      aiEndpoint: `${base.href.replace(/\/$/, '')}/chat/completions`,
    };
  }
  if (provider === 'openrouter') {
    return {
      aiProvider: 'openrouter' as const,
      aiApi: 'chat' as const,
      aiKey: env.OPENROUTER_API_KEY ?? '',
      aiModel: env.OPENROUTER_MODEL ?? '',
      aiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    };
  }
  if (provider !== 'openai') throw new Error('AI_PROVIDER must be openai, openrouter or anoman');
  return {
    aiProvider: 'openai' as const,
    aiApi: 'responses' as const,
    aiKey: env.OPENAI_API_KEY ?? '',
    aiModel: env.OPENAI_MODEL ?? '',
    aiEndpoint: 'https://api.openai.com/v1/responses',
  };
}
