import z from "zod"
import { RoutingRunner } from "@/routing/runner"
import { RoutingTier } from "@/protocol/routing-run-request"

const Input = z
  .object({
    step: z.number().int().positive(),
    sessionId: z.string().min(1),
    messageId: z.string().min(1),
    parentSessionId: z.string().min(1).optional(),
    intentText: z.string(),
    tier: RoutingTier.default("plan"),
  })
  .strict()

export type RoutingInjectionResult =
  | {
      kind: "none"
      reason: "not_first_step" | "child_session" | "empty_intent" | "error"
    }
  | {
      kind: "injected"
      artifactRoot: string
      routingRunId: string
      pointers: {
        request: string
        capsule: string
        results: string[]
      }
      systemPrompt: string
    }

function renderSystemPrompt(input: {
  artifactRoot: string
  routingRunId: string
  pointers: RoutingInjectionResult & { kind: "injected" }["pointers"]
}) {
  const lines = [
    "<routing>",
    `artifactRoot: ${input.artifactRoot}`,
    `routingRunId: ${input.routingRunId}`,
    `request: ${input.pointers.request}`,
    `capsule: ${input.pointers.capsule}`,
    "results:",
    ...input.pointers.results.map((p) => `- ${p}`),
    "</routing>",
  ]
  return lines.join("\n")
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/")
}

function stripArtifactRoot(input: { artifactRoot: string; pointerPath: string }) {
  const root = normalizePath(input.artifactRoot).replace(/\/+$/, "")
  const pointer = normalizePath(input.pointerPath)
  const prefix = root ? `${root}/` : ""
  if (prefix && pointer.startsWith(prefix)) {
    return pointer.slice(prefix.length)
  }
  return pointer
}

export async function maybeRunRoutingInjection(
  input: z.infer<typeof Input>,
): Promise<RoutingInjectionResult> {
  const data = Input.parse(input)
  if (data.step !== 1) return { kind: "none", reason: "not_first_step" }
  if (data.parentSessionId) return { kind: "none", reason: "child_session" }

  const intent = data.intentText.trim()
  if (!intent) return { kind: "none", reason: "empty_intent" }

  try {
    const run = await RoutingRunner.run({
      sessionId: data.sessionId,
      messageId: data.messageId,
      intentText: intent,
      tier: data.tier,
    })

    const artifactRoot = `.opencode/artifacts/${data.sessionId}`
    const pointers = {
      request: stripArtifactRoot({ artifactRoot, pointerPath: run.requestPath }),
      capsule: stripArtifactRoot({ artifactRoot, pointerPath: run.capsulePath }),
      results: run.results.map((p) => stripArtifactRoot({ artifactRoot, pointerPath: p })),
    }

    return {
      kind: "injected",
      artifactRoot,
      routingRunId: run.routingRunId,
      pointers,
      systemPrompt: renderSystemPrompt({
        artifactRoot,
        routingRunId: run.routingRunId,
        pointers,
      }),
    }
  } catch {
    return { kind: "none", reason: "error" }
  }
}
