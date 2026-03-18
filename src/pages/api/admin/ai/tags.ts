import type { APIRoute } from "astro";
import {
	type AiConfig,
	ensureAiModelAvailable,
	getAiConfig,
} from "@/utils/admin/ai";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { exportDocMarkdown, getDocsByIds } from "@/utils/admin/siyuan";

export const prerender = false;

const MAX_DOCS = 6;
const MAX_CHARS_PER_DOC = 2800;
const MAX_TAGS = 12;

function normalizeTag(tag: string) {
	return tag.replace(/^#/, "").trim();
}

function uniqueTags(tags: string[]) {
	const set = new Set<string>();
	for (const tag of tags) {
		const normalized = normalizeTag(tag);
		if (normalized) set.add(normalized);
	}
	return Array.from(set).slice(0, MAX_TAGS);
}

function parseTagsFromText(text: string) {
	const trimmed = text.trim();
	if (!trimmed) return [];

	const candidates: string[] = [trimmed];
	const bracketMatch = trimmed.match(/\[[\s\S]*]/);
	if (bracketMatch) candidates.unshift(bracketMatch[0]);

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (Array.isArray(parsed)) {
				return uniqueTags(parsed.map((item) => String(item)));
			}
		} catch {
			// ignore
		}
	}

	return uniqueTags(
		trimmed
			.replace(/[[\]"]/g, "")
			.split(/[,\n]/)
			.map((item) => item.trim())
			.filter(Boolean),
	);
}

function extractUpstreamErrorMessage(payload: unknown) {
	if (!payload || typeof payload !== "object") {
		return "";
	}

	const errorField = "error" in payload ? payload.error : undefined;
	if (errorField && typeof errorField === "object") {
		const errorMessage =
			"message" in errorField ? errorField.message : undefined;
		if (typeof errorMessage === "string" && errorMessage.trim()) {
			return errorMessage.trim();
		}
	}

	const message = "message" in payload ? payload.message : undefined;
	return typeof message === "string" ? message.trim() : "";
}

async function readUpstreamFailure(response: Response) {
	const text = (await response.text()).trim();
	if (!text) {
		return "";
	}
	try {
		const payload = JSON.parse(text) as unknown;
		return extractUpstreamErrorMessage(payload) || text;
	} catch {
		return text;
	}
}

function buildUpstreamFailureMessage(input: {
	status: number;
	statusText: string;
	model: string;
	detail: string;
}) {
	const base = `AI 提取失败：上游返回 ${input.status} ${input.statusText}${
		input.detail ? `，${input.detail}` : ""
	}。`;
	const lower = input.detail.toLowerCase();
	const modelMismatch =
		lower.includes("unknown provider for model") ||
		lower.includes("model not found") ||
		lower.includes("unknown model");

	if (!modelMismatch) {
		return base;
	}

	return `${base} 当前 CPA_MODEL=${input.model}，建议改为 gpt-5.2 并用 /v1/models 再确认可用模型。`;
}

async function callTagsModel(prompt: string, config: AiConfig) {
	const { baseUrl, apiKey, model } = config;
	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			messages: [
				{
					role: "system",
					content: "你是中文内容编辑助手，擅长从文章中提取简洁、稳定的标签。",
				},
				{
					role: "user",
					content: prompt,
				},
			],
			temperature: 0.2,
			max_tokens: 200,
		}),
	});

	if (!response.ok) {
		const detail = await readUpstreamFailure(response);
		throw new Error(
			buildUpstreamFailureMessage({
				status: response.status,
				statusText: response.statusText,
				model,
				detail,
			}),
		);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const content = payload.choices?.[0]?.message?.content ?? "";
	const tags = parseTagsFromText(content);
	if (tags.length === 0) {
		throw new Error("模型未返回可用标签。");
	}
	return tags;
}

export const POST: APIRoute = async ({ request }) => {
	let payload: { docIds?: string[] };
	try {
		payload = (await request.json()) as { docIds?: string[] };
	} catch {
		return jsonError("请求体不是合法 JSON。", 400);
	}

	const docIds = Array.isArray(payload?.docIds)
		? payload.docIds.map((id) => id.trim()).filter(Boolean)
		: [];
	const uniqueDocIds = Array.from(new Set(docIds)).slice(0, MAX_DOCS);

	if (uniqueDocIds.length === 0) {
		return jsonError("请先选择至少 1 篇文档。", 400);
	}

	try {
		const aiConfig = getAiConfig();
		await ensureAiModelAvailable(aiConfig);

		const docs = await getDocsByIds(uniqueDocIds);
		if (docs.length === 0) {
			return jsonError("未找到可用文档。", 400);
		}

		const contents = await Promise.all(
			docs.map(async (doc) => {
				const { content } = await exportDocMarkdown(doc.id);
				return {
					title: doc.title,
					content: content.slice(0, MAX_CHARS_PER_DOC),
				};
			}),
		);

		const prompt = `请从以下文章内容中提取 3-8 个中文标签，要求短、稳定、去重。\n仅输出 JSON 数组，例如：["标签1","标签2"]。\n\n${contents
			.map(
				(item, index) => `【文章${index + 1}】${item.title}\n${item.content}`,
			)
			.join("\n\n---\n\n")}`;

		const tags = await callTagsModel(prompt, aiConfig);
		return jsonOk({ tags });
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
