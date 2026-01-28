import fs from "fs/promises"
import { EventV1 } from "@/protocol/event"

export async function appendEvent(file: string, input: unknown) {
  const data = EventV1.parse(input)
  await fs.appendFile(file, JSON.stringify(data) + "\n")
  return data
}
