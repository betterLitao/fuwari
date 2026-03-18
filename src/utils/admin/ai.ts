import { readServerEnv } from "@/utils/server-env";

export interface AiConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

export function getAiConfig(): AiConfig {
	const baseUrl = readServerEnv("CPA_BASE_URL");
	const apiKey = readServerEnv("CPA_API_KEY");

	if (!baseUrl || !apiKey) {
		throw new Error("缺少 AI 配置，请设置 CPA_BASE_URL 和 CPA_API_KEY。");
	}

	return {
		baseUrl: baseUrl.replace(/\/+$/, ""),
		apiKey,
		model: readServerEnv("CPA_MODEL") || "cpa/codex-5.2",
	};
}
