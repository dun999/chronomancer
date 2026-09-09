import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiConfig } from '../src/assistant/ai-config.js';
test('Anoman uses its own credential and normalized Chat Completions endpoint', () => {
  const config = aiConfig({AI_PROVIDER:'anoman',ANOMAN_API_KEY:'test-anoman-key',
    ANOMAN_MODEL:'deepseek-v4-flash-latest',ANOMAN_BASE_URL:'https://api.anoman.io/v1/',
    OPENAI_API_KEY:'other-key',OPENROUTER_API_KEY:'other-router-key'});
  assert.equal(config.aiEndpoint,'https://api.anoman.io/v1/chat/completions');
  assert.equal(config.aiApi,'chat');
  assert.equal(config.aiModel,'deepseek-v4-flash-latest');
  assert.equal(config.aiKey,'test-anoman-key');
  assert.equal(aiConfig({AI_PROVIDER:'anoman',OPENAI_API_KEY:'other-key'}).aiKey,'');
  assert.throws(()=>aiConfig({AI_PROVIDER:'anoman',ANOMAN_BASE_URL:'http://example.com'}));
});
test('TokenKoding keeps its own credential, its own host, and its mandatory reasoning', () => {
  const config = aiConfig({AI_PROVIDER:'tokenkoding',TOKENKODING_API_KEY:'test-tk-key',
    TOKENKODING_MODEL:'glm-5.3-flash',ANOMAN_API_KEY:'other-anoman-key',OPENAI_API_KEY:'other-key'});
  assert.equal(config.aiEndpoint,'https://api.tokenkoding.id/v1/chat/completions');
  assert.equal(config.aiApi,'chat');
  assert.equal(config.aiModel,'glm-5.3-flash');
  assert.equal(config.aiKey,'test-tk-key');
  // The endpoint answers 400 when reasoning is disabled, so it must not be.
  assert.equal(config.aiReasoning,'default');
  assert.equal(aiConfig({AI_PROVIDER:'tokenkoding',ANOMAN_API_KEY:'other-anoman-key'}).aiKey,'');
  assert.equal(aiConfig({AI_PROVIDER:'tokenkoding',TOKENKODING_BASE_URL:'https://gateway.test/v1/'}).aiEndpoint,
    'https://gateway.test/v1/chat/completions');
  for (const bad of ['http://api.tokenkoding.id/v1','https://user:pw@api.tokenkoding.id/v1','https://api.tokenkoding.id/v1?key=leak'])
    assert.throws(()=>aiConfig({AI_PROVIDER:'tokenkoding',TOKENKODING_BASE_URL:bad}),/HTTPS base URL/,`accepted ${bad}`);
  // Every other provider keeps a scratchpad off; only this one needs it.
  assert.equal(aiConfig({AI_PROVIDER:'anoman'}).aiReasoning,'off');
  assert.equal(aiConfig({AI_PROVIDER:'openrouter'}).aiReasoning,'off');
});
test('OpenRouter uses the chat API and only the OpenRouter credential', () => {
  const config = aiConfig({AI_PROVIDER:'openrouter',OPENROUTER_API_KEY:'test-router-key',
    OPENROUTER_MODEL:'vendor/model',OPENAI_API_KEY:'test-openai-key'});
  assert.equal(config.aiEndpoint,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(config.aiApi,'chat');
  assert.equal(config.aiModel,'vendor/model');
  assert.equal(config.aiKey,'test-router-key');
  assert.equal(aiConfig({AI_PROVIDER:'openrouter',OPENAI_API_KEY:'test-openai-key'}).aiKey,'');
});
test('default provider does not send an OpenRouter credential to OpenAI', () => {
  const config = aiConfig({OPENROUTER_API_KEY:'test-router-key'});
  assert.equal(config.aiKey,'');
  assert.equal(config.aiApi,'responses');
  assert.equal(config.aiEndpoint,'https://api.openai.com/v1/responses');
  assert.equal(aiConfig({OPENAI_API_KEY:'test-openai-key',OPENAI_MODEL:'chosen-model'}).aiModel,'chosen-model');
  assert.throws(()=>aiConfig({AI_PROVIDER:'unknown'}));
  assert.throws(()=>aiConfig({AI_PROVIDER:'opencode'}));
});
