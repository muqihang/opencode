import { describe, expect, test } from 'bun:test';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import { ProviderTransform } from '../../src/provider/transform';
import { resolveOpenAIModelFromWireApi } from '../../src/provider/openai-wire-api';
import type { Provider } from '../../src/provider/provider';

function makeFakeLanguageModelV2(params: { modelId: string }): LanguageModelV2 {
  // Minimal stub: the resolver only needs an opaque LanguageModelV2 instance
  // so we can assert which factory was chosen.
  const model = {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: params.modelId,
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [],
        finishReason: 'stop',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  } satisfies LanguageModelV2;

  return model;
}

describe('OpenAI-like gateways - wire_api=responses implies prompt cache key', () => {
  test('sets promptCacheKey when providerOptions.wire_api is responses', () => {
    const model: Provider.Model = {
      id: 'sub2api/gpt-5.2-codex',
      providerID: 'sub2api',
      name: 'gpt-5.2-codex',
      family: 'gpt-5',
      api: {
        id: 'gpt-5.2-codex',
        url: 'http://127.0.0.1:18080',
        npm: '@ai-sdk/openai',
      },
      status: 'active',
      headers: {},
      options: {},
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: { context: 200000, output: 32000 },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      release_date: '2025-01-01',
    };

    const result = ProviderTransform.options({
      model,
      sessionID: 'ses_cache_key',
      providerOptions: { wire_api: 'responses' },
    });
    expect(result.promptCacheKey).toBe('ses_cache_key');
  });
});

describe('resolveOpenAIModelFromWireApi', () => {
  test('wire_api=responses selects sdk.responses', () => {
    const calls: string[] = [];
    const responsesModel = makeFakeLanguageModelV2({ modelId: 'gpt-5.2-codex' });
    const chatModel = makeFakeLanguageModelV2({ modelId: 'gpt-5.2-codex' });
    const sdk = {
      responses: (id: string) => {
        calls.push(`responses:${id}`);
        return responsesModel;
      },
      chat: (id: string) => {
        calls.push(`chat:${id}`);
        return chatModel;
      },
    };

    const result = resolveOpenAIModelFromWireApi(sdk, 'gpt-5.2-codex', 'responses');

    expect(result).toBe(responsesModel);
    expect(calls).toEqual(['responses:gpt-5.2-codex']);
  });
});
