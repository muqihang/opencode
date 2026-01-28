import { EOL } from "os"
import { cmd } from "./cmd"
import { Config } from "../../config/config"

export function renderConfig(input: unknown) {
  return JSON.stringify(input, null, 2) + EOL
}

export const ConfigCommand = cmd({
  command: "config",
  describe: "show resolved configuration",
  handler: async () => {
    const config = await Config.get()
    process.stdout.write(renderConfig(config))
  },
})
