# Grep Pointers Output Format Design

## Overview
This change adds an optional `outputFormat` to the grep tool without altering the default behavior. When `outputFormat` is omitted or set to `"text"`, the tool preserves the existing output string, match counting, truncation behavior (`limit=100`), and line truncation (`MAX_LINE_LENGTH`). When `outputFormat` is `"pointers"`, the tool still runs the same ripgrep search, parses and sorts matches the same way, and applies the same truncation rules, but it writes the results to an evidence artifact and returns a compact JSON payload containing summary data and artifact pointers. This keeps large match bodies out of the tool output while providing a stable, pointerized artifact path for downstream consumers.

## Data Flow
The tool resolves the search path, executes ripgrep, then parses its output into match records, sorts by mod time, and truncates to the limit. For pointer output, it generates a safe artifact id by sanitizing `ctx.callID`, falling back to `ctx.messageID`, and then a fixed fallback if both sanitize to empty. It opens `EvidenceWriter` with the current session id, writes `grep/<safeId>/hits.json` containing a `grep-hits/1.0` payload (pattern, include, searchPath, matches, truncated, hasErrors, items). Items contain `path`, `lineNum`, and line text truncated to `MAX_LINE_LENGTH`. The tool returns a small JSON string (`tool-grep/2.0`) with `summary` and `pointers` derived from the artifact entry.

## Error Handling
Exit codes `0`, `1`, and `2` are treated as expected: `1` means no matches; `2` indicates errors but may still include matches. For `"text"` output, no-match cases still return `"No files found"` to preserve prior behavior. For `"pointers"` output, no-match cases still emit an artifact with an empty `items` array, and the summary exposes `hasErrors` to indicate exit code `2` scenarios. Any other exit code raises an error with ripgrep stderr.

## Testing
A new test creates a temporary directory, writes a file containing a known keyword, and executes grep with `outputFormat: "pointers"` and a fixed `callID` for stable paths. The test asserts the output is parseable JSON, the pointer path includes the session artifact prefix, the artifact file exists and has `specVersion: "grep-hits/1.0"`, and the metadata match count is greater than zero. Existing grep tests continue to validate the default text output path.
