import z from "zod"

// Shared primitives for JSON artifacts ("protocol" files) that must be stable and easy to validate.

export const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "Expected lowercase/uppercase hex sha256")

// Crockford base32 ULID (26 chars). We treat it as an identifier, not a timestamp.
export const Ulid = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Expected ULID (Crockford base32, 26 chars)")

export const IsoDateTimeUtc = z.string().datetime({ offset: true })

export const PositiveInt = z.number().int().positive()
export const NonNegativeInt = z.number().int().nonnegative()

