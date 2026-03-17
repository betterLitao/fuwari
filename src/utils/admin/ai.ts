export interface AiConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

export function getAiConfig(): AiConfig {
	const baseUrl = import.meta.env.CPA_BASE_URL?.trim();
	const apiKey = import.meta.env.CPA_API_KEY?.trim();

	if (!baseUrl || !apiKey) {
		throw new Error("缺少 AI 配置，请设置 CPA_BASE_URL 和 CPA_API_KEY。");
	}

	return {
		baseUrl: baseUrl.replace(/\/+$/, ""),
		apiKey,
		model: import.meta.env.CPA_MODEL?.trim() || "cpa/codex-5.2",
	};
}
