type OpenAIWireApi = "responses" | "chat"

export function resolveOpenAIModelFromWireApi<T>(
  sdk: { responses?: (id: string) => T; chat?: (id: string) => T },
  modelID: string,
  wireApi?: OpenAIWireApi,
): T | undefined {
  if (wireApi === "responses" && sdk.responses) {
    return sdk.responses(modelID)
  }
  if (wireApi === "chat" && sdk.chat) {
    return sdk.chat(modelID)
  }
  return undefined
}
