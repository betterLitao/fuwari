import path from "node:path";
import type { APIRoute } from "astro";
import type {
	ImportDocNode,
	ImportJobRequest,
	ImportJobResult,
	ImportPreviewItem,
	ImportRequestMetadata,
} from "@/types/admin";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { buildLocalImportIndex } from "@/utils/admin/posts";
import {
	buildManagedDocument,
	mergeManagedDocument,
} from "@/utils/admin/protected-blocks";
import { exportDocMarkdown, getDocsByIds } from "@/utils/admin/siyuan";

export const prerender = false;

function normalizeText(value: string) {
	return value.trim();
}

function formatDate(raw: string) {
	if (!/^\d{14}$/.test(raw)) {
		return raw;
	}

	return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function buildSlug(title: string, docId: string, manualSlug = "") {
	const preferred = manualSlug.trim() || title;
	const normalized = preferred
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || `doc-${docId}`;
}

function getSlugFromRelativePath(relativePath: string) {
	const withoutExt = relativePath.replace(/\.(md|mdx)$/i, "");
	return withoutExt.endsWith("/index")
		? withoutExt.slice(0, -"/index".length)
		: withoutExt;
}

function toJobTimestamp() {
	return new Intl.DateTimeFormat("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
		timeZone: "Asia/Shanghai",
	}).format(new Date());
}

function normalizeRequestMetadata(
	metadata: Partial<ImportRequestMetadata> | undefined,
): ImportRequestMetadata {
	return {
		category: normalizeText(metadata?.category ?? ""),
		tags: (metadata?.tags ?? []).map(normalizeText).filter(Boolean),
		publishedAt: normalizeText(metadata?.publishedAt ?? ""),
		slug: normalizeText(metadata?.slug ?? ""),
		slugPolicy: metadata?.slugPolicy ?? "stable",
		draft: Boolean(metadata?.draft),
		localBlockNote: metadata?.localBlockNote?.trim() ?? "",
	};
}

function buildTargetPath(doc: ImportDocNode, metadata: ImportRequestMetadata, singleDoc: boolean) {
	const preferredSlug =
		metadata.slugPolicy === "manual" && singleDoc ? metadata.slug : "";
	const suggestedSlug = buildSlug(doc.title, doc.id, preferredSlug);

	return {
		suggestedSlug,
		targetPath: path.posix.join("imported", `${suggestedSlug}.md`),
	};
}

function summarize(items: ImportPreviewItem[]) {
	return {
		total: items.length,
		newCount: items.filter((item) => item.status === "new").length,
		syncedCount: items.filter((item) => item.status === "synced").length,
		updatedCount: items.filter((item) => item.status === "updated").length,
		conflictCount: items.filter((item) => item.status === "conflict").length,
	};
}

