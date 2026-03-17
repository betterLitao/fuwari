import type { APIRoute } from "astro";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { getAiConfig } from "@/utils/admin/ai";
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
	const bracketMatch = trimmed.match(/\[[\s\S]*\]/);
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
			.replace(/[\[\]"]/g, "")
			.split(/[,\n]/)
			.map((item) => item.trim())
			.filter(Boolean),
	);
}

async function callTagsModel(prompt: string) {
	const { baseUrl, apiKey, model } = getAiConfig();
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
		throw new Error(`模型请求失败：${response.status} ${response.statusText}`);
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

		const prompt = `请从以下文章内容中提取 3-8 个中文标签，要求短、稳定、去重。\n仅输出 JSON 数组，例如：[\"标签1\",\"标签2\"]。\n\n${contents
			.map(
				(item, index) => `【文章${index + 1}】${item.title}\n${item.content}`,
			)
			.join("\n\n---\n\n")}`;

		const tags = await callTagsModel(prompt);
		return jsonOk({ tags });
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
