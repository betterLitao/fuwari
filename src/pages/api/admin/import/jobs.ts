import path from "node:path";
import type { APIRoute } from "astro";
import type {
	ImportDocNode,
	ImportFolderItem,
	ImportHistoryEntry,
	ImportJobRequest,
	ImportJobResult,
	ImportPreviewItem,
	ImportRequestMetadata,
	SyncMode,
} from "@/types/admin";
import { downloadAndRewriteAssets } from "@/utils/admin/assets";
import { appendImportHistory } from "@/utils/admin/history";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import {
	buildLocalImportIndex,
	type LocalImportedPost,
	readFrontmatterField,
	writeImportedPost,
} from "@/utils/admin/posts";
import {
	buildManagedDocument,
	mergeManagedDocument,
} from "@/utils/admin/protected-blocks";
import { triggerPublishBuild } from "@/utils/admin/publish";
import {
	exportDocMarkdown,
	getDocsByIds,
	listDocTree,
} from "@/utils/admin/siyuan";

export const prerender = false;

interface ImportPlan {
	item: ImportPreviewItem;
	nextContent?: string;
	nextRelativePath?: string;
	previousRelativePath?: string;
	canWrite: boolean;
}

function normalizeText(value: string) {
	return value.trim();
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
	const localContentOverride =
		typeof metadata?.localContentOverride === "string"
			? metadata.localContentOverride
			: undefined;

	return {
		category: normalizeText(metadata?.category ?? ""),
		tags: (metadata?.tags ?? []).map(normalizeText).filter(Boolean),
		publishedAt: normalizeText(metadata?.publishedAt ?? ""),
		slug: normalizeText(metadata?.slug ?? ""),
		slugPolicy: metadata?.slugPolicy ?? "stable",
		draft: Boolean(metadata?.draft),
		localBlockNote: metadata?.localBlockNote?.trim() ?? "",
		localContentOverride,
	};
}

