import path from "path"
import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { exportEvidence } from "../../evidence/export"
import { runOfflineGateEval } from "../../eval/offline"
import { Flag } from "../../flag/flag"

export const EvidenceCommand = cmd({
  command: "evidence",
  describe: "manage evidence packs",
  builder: (yargs: Argv) => yargs.command(EvidenceExportCommand).command(EvidenceEvalCommand).demandCommand(),
  async handler() {},
})

export const EvidenceExportCommand = cmd({
  command: "export <sessionId>",
  describe: "export evidence pack and safe artifacts",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionId", {
        describe: "session id to export",
        type: "string",
      })
      .option("out", {
        alias: "o",
        describe: "output directory",
        type: "string",
        demandOption: true,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      await exportEvidence({
        sessionId: args.sessionId as string,
        outDir: args.out as string,
      })
    })
  },
})

export const EvidenceEvalCommand = cmd({
  command: "eval",
  describe: "run offline eval suites and enforce fixed gate thresholds",
  builder: (yargs: Argv) => {
    return yargs
      .option("suite-dir", {
        describe: "offline eval suite directory",
        type: "string",
      })
      .option("report", {
        describe: "offline eval report output path",
        type: "string",
      })
      .option("summary", {
        describe: "offline eval summary output path",
        type: "string",
      })
  },
  handler: async (args) => {
    const root = process.cwd()
    const suiteDir = (args["suite-dir"] as string | undefined) ?? (args as { suiteDir?: string }).suiteDir ?? path.join(root, "eval", "suites")
    const reportPath = (args.report as string | undefined) ?? path.join(root, "offline-eval-report.json")
    const summaryPath = (args.summary as string | undefined) ?? path.join(root, "offline-eval-summary.md")

    const report = await runOfflineGateEval({
      suiteDir,
      reportPath,
      summaryPath,
    })

    const lines = [
      "offline eval completed",
      `specVersion: ${report.specVersion}`,
      `suiteDir: ${report.suiteDir}`,
      `passed: ${report.gate.passed ? "yes" : "no"}`,
      `report: ${path.resolve(reportPath)}`,
      `summary: ${path.resolve(summaryPath)}`,
    ]
    console.log(lines.join("\n"))

    if (report.gate.passed) return

    if (!Flag.OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES) {
      console.log("offline eval gate failed but downgraded to warning (OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES=false)")
      return
    }

    throw new Error("offline eval gate failed")
  },
})
