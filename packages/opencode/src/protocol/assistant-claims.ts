import z from "zod"
import { Sha256 } from "./shared"

// Structured "side channel" claims that can be validated and audited.
// The user-visible answer remains natural language; this protocol is the gate input.
export const ClaimKind = z.enum(["fact", "plan", "opinion"])
export type ClaimKind = z.infer<typeof ClaimKind>

const Pointer = z
  .object({
    path: z.string().min(1),
    sha256: Sha256.optional(),
    anchor: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const Claim = z
  .object({
    id: z.string().min(1),
    kind: ClaimKind,
    text: z.string().min(1),
    pointers: z.array(Pointer),
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (claim.kind !== "fact") return

    if (claim.pointers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fact claims require at least one citation pointer",
        path: ["pointers"],
      })
      return
    }

    for (let i = 0; i < claim.pointers.length; i++) {
      const pointer = claim.pointers[i]
      if (!pointer.sha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "fact claim pointer requires sha256",
          path: ["pointers", i, "sha256"],
        })
      }
      if (!pointer.anchor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "fact claim pointer requires anchor",
          path: ["pointers", i, "anchor"],
        })
      }
    }
  })

export const AssistantClaims = z
  .object({
    specVersion: z.literal("assistant-claims/1.0"),
    policyVersion: z.string().min(1),
    claims: z.array(Claim),
  })
  .strict()

export type AssistantClaims = z.infer<typeof AssistantClaims>
export type AssistantClaim = z.infer<typeof Claim>
export type AssistantPointer = z.infer<typeof Pointer>

