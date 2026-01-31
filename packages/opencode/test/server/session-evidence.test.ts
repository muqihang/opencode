import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.evidence routes", () => {
  test("GET /session/:sessionID/evidence/events returns empty batch for new session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const app = Server.App()
        const response = await app.request(`/session/${session.id}/evidence/events?cursor=0`)
        expect(response.status).toBe(200)

        const body = (await response.json()) as unknown
        expect(body).toEqual({ events: [], nextCursor: 0 })

        await Session.remove(session.id)
      },
    })
  })

  test("GET /session/:sessionID/evidence/manifest returns 200 for new session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const app = Server.App()
        const response = await app.request(`/session/${session.id}/evidence/manifest`)
        expect(response.status).toBe(200)

        const body = (await response.json()) as { specVersion?: string }
        expect(body.specVersion).toBe("evidence-manifest/1.0")

        await Session.remove(session.id)
      },
    })
  })
})

