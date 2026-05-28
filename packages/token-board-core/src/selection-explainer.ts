export type SelectionExplainPayload = {
  context: string;
  selection: string;
  slug?: string;
  title?: string;
};

export type SelectionExplainResult = {
  context: string;
  extra: string;
  meaning: string;
  sources: Array<{
    title: string;
    url: string;
  }>;
  term: string;
};

type KimiMessage =
  | {
      content: string;
      role: "system" | "user";
    }
  | {
      content?: string | null;
      role: "assistant";
      tool_calls?: KimiToolCall[];
    }
  | {
      content: string;
      name: string;
      role: "tool";
      tool_call_id: string;
    };

type KimiToolCall = {
  function: {
    arguments: string;
    name: string;
  };
  id: string;
};

type KimiChoice = {
  finish_reason?: string;
  message?: {
    content?: string | null;
    tool_calls?: KimiToolCall[];
  };
};

type KimiChatResponse = {
  choices?: KimiChoice[];
  error?: {
    message?: string;
    type?: string;
  };
};

const KIMI_CHAT_COMPLETIONS_PATH = "/chat/completions";
const KIMI_WEB_SEARCH_TOOL = {
  function: {
    name: "$web_search",
  },
  type: "builtin_function",
};

export const SELECTION_EXPLAIN_LIMITS = {
  context: 1200,
  selection: 80,
  slug: 220,
  title: 180,
} as const;

export class SelectionExplainServiceError extends Error {
  code: string;
  status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "SelectionExplainServiceError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeUrl(value: unknown) {
  const url = String(value ?? "").trim();

  if (!/^https?:\/\//i.test(url)) {
    return "";
  }

  return url;
}

export function parseSelectionExplainPayload(input: unknown) {
  if (!isRecord(input)) {
    return {
      error: "请求格式不正确。",
      ok: false as const,
    };
  }

  const rawSelection = String(input.selection ?? "").replace(/\s+/g, " ").trim();
  const selection = rawSelection.slice(0, SELECTION_EXPLAIN_LIMITS.selection);

  if (rawSelection.length < 2) {
    return {
      error: "请至少选中两个字符。",
      ok: false as const,
    };
  }

  if (rawSelection.length > SELECTION_EXPLAIN_LIMITS.selection) {
    return {
      error: `一次最多解释 ${SELECTION_EXPLAIN_LIMITS.selection} 个字符。`,
      ok: false as const,
    };
  }

  return {
    data: {
      context: normalizeText(input.context, SELECTION_EXPLAIN_LIMITS.context),
      selection,
      slug: normalizeText(input.slug, SELECTION_EXPLAIN_LIMITS.slug),
      title: normalizeText(input.title, SELECTION_EXPLAIN_LIMITS.title),
    } satisfies SelectionExplainPayload,
    ok: true as const,
  };
}

export function buildSelectionExplainMessages(payload: SelectionExplainPayload) {
  const title = payload.title || "未命名文章";
  const slug = payload.slug || "unknown";
  const context = payload.context || "用户没有提供上下文。";

  return [
    {
      content:
        "你是一个中文技术博客阅读助手。请使用 Kimi 联网搜索核对术语含义，再结合文章上下文解释用户选中的词。回答要简洁、准确、面向正在阅读技术文章的人。只返回 JSON，不要使用 Markdown。",
      role: "system" as const,
    },
    {
      content: [
        `文章标题：${title}`,
        `文章 slug：${slug}`,
        `用户选中：${payload.selection}`,
        `所在上下文：${context}`,
        "请返回严格 JSON：",
        '{"term":"选中的词","meaning":"一句话解释这个词本身是什么意思","context":"它在这段上下文里具体表达什么","extra":"必要的背景或容易混淆点，最多两句话","sources":[{"title":"来源标题","url":"https://example.com"}]}',
        "sources 最多 3 个；没有可靠来源就返回空数组。",
      ].join("\n"),
      role: "user" as const,
    },
  ];
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return "";
  }

  return candidate.slice(start, end + 1);
}

