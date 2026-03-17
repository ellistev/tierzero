import fs from "fs";

function modifyTypes() {
  const file = "C:/Users/steve/projects/tierzero/src/coder/types.ts";
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(
    'export type CodingProvider = "openai" | "anthropic" | "google";',
    'export type CodingProvider = "openai" | "anthropic" | "google" | "openrouter";'
  );
  content = content.replace(
    'export const PROVIDER_ENV_KEYS: Record<CodingProvider, string> = {',
    'export const PROVIDER_ENV_KEYS: Record<CodingProvider, string> = {\n  openrouter: "OPENROUTER_API_KEY",'
  );
  fs.writeFileSync(file, content);
}

function modifyProviders() {
  const file = "C:/Users/steve/projects/tierzero/src/coder/providers.ts";
  let content = fs.readFileSync(file, 'utf8');
  
  const orClass = `
class OpenRouterCodingModel implements CodingModel {
  readonly provider: CodingProvider = "openrouter" as any;
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: CodingModelConfig) {
    this.modelName = config.model;
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || "";
    this.maxTokens = config.maxTokens ?? 16384;
    this.temperature = config.temperature ?? 0;
    if (!this.apiKey) throw new Error("OpenRouter API key required");
  }

  async chat(messages: CodingMessage[]): Promise<string> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${this.apiKey}\`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(\`OpenRouter API \${res.status}: \${text}\`);
    }

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  }
}
`;

  content = content.replace("switch (provider) {", orClass + "\n  switch (provider) {\n    case \"openrouter\": return new OpenRouterCodingModel(resolved);");
  fs.writeFileSync(file, content);
}

function modifyCli() {
  const file = "C:/Users/steve/projects/tierzero/src/cli.ts";
  let content = fs.readFileSync(file, 'utf8');
  
  content = content.replace(
    `let { codebases, codingModel } = buildCoderConfig(args.flags);`,
    `// Force fake codebase so buildCoderConfig parses the coding model args without exploding
  if (!args.flags["codebase"]) {
    args.flags["codebase"] = workDir;
  }
  let { codebases, codingModel } = buildCoderConfig(args.flags);`
  );
  
  fs.writeFileSync(file, content);
}

try {
  modifyTypes();
  modifyProviders();
  modifyCli();
  console.log("DONE");
} catch (e) {
  console.error(e);
}
