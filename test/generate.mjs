// Unit tests for the commit-message generation units (run: node test/generate.mjs).
//
// These run directly against the exported units rather than through the RPC
// route: every route path reads a diff with git first, and this sandbox blocks
// spawning git with piped stdio (EPERM), so the route cannot reach the LLM half
// here. The route half — envelope, validation, endpoint dispatch — is covered by
// test/smoke.mjs.
import { clampForModel, generationPrompt, normalizeCommitMessage, requestCommitMessage, resolveLlmRoute } from "../lib/index.js";

let failures = 0;
function check(label, condition, detail) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL ${label}${detail === undefined ? "" : `: ${detail}`}`);
}

/** A fake `llm` service shaped like the real one. */
function fakeLlm(options = {}) {
  const calls = [];
  return {
    calls,
    listProviders() {
      if (options.providers !== undefined) return options.providers;
      return [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }];
    },
    async listModels(provider) {
      if (options.listModelsThrows === true) throw new Error("listing unsupported");
      return options.models !== undefined ? options.models : [{ id: "alpha-large" }, { id: "alpha-small" }];
    },
    async *stream(request) {
      calls.push(request);
      for (const chunk of options.chunks ?? [
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text: "feat: add thing" },
        { type: "block-end", index: 0, block: { type: "text", text: "feat: add thing" } },
        { type: "finish", reason: { kind: "stop" } }
      ]) {
        yield chunk;
      }
    }
  };
}

// ── clampForModel ────────────────────────────────────────────────────────────
{
  check("clamp: short text is untouched", clampForModel("abc", 10) === "abc");
  check("clamp: exact bound is untouched", clampForModel("a".repeat(10), 10) === "a".repeat(10));
  const clamped = clampForModel("a".repeat(50), 10);
  check("clamp: long text is cut", clamped.startsWith("a".repeat(10)));
  check("clamp: truncation is marked", clamped.includes("truncated"), clamped);
}

// ── generationPrompt ─────────────────────────────────────────────────────────
{
  const prompt = generationPrompt("stat line", "diff line");
  check("prompt: carries the stat", prompt.body.includes("stat line"));
  check("prompt: carries the diff", prompt.body.includes("diff line"));
  check("prompt: system asks for message only", /only/i.test(prompt.system));
  const empty = generationPrompt("", "");
  check("prompt: tolerates an empty stat", empty.body.includes("(unavailable)"));
  check("prompt: tolerates an empty diff", empty.body.includes("(empty)"));
}

// ── resolveLlmRoute ──────────────────────────────────────────────────────────
{
  const ctx = { llm: fakeLlm() };
  const named = await resolveLlmRoute(ctx, "beta", "alpha-small");
  check("route: honours the named provider", named.provider === "beta", JSON.stringify(named));
  check("route: uses the advertised model", named.model === "alpha-small", JSON.stringify(named));

  const fallback = await resolveLlmRoute(ctx, undefined, undefined);
  check("route: falls back to the first provider", fallback.provider === "alpha", JSON.stringify(fallback));
  check("route: falls back to the first model", fallback.model === "alpha-large", JSON.stringify(fallback));

  const unknownProvider = await resolveLlmRoute(ctx, "nope", undefined);
  check("route: an unknown provider falls back", unknownProvider.provider === "alpha", JSON.stringify(unknownProvider));

  // The session's route is trusted when the adapter cannot enumerate.
  const blind = { llm: { ...fakeLlm(), listModels: async () => { throw new Error("unsupported"); } } };
  const trusted = await resolveLlmRoute(blind, "alpha", "alpha-mini");
  check("route: trusts a named model when listing fails", trusted.model === "alpha-mini", JSON.stringify(trusted));

  // A model that does not belong to the named provider is not trusted.
  const mismatched = await resolveLlmRoute(ctx, "alpha", "beta-only");
  check("route: rejects a foreign model id", mismatched.model === "alpha-large", JSON.stringify(mismatched));

  let noProvider = null;
  try {
    await resolveLlmRoute({ llm: fakeLlm({ providers: [] }) }, undefined, undefined);
  } catch (error) {
    noProvider = error;
  }
  check("route: empty provider list throws", noProvider !== null);
  check("route: empty provider list is coded", noProvider?.pluginCode === "no-provider", String(noProvider?.pluginCode));

  let noModel = null;
  try {
    await resolveLlmRoute({ llm: fakeLlm({ models: [] }) }, undefined, undefined);
  } catch (error) {
    noModel = error;
  }
  check("route: no advertised model throws", noModel !== null);
  check("route: no advertised model is coded", noModel?.pluginCode === "no-model", String(noModel?.pluginCode));
}

// ── requestCommitMessage ─────────────────────────────────────────────────────
{
  const llm = fakeLlm();
  const message = await requestCommitMessage({ llm }, generationPrompt("s", "d"), { provider: "alpha", model: "alpha-large" }, undefined);
  check("stream: returns the assembled message", message === "feat: add thing", JSON.stringify(message));
  const request = llm.calls[0];
  check("stream: routes to the resolved provider", request.provider === "alpha", request.provider);
  check("stream: routes to the resolved model", request.model === "alpha-large", request.model);
  check("stream: caps output tokens", typeof request.maxTokens === "number" && request.maxTokens > 0);
  check("stream: carries exactly one message", Array.isArray(request.messages) && request.messages.length === 1);
  const carried = request.messages[0];
  check("stream: message is a user message", carried.role === "user", carried.role);
  check("stream: message has a fresh id", typeof carried.id === "string" && carried.id.length > 0);
  check("stream: message has one text block", carried.content.length === 1 && carried.content[0].type === "text");
  check("stream: message is attributed to this plugin", carried.source?.kind === "plugin" && carried.source.plugin === "dsh-git", JSON.stringify(carried.source));
  check("stream: system prompt is forwarded", typeof request.system === "string" && request.system.length > 0);
}

// delta-only adapter (no block-end): the fallback path must still work
{
  const llm = fakeLlm({
    chunks: [
      { type: "text-delta", index: 0, text: "fix: " },
      { type: "text-delta", index: 0, text: "guard input" },
      { type: "finish", reason: { kind: "stop" } }
    ]
  });
  const message = await requestCommitMessage({ llm }, generationPrompt("", ""), { provider: "a", model: "m" }, undefined);
  check("stream: delta-only output is assembled", message === "fix: guard input", JSON.stringify(message));
}

// interleaved block indexes keep provider order, not arrival order
{
  const llm = fakeLlm({
    chunks: [
      { type: "block-end", index: 1, block: { type: "text", text: "second" } },
      { type: "block-end", index: 0, block: { type: "text", text: "first" } },
      { type: "finish", reason: { kind: "stop" } }
    ]
  });
  const message = await requestCommitMessage({ llm }, generationPrompt("", ""), { provider: "a", model: "m" }, undefined);
  check("stream: blocks are ordered by index", message === "firstsecond", JSON.stringify(message));
}

// a terminal provider failure must surface, not read as empty output
{
  const llm = fakeLlm({
    chunks: [{ type: "finish", reason: { kind: "error", failure: { message: "provider exploded", code: "E_PROVIDER" } } }]
  });
  let failure = null;
  try {
    await requestCommitMessage({ llm }, generationPrompt("", ""), { provider: "a", model: "m" }, undefined);
  } catch (error) {
    failure = error;
  }
  check("stream: terminal error throws", failure !== null);
  check("stream: terminal error keeps the provider message", /provider exploded/.test(String(failure?.message)), String(failure?.message));
  check("stream: terminal error is coded llm-failed", failure?.pluginCode === "llm-failed", String(failure?.pluginCode));
}

// an abort must be reported as cancellation
{
  const llm = fakeLlm({ chunks: [{ type: "finish", reason: { kind: "aborted", failure: { message: "aborted", code: "E_ABORT" } } }] });
  let failure = null;
  try {
    await requestCommitMessage({ llm }, generationPrompt("", ""), { provider: "a", model: "m" }, undefined);
  } catch (error) {
    failure = error;
  }
  check("stream: abort is coded cancelled", failure?.pluginCode === "cancelled", String(failure?.pluginCode));
}

// whitespace-only output is not a commit message
{
  const llm = fakeLlm({ chunks: [{ type: "text-delta", index: 0, text: "   \n" }, { type: "finish", reason: { kind: "stop" } }] });
  let failure = null;
  try {
    await requestCommitMessage({ llm }, generationPrompt("", ""), { provider: "a", model: "m" }, undefined);
  } catch (error) {
    failure = error;
  }
  check("stream: blank output is rejected", failure?.pluginCode === "llm-empty", String(failure?.pluginCode));
}

// ── commit-message normalization ─────────────────────────────────────────────
// The regression this guards: a subject+body message (exactly what the
// generation prompt above asks for) used to be rejected as a "control
// character", so every drafted message failed to commit on push/commit.
{
  const cases = [
    // [ input, expected normalized message or null ]
    ["feat: add thing", "feat: add thing"],
    ["  feat: add thing  ", "feat: add thing"],
    ["subject\n\nbody line", "subject\n\nbody line"],
    ["subject\r\n\r\nbody line", "subject\n\nbody line"],
    ["subject\rbody", "subject\nbody"],
    ["subject\n\n\n\nbody", "subject\n\nbody"],
    ["\n\nsubject\n\nbody\n\n", "subject\n\nbody"],
    ["subject\n\tindented body", "subject\n\tindented body"],
    ["subject\nline with trailing space   \nbody", "subject\nline with trailing space\nbody"],
    ["subject\nbody", "subject\nbody"],
    ["", null],
    ["   ", null],
    ["\n\n", null],
    ["\t\t", null],
    ["a\u0000b", null],
    ["a\u000bb", null],
    ["a\u001bb", null],
    ["a\u007fb", null],
    [42, null],
    [null, null],
    [undefined, null],
    [{}, null],
    ["x".repeat(10000), "x".repeat(10000)],
    ["x".repeat(10001), null]
  ];
  for (const [input, expected] of cases) {
    const actual = normalizeCommitMessage(input);
    check(
      `normalize: ${String(JSON.stringify(input)).slice(0, 40)}`,
      actual === expected,
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} GENERATION TEST(S) FAILED`);
  process.exit(1);
}
console.log("GENERATION UNIT TESTS PASSED (route, prompt, clamping, stream assembly, failures, message normalization)");
