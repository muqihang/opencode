import path from "path"
import type { Argv } from "yargs"
import { ulid } from "ulid"
import { cmd } from "../cmd"
import { runOfflineEval } from "../../../eval/offline"

export const EvalCommand = cmd({
  command: "eval [suite]",
  describe: "run minimal offline evals and export an Evidence Pack (EVAL)",
  builder: (yargs: Argv) =>
    yargs
      .positional("suite", {
        describe: "eval suite name",
        type: "string",
        default: "offline",
        choices: ["offline"],
      })
      .option("out", {
        alias: "o",
        describe: "output directory for exported Evidence Pack",
        type: "string",
      })
      .option("session", {
        describe: "override eval session id (defaults to eval_<ulid>)",
        type: "string",
      }),
  async handler(args) {
    const suite = args.suite as "offline"
    const sessionId = (args.session as string | undefined) ?? `eval_${ulid()}`
    const out = (args.out as string | undefined) ?? path.join(".opencode", "evals", sessionId)

    const result = await runOfflineEval({ suite, sessionId, outDir: out, rootDir: process.cwd() })

    const lines = [
      "EVAL completed (offline)",
      `sessionId: ${result.sessionId}`,
      `exported: ${result.exportDir}`,
      `routingContract: ${result.checks.routingContract.status}`,
      `retrievalDeterminism: ${result.checks.retrievalDeterminism.status}`,
      `compactionPointers: ${result.checks.compactionPointers.status}`,
      `evidenceChain: ${result.checks.evidenceChain.status}`,
    ]
    console.log(lines.join("\n"))
  },
})
