import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiConfig } from '../src/assistant/ai-config.js';
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
