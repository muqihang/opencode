import crypto from "crypto"
import { Context } from "@/util/context"

export type TurnTrace = {
  traceId: string
  messageId: string
}

const trace = Context.create<TurnTrace>("turn-trace")

export const TurnTraceContext = {
  provide: trace.provide,
  use: trace.use,
  get(): TurnTrace | undefined {
    try {
      return trace.use()
    } catch (error) {
      if (error instanceof Context.NotFound) return undefined
      throw error
    }
  },
}

export function traceIdForMessageId(messageId: string): string {
  return crypto.createHash("sha256").update(messageId, "utf-8").digest("hex").slice(0, 32)
}
