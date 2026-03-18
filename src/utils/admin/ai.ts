import { readServerEnv } from "@/utils/server-env";

export interface AiConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedModels:
	| {
			key: string;
			expiresAt: number;
			models: string[];
	  }
	| undefined;

export function getAiConfig(): AiConfig {
	const baseUrl = readServerEnv("CPA_BASE_URL");
	const apiKey = readServerEnv("CPA_API_KEY");
	const model = readServerEnv("CPA_MODEL");

	if (!baseUrl || !apiKey || !model) {
		throw new Error(
			"缺少 AI 配置，请设置 CPA_BASE_URL、CPA_API_KEY 和 CPA_MODEL。",
		);
	}

	return {
		baseUrl: baseUrl.replace(/\/+$/, ""),
		apiKey,
		model,
	};
}

function buildCacheKey(config: AiConfig) {
	return `${config.baseUrl}\n${config.apiKey}`;
}

function extractMessageFromPayload(payload: unknown) {
	if (!payload || typeof payload !== "object") {
		return "";
	}

	const errorMessage =
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object" &&
		"message" in payload.error &&
		typeof payload.error.message === "string"
			? payload.error.message
			: "";

	if (errorMessage) {
		return errorMessage;
	}

	const directMessage =
		"message" in payload && typeof payload.message === "string"
			? payload.message
			: "";

	return directMessage;
}

function normalizeModelIds(payload: unknown) {
	if (!payload || typeof payload !== "object") {
		return [];
	}

	const data = "data" in payload ? payload.data : undefined;
	if (!Array.isArray(data)) {
		return [];
	}

	const ids = data
		.map((item) =>
			item && typeof item === "object" && "id" in item ? item.id : "",
		)
		.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
		.map((id) => id.trim());

	return Array.from(new Set(ids));
}

async function readUpstreamErrorMessage(response: Response) {
	const text = (await response.text()).trim();
	if (!text) {
		return "";
	}

	try {
		const payload = JSON.parse(text) as unknown;
		return extractMessageFromPayload(payload) || text;
	} catch {
		return text;
	}
}

async function fetchModelIds(config: AiConfig) {
	let response: Response;
	try {
		response = await fetch(`${config.baseUrl}/v1/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
			},
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : "网络请求失败";
		throw new Error(
			`AI 模型校验失败：无法访问 ${config.baseUrl}/v1/models（${detail}）。请检查 CPA_BASE_URL 与 CPA_API_KEY。`,
		);
	}

	if (!response.ok) {
		const detail = await readUpstreamErrorMessage(response);
		throw new Error(
			`AI 模型校验失败：读取模型列表返回 ${response.status} ${response.statusText}${detail ? `，${detail}` : ""}。请检查 CPA_BASE_URL、CPA_API_KEY 与上游服务状态。`,
		);
	}

	let payload: unknown;
	try {
		payload = (await response.json()) as unknown;
	} catch {
		throw new Error("AI 模型校验失败：/v1/models 返回内容不是合法 JSON。");
	}

	const modelIds = normalizeModelIds(payload);
	if (modelIds.length === 0) {
		throw new Error(
			"AI 模型校验失败：/v1/models 未返回可用模型列表，请检查上游代理兼容性。",
		);
	}

	return modelIds;
}

async function getModelIdsWithCache(config: AiConfig) {
	const key = buildCacheKey(config);
	const now = Date.now();

	if (cachedModels && cachedModels.key === key && cachedModels.expiresAt > now) {
		return cachedModels.models;
	}

	const models = await fetchModelIds(config);
	cachedModels = {
		key,
		models,
		expiresAt: now + MODEL_CACHE_TTL_MS,
	};
	return models;
}

function suggestModels(models: string[]) {
	const preferred = ["gpt-5.2", "gpt-5.2-codex", "gpt-5.3-codex", "gpt-5.4"];
	const hints = preferred.filter((model) => models.includes(model));
	if (hints.length > 0) {
		return hints.slice(0, 3);
	}
	return models.slice(0, 3);
}

export async function ensureAiModelAvailable(config: AiConfig) {
	const models = await getModelIdsWithCache(config);
	if (models.includes(config.model)) {
		return;
	}

	const suggestions = suggestModels(models);
	const suggestionText =
		suggestions.length > 0
			? `建议改为：${suggestions.join("、")}。`
			: "请先在上游 /v1/models 确认可用模型。";

	throw new Error(
		`AI 模型不可用：当前 CPA_MODEL=${config.model}，但未出现在上游模型列表。${suggestionText}`,
	);
}