export const POST: APIRoute = async ({ request }) => {
	let payload: ImportJobRequest;

	try {
		payload = (await request.json()) as ImportJobRequest;
	} catch {
		return jsonError("请求体不是合法 JSON。", 400);
	}

	const docIds = Array.from(
		new Set((payload.docIds ?? []).map((docId) => docId.trim()).filter(Boolean)),
	);
	if (docIds.length === 0) {
		return jsonError("至少选择 1 篇文档后再执行。", 400);
	}

	const metadata = normalizeRequestMetadata(payload.metadata);

	try {
		const [docs, importIndex] = await Promise.all([
			getDocsByIds(docIds),
			buildLocalImportIndex(),
		]);

		if (docs.length === 0) {
			return jsonError("没有拉到可导入的思源文档。", 404);
		}

		const singleDoc = docs.length === 1;
		const items = await Promise.all(
			docs.map(async (doc) => {
				const existing = importIndex.byDocId.get(doc.id);
				const exportData = await exportDocMarkdown(doc.id);
				const slugFromExisting = existing?.relativePath
					? getSlugFromRelativePath(existing.relativePath)
					: "";
				const generated = buildTargetPath(doc, metadata, singleDoc);
				const suggestedSlug =
					existing && metadata.slugPolicy === "stable"
						? slugFromExisting
						: generated.suggestedSlug;
				const targetPath =
					existing && metadata.slugPolicy === "stable"
						? existing.relativePath
						: path.posix.join("imported", `${suggestedSlug}.md`);
				const occupied = importIndex.byRelativePath.get(targetPath);

				if (occupied && occupied.docId && occupied.docId !== doc.id) {
					return {
						docId: doc.id,
						title: doc.title,
						notebookName: doc.notebookName,
						hPath: doc.hPath,
						status: "conflict",
						action: "block",
						reason: "目标 slug 已被其他文章占用，先调整 slug 再导入。",
						targetPath,
						existingPath: occupied.relativePath,
						suggestedSlug,
						updatedLabel: doc.updatedLabel,
						tags: doc.tags,
					} satisfies ImportPreviewItem;
				}

				const publishedAt = metadata.publishedAt || formatDate(doc.updated);
				const category = metadata.category || doc.notebookName;
				const tags = metadata.tags.length > 0 ? metadata.tags : doc.tags;

				if (!existing) {
					buildManagedDocument({
						title: doc.title,
						publishedAt,
						updatedAt: formatDate(doc.updated),
						description: "",
						tags,
						category,
						draft: metadata.draft,
						slug: suggestedSlug,
						siyuanDocId: doc.id,
						siyuanNotebook: doc.notebookName,
						siyuanNotebookId: doc.notebookId,
						siyuanPath: exportData.hPath || doc.hPath,
						siyuanUpdated: doc.updated,
						siyuanHash: doc.hash,
						syncContent: exportData.content,
						localContent: metadata.localBlockNote,
					});

					return {
						docId: doc.id,
						title: doc.title,
						notebookName: doc.notebookName,
						hPath: doc.hPath,
						status: "new",
						action: "create",
						reason: "本地还没有这篇文章，会按受控结构创建。",
						targetPath,
						existingPath: "",
						suggestedSlug,
						updatedLabel: doc.updatedLabel,
						tags: doc.tags,
					} satisfies ImportPreviewItem;
				}

				if (existing.protectedBlockState !== "managed") {
					return {
						docId: doc.id,
						title: doc.title,
						notebookName: doc.notebookName,
						hPath: doc.hPath,
						status: "conflict",
						action: "block",
						reason: "本地文章缺少完整保护区块，当前策略不会冒险覆盖。",
						targetPath,
						existingPath: existing.relativePath,
						suggestedSlug,
						updatedLabel: doc.updatedLabel,
						tags: doc.tags,
					} satisfies ImportPreviewItem;
				}

				if (existing.hash === doc.hash) {
					return {
						docId: doc.id,
						title: doc.title,
						notebookName: doc.notebookName,
						hPath: doc.hPath,
						status: "synced",
						action: "skip",
						reason: "本地受控文章和思源 hash 一致，本次可以跳过。",
						targetPath,
						existingPath: existing.relativePath,
						suggestedSlug,
						updatedLabel: doc.updatedLabel,
						tags: doc.tags,
					} satisfies ImportPreviewItem;
				}

				mergeManagedDocument({
					existingContent: existing.content,
					title: doc.title,
					publishedAt,
					updatedAt: formatDate(doc.updated),
					description: "",
					tags,
					category,
					draft: metadata.draft,
					slug: suggestedSlug,
					siyuanDocId: doc.id,
					siyuanNotebook: doc.notebookName,
					siyuanNotebookId: doc.notebookId,
					siyuanPath: exportData.hPath || doc.hPath,
					siyuanUpdated: doc.updated,
					siyuanHash: doc.hash,
					syncContent: exportData.content,
					defaultLocalContent: metadata.localBlockNote,
				});

				return {
					docId: doc.id,
					title: doc.title,
					notebookName: doc.notebookName,
					hPath: doc.hPath,
					status: "updated",
					action: "update",
					reason: "检测到思源内容已更新，后续只需要重写 SYNC 区块。",
					targetPath,
					existingPath: existing.relativePath,
					suggestedSlug,
					updatedLabel: doc.updatedLabel,
					tags: doc.tags,
				} satisfies ImportPreviewItem;
			}),
		);

		const summary = summarize(items);
		const hasConflict = summary.conflictCount > 0;
		const label = payload.dryRun ? "导入预演完成" : "同步计划已生成";
		const detail = payload.dryRun
			? `共 ${summary.total} 篇，新增 ${summary.newCount}，更新 ${summary.updatedCount}，跳过 ${summary.syncedCount}，阻断 ${summary.conflictCount}。`
			: hasConflict
				? "检测到保护区或 slug 冲突，已阻断执行计划。"
				: "当前里程碑先生成执行计划，尚未直接写入文章源文件。";
		const result: ImportJobResult = {
			job: {
				id: `JOB-${Date.now().toString().slice(-6)}`,
				label,
				status: hasConflict
					? "attention"
					: payload.dryRun
						? "success"
						: "queued",
				detail,
				timestamp: toJobTimestamp(),
			},
			items,
			summary,
			writable: false,
		};

		return jsonOk(result);
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
