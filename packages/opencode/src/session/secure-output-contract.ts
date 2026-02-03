export const SecureOutputContract = {
  specVersion: "secure-output-contract/1.0",
  text: [
    "<secure_output_contract>",
    "After your natural-language answer, append a structured claims block:",
    "- Wrap JSON with <assistant_claims_json> and </assistant_claims_json>.",
    "- JSON MUST conform to assistant-claims/1.0.",
    "- Use claim kinds: fact | plan | opinion.",
    "- fact claims MUST include pointers with path + sha256 + anchor.",
    "- If you cannot provide verifiable pointers for a fact, do NOT present it as certain. Mark it as opinion and explicitly say it is uncertain in the user-visible text.",
    "- Do NOT mislabel facts as opinion to bypass citations. If unsure, say unknown/uncertain.",
    "</secure_output_contract>",
  ].join("\n"),
}
