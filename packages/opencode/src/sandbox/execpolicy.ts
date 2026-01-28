import z from "zod"

const NetworkPolicy = z.union([
  z.object({ mode: z.literal("deny_all") }).strict(),
  z
    .object({
      mode: z.literal("allowlist"),
      allowedDomains: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      mode: z.literal("full"),
      note: z.string().min(1).optional(),
    })
    .strict(),
])

const Capability = z
  .object({
    readonlyPaths: z.array(z.string().min(1)),
    writePaths: z.array(z.string().min(1)),
    exportPaths: z.array(z.string().min(1)),
    network: NetworkPolicy,
    workdirMode: z.enum(["isolated", "shared"]),
  })
  .strict()

const Limits = z
  .object({
    timeoutMs: z.number().int().positive(),
    maxProcesses: z.number().int().positive().optional(),
    maxMemoryMb: z.number().int().positive().optional(),
    maxCpuSeconds: z.number().int().positive().optional(),
  })
  .strict()

const ExecPolicyEval = z
  .object({
    specVersion: z.literal("execpolicy-eval/1.0"),
    toolName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string().min(1)).optional(),
    cwd: z.string().min(1),
    backend: z.enum(["soft", "hard"]),
    enforcement: z.enum(["soft", "hard"]),
    capability: Capability,
    limits: Limits,
    notes: z.array(z.string().min(1)),
  })
  .strict()

export type ExecPolicyEval = z.infer<typeof ExecPolicyEval>

export function buildExecPolicyEval(input: {
  toolName: string
  command: string
  args?: string[]
  cwd: string
  backend: "soft" | "hard"
  enforcement: "soft" | "hard"
  capability: z.infer<typeof Capability>
  limits: z.infer<typeof Limits>
}) {
  return ExecPolicyEval.parse({
    specVersion: "execpolicy-eval/1.0",
    toolName: input.toolName,
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    backend: input.backend,
    enforcement: input.enforcement,
    capability: input.capability,
    limits: input.limits,
    notes: [
      "enforcement=soft does not provide OS-level isolation; boundaries are governance/audit only.",
    ],
  })
}