function buildTargetPath(
	doc: ImportDocNode,
	metadata: ImportRequestMetadata,
	singleDoc: boolean,
	existing?: LocalImportedPost,
) {
	const preferredSlug =
		metadata.slugPolicy === "manual" && singleDoc ? metadata.slug : "";
	const generatedSlug = buildSlug(doc.title, doc.id, preferredSlug);

	if (existing && metadata.slugPolicy === "stable") {
		return {
			suggestedSlug: getSlugFromRelativePath(existing.relativePath),
			targetPath: existing.relativePath,
		};
	}

	return {
		suggestedSlug: generatedSlug,
		targetPath: path.posix.join("imported", `${generatedSlug}.md`),
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

async function persistImportHistory(input: {
	job: ImportJobResult["job"];
	items: ImportPreviewItem[];
	summary: ImportJobResult["summary"];
	dryRun: boolean;
	syncMode: SyncMode;
}) {
	const entry: ImportHistoryEntry = {
		job: input.job,
		items: input.items,
		summary: input.summary,
		dryRun: input.dryRun,
		syncMode: input.syncMode,
		createdAt: new Date().toISOString(),
	};

	await appendImportHistory(entry);
}

function markDuplicateTargetPathConflicts(plans: ImportPlan[]) {
	const planIdsByPath = new Map<string, Set<string>>();

	for (const plan of plans) {
		if (!plan.item.targetPath || plan.item.status === "conflict") {
			continue;
		}

		const current =
			planIdsByPath.get(plan.item.targetPath) ?? new Set<string>();
		current.add(plan.item.docId);
		planIdsByPath.set(plan.item.targetPath, current);
	}

	return plans.map((plan) => {
		const duplicateDocIds = planIdsByPath.get(plan.item.targetPath);
		if (!duplicateDocIds || duplicateDocIds.size <= 1) {
			return plan;
		}

		return {
			item: {
				...plan.item,
				status: "conflict",
				action: "block",
				reason: "本批次有多个文档会落到同一个 slug，请手动调整后重试。",
			},
			canWrite: false,
		} satisfies ImportPlan;
	});
}

function buildManagedContent(input: {
	doc: ImportDocNode;
	metadata: ImportRequestMetadata;
	suggestedSlug: string;
	publishedAt: string;
	exportContent: string;
	exportHPath: string;
	existing?: LocalImportedPost;
	localContentOverride?: string;
}) {
	const category = input.metadata.category || input.doc.notebookName;
	const tags =
		input.metadata.tags.length > 0 ? input.metadata.tags : input.doc.tags;
	const common = {
		title: input.doc.title,
		publishedAt: input.publishedAt,
		description: "",
		tags,
		category,
		draft: input.metadata.draft,
		slug: input.suggestedSlug,
		siyuanDocId: input.doc.id,
		siyuanNotebook: input.doc.notebookName,
		siyuanNotebookId: input.doc.notebookId,
		siyuanPath: input.exportHPath || input.doc.hPath,
		siyuanHash: input.doc.hash,
		syncContent: input.exportContent,
	};

	if (!input.existing) {
		return buildManagedDocument({
			...common,
			localContent: input.localContentOverride ?? input.metadata.localBlockNote,
		});
	}

	if (typeof input.localContentOverride === "string") {
		return buildManagedDocument({
			...common,
			localContent: input.localContentOverride,
		});
	}

	return mergeManagedDocument({
		...common,
		existingContent: input.existing.content,
		defaultLocalContent: input.metadata.localBlockNote,
	});
}

function resolvePublishedAt(
	metadata: ImportRequestMetadata,
	existing?: LocalImportedPost,
) {
	const explicit = metadata.publishedAt.trim();
	if (explicit) {
		return explicit;
	}

	if (!existing) {
		return "";
	}

	return readFrontmatterField(existing.content, "published");
}

function buildWritePlan(input: {
	doc: ImportDocNode;
	existing?: LocalImportedPost;
	occupied?: LocalImportedPost;
	targetPath: string;
	suggestedSlug: string;
	exportContent: string;
	exportHPath: string;
	metadata: ImportRequestMetadata;
	syncMode: SyncMode;
	localContentOverride?: string;
}): ImportPlan {
	const {
		doc,
		existing,
		occupied,
		targetPath,
		suggestedSlug,
		metadata,
		syncMode,
		localContentOverride,
	} = input;
	const hasLocalOverride = typeof localContentOverride === "string";
	const docStatus = existing
		? existing.hash === doc.hash
			? "synced"
			: "updated"
		: "new";

	if (occupied?.docId && occupied.docId !== doc.id) {
		return {
			item: {
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
			},
			canWrite: false,
		};
	}

	if (existing && existing.protectedBlockState !== "managed") {
		return {
			item: {
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
			},
			canWrite: false,
		};
	}

	if (!existing) {
		const publishedAt = resolvePublishedAt(metadata);
		if (!publishedAt) {
			return {
				item: {
					docId: doc.id,
					title: doc.title,
					notebookName: doc.notebookName,
					hPath: doc.hPath,
					status: "conflict",
					action: "block",
					reason: "当前已关闭自动补时间；新导入文章请先手动选择发布日期。",
					targetPath,
					existingPath: "",
					suggestedSlug,
					updatedLabel: doc.updatedLabel,
					tags: doc.tags,
				},
				canWrite: false,
			};
		}

		return {
			item: {
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
			},
			nextContent: buildManagedContent({
				doc,
				metadata,
				suggestedSlug,
				publishedAt,
				exportContent: input.exportContent,
				exportHPath: input.exportHPath,
				localContentOverride,
			}),
			nextRelativePath: targetPath,
			canWrite: true,
		};
	}

	if (syncMode === "create_only") {
		return {
			item: {
				docId: doc.id,
				title: doc.title,
				notebookName: doc.notebookName,
				hPath: doc.hPath,
				status: docStatus,
				action: "skip",
				reason: "当前是仅创建新文章模式，已存在的文章全部跳过。",
				targetPath,
				existingPath: existing.relativePath,
				suggestedSlug,
				updatedLabel: doc.updatedLabel,
				tags: doc.tags,
			},
			canWrite: false,
		};
	}

	if (
		existing.hash === doc.hash &&
		syncMode !== "force_overwrite" &&
		!hasLocalOverride
	) {
		return {
			item: {
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
			},
			canWrite: false,
		};
	}

	const publishedAt = resolvePublishedAt(metadata, existing);
	if (!publishedAt) {
		return {
			item: {
				docId: doc.id,
				title: doc.title,
				notebookName: doc.notebookName,
				hPath: doc.hPath,
				status: "conflict",
				action: "block",
				reason:
					"当前已关闭自动补时间；这篇文章缺少发布日期，请手动选择后重试。",
				targetPath,
				existingPath: existing.relativePath,
				suggestedSlug,
				updatedLabel: doc.updatedLabel,
				tags: doc.tags,
			},
			canWrite: false,
		};
	}

	const forceRewrite = syncMode === "force_overwrite";
	const reason =
		hasLocalOverride && existing.hash === doc.hash && !forceRewrite
			? "思源 hash 未变化，但当前是单篇 LOCAL 覆盖模式，会按编辑器内容重写 LOCAL 区块。"
			: forceRewrite && existing.hash === doc.hash
				? "当前是强制覆盖同步区模式，会重新写入受控内容。"
				: forceRewrite
					? "当前是强制覆盖同步区模式，会按最新思源内容重写 SYNC 区块。"
					: hasLocalOverride
						? "检测到思源内容变化，同时启用单篇 LOCAL 覆盖，会重写 SYNC 与 LOCAL 区块。"
						: "检测到思源内容已更新，会重写 SYNC 区块并保留 LOCAL 区块。";

	return {
		item: {
			docId: doc.id,
			title: doc.title,
			notebookName: doc.notebookName,
			hPath: doc.hPath,
			status:
				hasLocalOverride && existing.hash === doc.hash ? "updated" : docStatus,
			action: "update",
			reason,
			targetPath,
			existingPath: existing.relativePath,
			suggestedSlug,
			updatedLabel: doc.updatedLabel,
			tags: doc.tags,
		},
		nextContent: buildManagedContent({
			doc,
			metadata,
			suggestedSlug,
			publishedAt,
			exportContent: input.exportContent,
			exportHPath: input.exportHPath,
			existing,
			localContentOverride,
		}),
		nextRelativePath: targetPath,
		previousRelativePath: existing.relativePath,
		canWrite: true,
	};
}

function collectDocIds(nodes: ImportDocNode[]): string[] {
	return nodes.flatMap((node) => [node.id, ...collectDocIds(node.children)]);
}

async function expandFolders(folders: ImportFolderItem[]): Promise<string[]> {
	if (folders.length === 0) {
		return [];
	}

	const results = await Promise.all(
		folders.map((folder) =>
			listDocTree({
				notebookId: folder.notebookId.trim(),
				path: folder.path?.trim() || "/",
				recursive: folder.recursive ?? true,
			}),
		),
	);

	return results.flatMap(collectDocIds);
}

async function buildPlan(input: {
	doc: ImportDocNode;
	importIndex: Awaited<ReturnType<typeof buildLocalImportIndex>>;
	metadata: ImportRequestMetadata;
	singleDoc: boolean;
	syncMode: SyncMode;
	dryRun: boolean;
	localContentOverride?: string;
}) {
	const {
		doc,
		importIndex,
		metadata,
		singleDoc,
		syncMode,
		dryRun,
		localContentOverride,
	} = input;
	const exportData = await exportDocMarkdown(doc.id);
	const existing = importIndex.byDocId.get(doc.id);
	const target = buildTargetPath(doc, metadata, singleDoc, existing);
	const occupied = importIndex.byRelativePath.get(target.targetPath);

	let exportContent = exportData.content;
	if (!dryRun) {
		const assets = await downloadAndRewriteAssets(
			exportContent,
			target.suggestedSlug,
		);
		exportContent = assets.content;
	}

	return buildWritePlan({
		doc,
		existing,
		occupied,
		targetPath: target.targetPath,
		suggestedSlug: target.suggestedSlug,
		exportContent,
		exportHPath: exportData.hPath,
		metadata,
		syncMode,
		localContentOverride,
	});
}

export const POST: APIRoute = async ({ request }) => {
	let payload: ImportJobRequest;

	try {
		payload = (await request.json()) as ImportJobRequest;
	} catch {
		return jsonError("请求体不是合法 JSON。", 400);
	}

	const directIds = (payload.docIds ?? [])
		.map((id) => id.trim())
		.filter(Boolean);

	const folders: ImportFolderItem[] = (payload.folders ?? []).filter((f) =>
		f.notebookId?.trim(),
	);

	try {
		const folderDocIds = await expandFolders(folders);
		const docIds = Array.from(new Set([...directIds, ...folderDocIds]));

		if (docIds.length === 0) {
			return jsonError("至少选择 1 篇文档后再执行。", 400);
		}

		const metadata = normalizeRequestMetadata(payload.metadata);
		const [docs, importIndex] = await Promise.all([
			getDocsByIds(docIds),
			buildLocalImportIndex(),
		]);

		if (docs.length === 0) {
			return jsonError("没有拉到可导入的思源文档。", 404);
		}

		const singleDoc = docs.length === 1;
		const effectiveMetadata: ImportRequestMetadata = singleDoc
			? metadata
			: {
					...metadata,
					localContentOverride: undefined,
				};
		const singleDocLocalOverride = singleDoc
			? effectiveMetadata.localContentOverride
			: undefined;
		const rawPlans = await Promise.all(
			docs.map((doc) =>
				buildPlan({
					doc,
					importIndex,
					metadata: effectiveMetadata,
					singleDoc,
					syncMode: payload.syncMode,
					dryRun: payload.dryRun,
					localContentOverride: singleDocLocalOverride,
				}),
			),
		);
		const plans = markDuplicateTargetPathConflicts(rawPlans);
		const items = plans.map((plan) => plan.item);
		const summary = summarize(items);
		const hasConflict = summary.conflictCount > 0;
		const writable = true;

		if (payload.dryRun) {
			const result: ImportJobResult = {
				job: {
					id: `JOB-${Date.now().toString().slice(-6)}`,
					label: "导入预演完成",
					status: hasConflict ? "attention" : "success",
					detail: `共 ${summary.total} 篇，新增 ${summary.newCount}，更新 ${summary.updatedCount}，跳过 ${summary.syncedCount}，阻断 ${summary.conflictCount}。`,
					timestamp: toJobTimestamp(),
				},
				items,
				summary,
				writable,
			};

			await persistImportHistory({
				job: result.job,
				items: result.items,
				summary: result.summary,
				dryRun: true,
				syncMode: payload.syncMode,
			});

			return jsonOk(result);
		}

		if (hasConflict) {
			const result: ImportJobResult = {
				job: {
					id: `JOB-${Date.now().toString().slice(-6)}`,
					label: "同步执行已阻断",
					status: "attention",
					detail: `检测到 ${summary.conflictCount} 篇风险文档，整批未执行写入。请先处理冲突再重试。`,
					timestamp: toJobTimestamp(),
				},
				items,
				summary,
				writable,
			};

			await persistImportHistory({
				job: result.job,
				items: result.items,
				summary: result.summary,
				dryRun: false,
				syncMode: payload.syncMode,
			});

			return jsonOk(result);
		}

		for (const plan of plans) {
			if (!plan.canWrite || !plan.nextContent || !plan.nextRelativePath) {
				continue;
			}

			await writeImportedPost({
				relativePath: plan.nextRelativePath,
				content: plan.nextContent,
				previousRelativePath: plan.previousRelativePath,
			});
		}

		const writeCount = plans.filter((plan) => plan.canWrite).length;
		let publishMessage = "当前环境未启用自动发布。";
		try {
			publishMessage = triggerPublishBuild().message;
		} catch (error) {
			publishMessage = `后台发布任务触发失败：${getErrorMessage(error)}`;
		}

		const result: ImportJobResult = {
			job: {
				id: `JOB-${Date.now().toString().slice(-6)}`,
				label: "同步执行完成",
				status: "success",
				detail: `已写入 ${writeCount} 篇，新增 ${items.filter((item) => item.action === "create").length}，更新 ${items.filter((item) => item.action === "update").length}，跳过 ${items.filter((item) => item.action === "skip").length}。${publishMessage}`,
				timestamp: toJobTimestamp(),
			},
			items,
			summary,
			writable,
		};

		await persistImportHistory({
			job: result.job,
			items: result.items,
			summary: result.summary,
			dryRun: false,
			syncMode: payload.syncMode,
		});

		return jsonOk(result);
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
