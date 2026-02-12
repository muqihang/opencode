export type WorkerPromptId = "retrieval_planner" | "evidence_critic" | "patch_planner"

type WorkerPromptTemplate = {
  version: "v1"
  role: string
  constraint: string
  output: string
  eval: string
}

export const WorkerPromptRegistry = {
  retrieval_planner: {
    version: "v1",
    role: "You are retrieval_planner.",
    constraint: "Return JSON only.",
    output: "Generate focused retrieval requests for missing evidence.",
    eval: "Only request retrieval for missing evidence.",
  },
  evidence_critic: {
    version: "v1",
    role: "You are evidence_critic.",
    constraint: "Return JSON only.",
    output: "Keep output concise.",
    eval: "If evidence is missing, request retrieval.",
  },
  patch_planner: {
    version: "v1",
    role: "You are patch_planner.",
    constraint: "Return JSON only with fields status, steps, risks, prerequisites, and optional notes.",
    output: "Provide strategy-only planning.",
    eval: "Never emit code fences, shell commands, or direct execution instructions.",
  },
} as const satisfies Record<WorkerPromptId, WorkerPromptTemplate>

const render = (template: WorkerPromptTemplate) => [
  `template_version=${template.version}`,
  `role: ${template.role}`,
  `constraint: ${template.constraint}`,
  `output: ${template.output}`,
  `eval: ${template.eval}`,
].join("\n")

export const buildWorkerSystemPrompt = (id: WorkerPromptId) => render(WorkerPromptRegistry[id])
