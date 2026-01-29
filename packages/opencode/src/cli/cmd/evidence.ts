import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { exportEvidence } from "../../evidence/export"

export const EvidenceCommand = cmd({
  command: "evidence",
  describe: "manage evidence packs",
  builder: (yargs: Argv) => yargs.command(EvidenceExportCommand).demandCommand(),
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
