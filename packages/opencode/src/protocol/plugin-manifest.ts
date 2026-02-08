import z from "zod"

export const PluginPolicyAction = z.enum(["allow", "ask", "deny"])
export type PluginPolicyAction = z.infer<typeof PluginPolicyAction>

export const PluginPolicyPatch = z.record(z.string().min(1), PluginPolicyAction)
export type PluginPolicyPatch = z.infer<typeof PluginPolicyPatch>

export const PluginCompatibility = z
  .object({
    coreRange: z.string().min(1),
    pluginRange: z.string().min(1).optional(),
    status: z.enum(["supported", "blocked"]).default("supported"),
    reason: z.string().min(1).optional(),
  })
  .strict()

export type PluginCompatibility = z.infer<typeof PluginCompatibility>

export const PluginManifest = z
  .object({
    specVersion: z.literal("plugin-manifest/1.0"),
    name: z.string().min(1),
    version: z.string().min(1),
    coreRange: z.string().min(1),
    compatibility: z.array(PluginCompatibility).optional(),
    policy: z
      .object({
        patch: PluginPolicyPatch.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type PluginManifest = z.infer<typeof PluginManifest>
