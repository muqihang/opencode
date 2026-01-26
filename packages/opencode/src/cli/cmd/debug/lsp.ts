import { LSP } from "../../../lsp"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import { Log } from "../../../util/log"
import { EOL } from "os"
import { fileURLToPath } from "url"

async function findAnySourceFile(root: string) {
  const glob = new Bun.Glob("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}")
  for await (const file of glob.scan({
    cwd: root,
    absolute: true,
    followSymlinks: true,
    dot: true,
  })) {
    if (file.includes("/node_modules/")) continue
    if (file.includes("/.git/")) continue
    if (file.includes("/dist/")) continue
    if (file.includes("/build/")) continue
    if (file.includes("/.opencode/")) continue
    return file
  }
}

function findFilesContainingQuery(root: string, query: string, limit: number) {
  const max = Math.max(1, Math.min(limit, 20))
  try {
    const proc = Bun.spawnSync(
      [
        "rg",
        "-l",
        "-F",
        "--no-messages",
        "--hidden",
        "--glob",
        "!**/.git/**",
        "--glob",
        "!**/node_modules/**",
        "--glob",
        "!**/dist/**",
        "--glob",
        "!**/build/**",
        "--glob",
        "!**/.opencode/**",
        "--glob",
        "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
        query,
        root,
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    )
    if (proc.exitCode !== 0 || !proc.stdout) return []
    const text = new TextDecoder().decode(proc.stdout)
    return text
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, max)
  } catch {
    return []
  }
}

export const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP debugging utilities",
  builder: (yargs) =>
    yargs.command(DiagnosticsCommand).command(SymbolsCommand).command(DocumentSymbolsCommand).demandCommand(),
  async handler() {},
})

const DiagnosticsCommand = cmd({
  command: "diagnostics <file>",
  describe: "get diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      await LSP.touchFile(args.file, true)
      await Bun.sleep(1000)
      process.stdout.write(JSON.stringify(await LSP.diagnostics(), null, 2) + EOL)
    })
  },
})

export const SymbolsCommand = cmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      using _ = Log.Default.time("symbols")

      // workspace/symbol uses existing connected LSP clients. Some servers only index opened docs,
      // so we try to touch files that actually contain the query first.
      const candidates = findFilesContainingQuery(process.cwd(), args.query, 5)
      for (const file of candidates) {
        await LSP.touchFile(file, true)
      }
      if (candidates.length === 0) {
        const seed = await findAnySourceFile(process.cwd())
        if (seed) {
          await LSP.touchFile(seed, true)
        }
      }
      await Bun.sleep(250)

      const results = await LSP.workspaceSymbol(args.query)
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    })
  },
})

export const DocumentSymbolsCommand = cmd({
  command: "document-symbols <uri>",
  describe: "get symbols from a document",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      using _ = Log.Default.time("document-symbols")

      const filePath = fileURLToPath(args.uri)
      await LSP.touchFile(filePath, true)
      await Bun.sleep(250)

      const results = await LSP.documentSymbol(args.uri)
      process.stdout.write(JSON.stringify(results, null, 2) + EOL)
    })
  },
})
