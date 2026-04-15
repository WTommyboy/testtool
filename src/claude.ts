import { config } from "./config";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export const askClaude = async (messages: ChatMessage[]): Promise<string> => {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY_NOT_SET");
  }

  const payload = {
    model: config.claudeModel,
    max_tokens: 2000,
    system:
      "You are a UAT test case assistant. Produce concise, structured content. When asked for testcase output, include a JSON block and markdown explanation.",
    messages: messages.map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.content }]
    }))
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`CLAUDE_API_ERROR_${resp.status}: ${err}`);
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  if (!text.trim()) {
    throw new Error("CLAUDE_EMPTY_RESPONSE");
  }
  return text;
};