export function parseKimiExplainContent(
  content: string,
  fallbackTerm: string
): SelectionExplainResult {
  const json = extractJsonObject(content);

  if (!json) {
    return {
      context: "",
      extra: "",
      meaning: normalizeText(content, 700),
      sources: [],
      term: fallbackTerm,
    };
  }

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources
          .filter(isRecord)
          .map((source) => {
            const url = normalizeUrl(source.url);

            if (!url) {
              return null;
            }

            return {
              title: normalizeText(source.title, 80) || url,
              url,
            };
          })
          .filter((source): source is { title: string; url: string } => Boolean(source))
          .slice(0, 3)
      : [];

    return {
      context: normalizeText(parsed.context, 500),
      extra: normalizeText(parsed.extra, 500),
      meaning: normalizeText(parsed.meaning, 500),
      sources,
      term: normalizeText(parsed.term, 120) || fallbackTerm,
    };
  } catch {
    return {
      context: "",
      extra: "",
      meaning: normalizeText(content, 700),
      sources: [],
      term: fallbackTerm,
    };
  }
}

function getKimiConfig() {
  const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const baseUrl = (
    process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1"
  ).replace(/\/+$/, "");
  const model = process.env.KIMI_MODEL || "kimi-k2.5";
  const maxTokens = Number(process.env.KIMI_MAX_TOKENS || 2048);

  if (!apiKey) {
    throw new SelectionExplainServiceError(
      "缺少 KIMI_API_KEY。请在本地或部署环境中配置 Kimi API Key。",
      503,
      "missing_kimi_api_key"
    );
  }

  return {
    apiKey,
    baseUrl,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 2048,
    model,
  };
}

async function requestKimiChat(messages: KimiMessage[]) {
  const config = getKimiConfig();
  const response = await fetch(`${config.baseUrl}${KIMI_CHAT_COMPLETIONS_PATH}`, {
    body: JSON.stringify({
      max_tokens: config.maxTokens,
      messages,
      model: config.model,
      temperature: Number(process.env.KIMI_TEMPERATURE || 0.6),
      thinking: {
        type: "disabled",
      },
      tools: [KIMI_WEB_SEARCH_TOOL],
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as KimiChatResponse | null;

  if (!response.ok) {
    const message = payload?.error?.message || `Kimi API 请求失败：${response.status}`;

    throw new SelectionExplainServiceError(message, 502, "kimi_api_error");
  }

  return payload;
}

export async function explainSelectionWithKimi(
  payload: SelectionExplainPayload
): Promise<SelectionExplainResult> {
  const messages: KimiMessage[] = buildSelectionExplainMessages(payload);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const completion = await requestKimiChat(messages);
    const choice = completion?.choices?.[0];
    const assistantMessage = choice?.message;

    if (!choice || !assistantMessage) {
      throw new SelectionExplainServiceError(
        "Kimi 没有返回可用内容。",
        502,
        "empty_kimi_response"
      );
    }

    if (choice.finish_reason === "tool_calls" && assistantMessage.tool_calls?.length) {
      messages.push({
        content: assistantMessage.content ?? "",
        role: "assistant",
        tool_calls: assistantMessage.tool_calls,
      });

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.function.name !== "$web_search") {
          continue;
        }

        let toolArguments: unknown;

        try {
          toolArguments = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          toolArguments = toolCall.function.arguments;
        }

        messages.push({
          content: JSON.stringify(toolArguments),
          name: toolCall.function.name,
          role: "tool",
          tool_call_id: toolCall.id,
        });
      }

      continue;
    }

    const content = assistantMessage.content?.trim();

    if (!content) {
      throw new SelectionExplainServiceError(
        "Kimi 没有返回解释内容。",
        502,
        "empty_kimi_content"
      );
    }

    return parseKimiExplainContent(content, payload.selection);
  }

  throw new SelectionExplainServiceError(
    "Kimi 搜索耗时较长，请稍后再试。",
    504,
    "kimi_timeout"
  );
}
