/** One attempt's budget. Two attempts plus the news lookup and the market
 *  snapshot must all fit inside `handlerTimeoutMs`, or Telegraf aborts the
 *  handler and takes long polling down with it. */
const clamp = (value: string | undefined, fallback: number, min: number, max: number) =>
  Math.min(Math.max(Number(value) || fallback, min), max);

/** A self-hosted gateway's base URL is operator-supplied, so it is pinned to
 *  HTTPS and stripped of anything that could redirect or leak the credential. */
function chatEndpoint(name: string, value: string | undefined, fallback: string) {
  const base = new URL(value || fallback);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw new Error(`${name} must be an HTTPS base URL without credentials, query or fragment`);
  return `${base.href.replace(/\/$/, '')}/chat/completions`;
}
/** Credentials are selected with the provider, never reused across hosts.
 *  `aiApi` picks the request/response shape: OpenAI speaks the Responses API,
 *  OpenRouter the OpenAI-compatible Chat Completions API.
 *  `aiReasoning` is 'off' where a scratchpad only burns tokens and clock, and
 *  'default' where the endpoint rejects the request unless it may reason.
 *  `aiSchemaNudge` restates the schema in the prompt for gateways that accept
 *  `response_format` without enforcing it. */
export function aiConfig(env: NodeJS.ProcessEnv) {
  const provider = env.AI_PROVIDER || 'openai';
  const aiTimeoutMs = clamp(env.AI_TIMEOUT_MS, 30_000, 5_000, 60_000);
  if (provider === 'anoman') {
    return {
      aiProvider: 'anoman' as const,
      aiApi: 'chat' as const,
      aiKey: env.ANOMAN_API_KEY ?? '',
      aiModel: env.ANOMAN_MODEL ?? '',
      aiEndpoint: chatEndpoint('ANOMAN_BASE_URL', env.ANOMAN_BASE_URL, 'https://api.anoman.io/v1'),
      aiReasoning: 'off' as const, aiSchemaNudge: true, aiTimeoutMs,
    };
  }
  if (provider === 'tokenkoding') {
    return {
      aiProvider: 'tokenkoding' as const,
      aiApi: 'chat' as const,
      aiKey: env.TOKENKODING_API_KEY ?? '',
      aiModel: env.TOKENKODING_MODEL ?? '',
      aiEndpoint: chatEndpoint('TOKENKODING_BASE_URL', env.TOKENKODING_BASE_URL, 'https://api.tokenkoding.id/v1'),
      // This endpoint answers 400 "Reasoning is mandatory ... cannot be
      // disabled", and left alone it reasons briefly rather than at length:
      // measured 3s against 12s for the same prompt on glm-5.3-flash.
      aiReasoning: 'default' as const, aiSchemaNudge: true, aiTimeoutMs,
    };
  }
  if (provider === 'openrouter') {
    return {
      aiProvider: 'openrouter' as const,
      aiApi: 'chat' as const,
      aiKey: env.OPENROUTER_API_KEY ?? '',
      aiModel: env.OPENROUTER_MODEL ?? '',
      aiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
      aiReasoning: 'off' as const, aiSchemaNudge: false, aiTimeoutMs,
    };
  }
  if (provider !== 'openai') throw new Error('AI_PROVIDER must be openai, openrouter, anoman or tokenkoding');
  return {
    aiProvider: 'openai' as const,
    aiApi: 'responses' as const,
    aiKey: env.OPENAI_API_KEY ?? '',
    aiModel: env.OPENAI_MODEL ?? '',
    aiEndpoint: 'https://api.openai.com/v1/responses',
    aiReasoning: 'off' as const, aiSchemaNudge: false, aiTimeoutMs,
  };
}
