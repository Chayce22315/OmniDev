# local-first model routing

**status: design proposal for phase 5; not implemented**

OmniDev should choose models based on the task, actual local availability, and measured capability. routing must be transparent and must not silently send work to a cloud provider.

## design goals

- run locally by default
- never require a paid provider
- make model selection visible and overridable
- use the simplest workflow likely to succeed
- bound retries, context, latency, and critique loops
- avoid parallel agents until a single-model workflow is reliable

## proposed provider-neutral interface

the eventual application layer should depend on a small contract, not directly on Ollama-specific response formats:

```ts
type ModelCapability =
  | "chat"
  | "code"
  | "json"
  | "vision"
  | "tools";

interface ModelDescriptor {
  id: string;
  provider: string;
  displayName: string;
  capabilities: ModelCapability[];
  contextWindow?: number;
  local: boolean;
}

interface GenerateRequest {
  model: string;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

interface GenerateResult {
  text: string;
  model: string;
  durationMs: number;
}

interface ModelProvider {
  listModels(): Promise<ModelDescriptor[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}
```

this is a conceptual starting point. before implementation, align fields with the actual capabilities of the chosen local runtime and keep the first version smaller if some fields cannot be supported honestly.

## routing policy

initial routing should be deterministic:

1. if the user explicitly chooses a model, use it or return a clear error.
2. otherwise use the configured `OMNIDEV_MODEL` when it is available.
3. otherwise select from locally installed models using declared capabilities and documented preferences.
4. if no compatible local model exists, explain how to install or select one.
5. never fall back to a remote model without explicit user configuration and a clear disclosure.

avoid claiming that a model is best at coding based solely on its name. record actual capability metadata and, later, local benchmark results.

## future task classes

these are possible routing categories, not a requirement to create agents now:

- explanation and planning
- code generation
- code review / critique
- structured output
- project summarization

the router should initially map each category to one model. multiple-model workflows come later.

## bounded critique workflow

when critique is eventually introduced:

1. generate one candidate answer or patch.
2. ask a reviewer model to identify concrete defects against stated criteria.
3. allow at most one configured revision by default.
4. stop when the reviewer finds no actionable issue, the iteration limit is reached, or the user cancels.
5. present unresolved concerns rather than looping indefinitely.

a second model's agreement is not proof of correctness. tests and actual tool results remain the source of truth.

## observability

show the selected provider and model, elapsed time, and whether execution remained local. do not log full prompts by default. errors should be actionable and must not expose tokens or secret environment variables.

## future evaluation

before adding model swarms, compare representative tasks for correctness, latency, memory use, and stability on supported hardware. keep the benchmark set small, repeatable, and separate from product prompts.
