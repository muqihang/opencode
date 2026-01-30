import type { LanguageModelV2 } from '@ai-sdk/provider';

type OpenAIWireApi = 'responses' | 'chat';

type OpenAIWireSDK = {
  responses?: (id: string) => LanguageModelV2;
  chat?: (id: string) => LanguageModelV2;
};

export function resolveOpenAIModelFromWireApi(
  sdk: unknown,
  modelID: string,
  wireApi?: OpenAIWireApi,
): LanguageModelV2 | undefined {
  // Runtime-safe resolver:
  // - OpenAI provider can expose both `chat()` and `responses()` factories.
  // - We want a deterministic selection based on configured wire_api.
  const candidate = sdk as Partial<OpenAIWireSDK>;
  if (wireApi === 'responses' && typeof candidate.responses === 'function') {
    return candidate.responses(modelID);
  }
  if (wireApi === 'chat' && typeof candidate.chat === 'function') {
    return candidate.chat(modelID);
  }
  return undefined;
}
