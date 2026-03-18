<script lang="ts">
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { onDestroy, onMount } from "svelte";
import type {
	AdminSessionResponse,
	ApiResponse,
	ImportDocNode,
	ImportHistoryResponse,
	ImportJobRecord,
	ImportJobResult,
	ImportLocalContentResponse,
	ImportPreviewItem,
	ImportStatus,
	ImportTreeNode,
	NotebooksResponse,
	SearchResponse,
	SlugPolicy,
	SyncMode,
	TreeResponse,
} from "@/types/admin";
import { url } from "@/utils/url-utils";

type TreeRow = { node: ImportTreeNode; depth: number };

export let adminUser = "";

const statusMeta: Record<
	ImportStatus,
	{ label: string; tone: string; dot: string }
> = {
	new: {
		label: "未导入",
		tone: "border-[#d6d3c9] bg-[#f3f0e7] text-[#4a4a42] dark:border-[#2f3733] dark:bg-[#1c221f] dark:text-[#d7ddd7]",
		dot: "bg-[#7f7d74] dark:bg-[#b4beb4]",
	},
	synced: {
		label: "已同步",
		tone: "border-[#cfe1d3] bg-[#edf5ef] text-[#29503a] dark:border-[#254334] dark:bg-[#18241d] dark:text-[#acd1bc]",
		dot: "bg-[#3f7b57] dark:bg-[#69a07f]",
	},
	updated: {
		label: "源有更新",
		tone: "border-[#e4d2b8] bg-[#f7efe3] text-[#7b5622] dark:border-[#4b3720] dark:bg-[#241d15] dark:text-[#d7b37f]",
		dot: "bg-[#ac7a38] dark:bg-[#d3a86f]",
	},
	conflict: {
		label: "需人工处理",
		tone: "border-[#e5c5c5] bg-[#f8ecec] text-[#7f3535] dark:border-[#4a2626] dark:bg-[#261818] dark:text-[#d79d9d]",
		dot: "bg-[#aa4f4f] dark:bg-[#d18a8a]",
	},
};

const syncModeMeta: Record<SyncMode, { title: string; desc: string }> = {
	sync: { title: "增量同步", desc: "有变化就更新，无变化就跳过。" },
	create_only: { title: "仅创建新文章", desc: "已导入文章不再处理。" },
	force_overwrite: {
		title: "强制覆盖同步区",
		desc: "重写 SYNC 区块，保留 LOCAL 区块。",
	},
};

const notebooksApiPath = url("/api/admin/siyuan/notebooks/");
const historyApiPath = url("/api/admin/import/history/");
const localContentApiPath = url("/api/admin/import/local-content/");
const treeApiPath = url("/api/admin/siyuan/tree/");
const jobsApiPath = url("/api/admin/import/jobs/");
const logoutApiPath = url("/api/admin/auth/logout/");
const searchApiPath = url("/api/admin/siyuan/search/");
const tagsAiApiPath = url("/api/admin/ai/tags/");
const loginPagePath = url("/admin/login/");
const previewApiPath = url("/api/admin/siyuan/preview/");

let ready = false;
let query = "";
let recursive = true;
let syncMode: SyncMode = "sync";
let draft = false;
let slugPolicy: SlugPolicy = "stable";
let category = "";
let tagsInput = "";
let publishedAt = "";
let slug = "";
let localBlockNote = "尾部补充说明、相关阅读和 CTA 固定放在 LOCAL 区块。";
let localContentDraft = "";
let localContentMessage = "请选择 1 篇文档后编辑 LOCAL。";
let localContentState: "managed" | "broken" | "absent" | "" = "";
let localContentLoadedDocId = "";
let localContentWatchDocId = "";
let localContentLoading = false;
let localContentError = "";
let localContentController: AbortController | null = null;
let tagAiLoading = false;
let tagAiError = "";

let notebooks: ImportTreeNode[] = [];
let expandedIds: string[] = [];
let loadingNodeIds: string[] = [];
let treeError = "";
let notebooksLoading = true;

let searchResults: ImportDocNode[] = [];
let searchError = "";
let searchLoading = false;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchController: AbortController | null = null;
let historyLoading = true;
let historyError = "";
let loggingOut = false;

let selectionSources: Record<string, string[]> = {};
let selectedDocsById: Record<string, ImportDocNode> = {};
let activeBranchKeys: string[] = [];
let rows: TreeRow[] = [];
let selectedDocs: ImportDocNode[] = [];
let recommendedTags: string[] = [];
let notebookNames: string[] = [];
let stats: { newCount: number; updatedCount: number; conflictCount: number } = {
	newCount: 0,
	updatedCount: 0,
	conflictCount: 0,
};

let jobs: ImportJobRecord[] = [];
let previewItems: ImportPreviewItem[] = [];
let latestSummary: ImportJobResult["summary"] | null = null;
let writable = false;
let runningAction: "dryRun" | "sync" | null = null;
let previewOpen = false;
let previewLoading = false;
let previewError = "";
let previewDocId: string | null = null;
let previewTitle = "";
let previewHPath = "";
let previewHtml = "";
let previewCache: Record<
	string,
	{ title: string; hPath: string; html: string }
> = {};

const touched = { category: false, tags: false, published: false, slug: false };

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : "请求失败，请稍后重试。";

const parseTags = (input: string) =>
	input
		.split(/[,\n]/)
		.map((item) => item.trim())
		.filter(Boolean);

const buildSlug = (title: string, docId: string) => {
	const normalized = title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || `doc-${docId}`;
};

const markdownRenderer = new MarkdownIt({
	html: false,
	linkify: true,
	breaks: true,
});

const sanitizeOptions = {
	allowedTags: [
		"a",
		"img",
		"p",
		"br",
		"strong",
		"em",
		"code",
		"pre",
		"blockquote",
		"ul",
		"ol",
		"li",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"hr",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
	],
	allowedAttributes: {
		a: ["href", "title", "target", "rel"],
		code: ["class"],
		img: ["src", "alt", "title", "width", "height", "loading"],
		pre: ["class"],
	},
	allowedSchemesByTag: {
		img: ["http", "https", "data"],
	},
};

const renderMarkdown = (content: string) =>
	sanitizeHtml(markdownRenderer.render(content), sanitizeOptions);

const collectDocs = (nodes: ImportTreeNode[]): ImportDocNode[] =>
	nodes.flatMap((node) =>
		node.kind === "notebook"
			? collectDocs(node.children)
			: [node, ...collectDocs(node.children)],
	);

const flattenTree = (
	nodes: ImportTreeNode[],
	expanded: string[],
	depth = 0,
): TreeRow[] =>
	nodes.flatMap((node) => {
		const rows = [{ node, depth }];
		return expanded.includes(node.id) && node.children.length > 0
			? [...rows, ...flattenTree(node.children, expanded, depth + 1)]
			: rows;
	});

const updateNode = (
	nodes: ImportTreeNode[],
	targetId: string,
	updater: (node: ImportTreeNode) => ImportTreeNode,
): ImportTreeNode[] =>
	nodes.map((node) =>
		node.id === targetId
			? updater(node)
			: node.children.length === 0
				? node
				: {
						...node,
						children: updateNode(
							node.children,
							targetId,
							updater,
						) as ImportDocNode[],
					},
	);

const setNodeLoading = (nodeId: string, loading: boolean) => {
	loadingNodeIds = loading
		? Array.from(new Set([...loadingNodeIds, nodeId]))
		: loadingNodeIds.filter((id) => id !== nodeId);
};

async function readJson<T>(response: Response) {
	const payload = (await response.json()) as ApiResponse<T>;
	if (!payload.ok) throw new Error(payload.error);
	return payload.data;
}

function syncSelectedDocs(nodes: ImportDocNode[]) {
	if (Object.keys(selectedDocsById).length === 0) return;
	const next = { ...selectedDocsById };
	let changed = false;
	for (const node of nodes) {
		if (next[node.id]) {
			next[node.id] = node;
			changed = true;
		}
	}
	if (changed) selectedDocsById = next;
}

async function loadNotebooks() {
	notebooksLoading = true;
	treeError = "";
	try {
		const response = await fetch(notebooksApiPath);
		const data = await readJson<NotebooksResponse>(response);
		notebooks = data.notebooks;
	} catch (error) {
		treeError = errorMessage(error);
	} finally {
		notebooksLoading = false;
	}
}

async function loadHistory() {
	historyLoading = true;
	historyError = "";
	try {
		const response = await fetch(historyApiPath);
		const data = await readJson<ImportHistoryResponse>(response);
		jobs = data.entries.map((entry) => entry.job);
		if (data.entries.length > 0) {
			previewItems = data.entries[0].items;
			latestSummary = data.entries[0].summary;
		}
	} catch (error) {
		historyError = errorMessage(error);
	} finally {
		historyLoading = false;
	}
}

async function loadTree(node: ImportTreeNode, forceRecursive = false) {
	if (!forceRecursive && node.childrenLoaded) return node.children;
	setNodeLoading(node.id, true);
	try {
		const params = new URLSearchParams({
			notebookId: node.notebookId,
			path: node.path,
			recursive: forceRecursive ? "1" : "0",
		});
		const response = await fetch(`${treeApiPath}?${params.toString()}`);
		const data = await readJson<TreeResponse>(response);
		notebooks = updateNode(notebooks, node.id, (current) => ({
			...current,
			children: data.nodes,
			childrenLoaded: true,
		}));
		syncSelectedDocs(collectDocs(data.nodes));
		return data.nodes;
	} finally {
		setNodeLoading(node.id, false);
	}
}

async function toggleExpand(node: ImportTreeNode) {
	if (expandedIds.includes(node.id)) {
		expandedIds = expandedIds.filter((id) => id !== node.id);
		return;
	}
	expandedIds = [...expandedIds, node.id];
	if (node.kind === "notebook" || node.hasChildren) await loadTree(node);
}

function addSource(doc: ImportDocNode, sourceKey: string) {
	const sources = new Set(selectionSources[doc.id] ?? []);
	sources.add(sourceKey);
	selectionSources = { ...selectionSources, [doc.id]: [...sources] };
	selectedDocsById = { ...selectedDocsById, [doc.id]: doc };
}

function removeSource(docId: string, sourceKey: string) {
	const sources = new Set(selectionSources[docId] ?? []);
	if (!sources.has(sourceKey)) return;
	sources.delete(sourceKey);
	const nextSources = { ...selectionSources };
	const nextDocs = { ...selectedDocsById };
	if (sources.size === 0) {
		delete nextSources[docId];
		delete nextDocs[docId];
	} else {
		nextSources[docId] = [...sources];
	}
	selectionSources = nextSources;
	selectedDocsById = nextDocs;
}

function clearBranch(sourceKey: string) {
	for (const docId of Object.keys(selectionSources))
		removeSource(docId, sourceKey);
	activeBranchKeys = activeBranchKeys.filter((item) => item !== sourceKey);
}

async function toggleSelection(node: ImportTreeNode) {
	const branchKey = `branch:${node.id}:${recursive ? "r" : "d"}`;
	if (
		node.kind === "notebook" ||
		(node.kind === "doc" && recursive && node.hasChildren)
	) {
		if (activeBranchKeys.includes(branchKey)) {
			clearBranch(branchKey);
			return;
		}
		const docs =
			node.kind === "notebook"
				? collectDocs(await loadTree(node, recursive))
				: [node, ...collectDocs(await loadTree(node, true))];
		for (const doc of docs) addSource(doc, branchKey);
		activeBranchKeys = [...activeBranchKeys, branchKey];
		return;
	}

	const sourceKey = `doc:${node.id}`;
	if (selectionSources[node.id]?.includes(sourceKey)) {
		removeSource(node.id, sourceKey);
		return;
	}
	if (node.kind === "doc") addSource(node, sourceKey);
}

function isSelected(
	node: ImportTreeNode,
	selectedDocs: Record<string, ImportDocNode>,
	branches: string[],
) {
	return node.kind === "notebook"
		? branches.some((key) => key.startsWith(`branch:${node.id}:`))
		: Boolean(selectedDocs[node.id]);
}

function pushJob(
	label: string,
	status: ImportJobRecord["status"],
	detail: string,
) {
	jobs = [
		{
			id: `JOB-${Date.now().toString().slice(-6)}`,
			label,
			status,
			detail,
			timestamp: new Date().toLocaleTimeString("zh-CN", {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			}),
		},
		...jobs,
	];
}

function applyPreviewStatus(items: ImportPreviewItem[]) {
	const statusMap = new Map(items.map((item) => [item.docId, item.status]));
	const patch = (node: ImportTreeNode): ImportTreeNode =>
		node.kind === "notebook"
			? {
					...node,
					children: node.children.map((child) => patch(child) as ImportDocNode),
				}
			: {
					...node,
					status: statusMap.get(node.id) ?? node.status,
					children: node.children.map((child) => patch(child) as ImportDocNode),
				};
	notebooks = notebooks.map((node) => patch(node));
	searchResults = searchResults.map((node) => ({
		...node,
		status: statusMap.get(node.id) ?? node.status,
	}));
	selectedDocsById = Object.fromEntries(
		Object.values(selectedDocsById).map((doc) => [
			doc.id,
			{ ...doc, status: statusMap.get(doc.id) ?? doc.status },
		]),
	);
}

async function extractTags() {
	tagAiError = "";
	if (selectedDocs.length === 0) {
		tagAiError = "请先选择至少 1 篇文档。";
		return;
	}
	tagAiLoading = true;
	try {
		const response = await fetch(tagsAiApiPath, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				docIds: selectedDocs.map((doc) => doc.id),
			}),
		});
		const data = await readJson<{ tags: string[] }>(response);
		const currentTags = new Set(parseTags(tagsInput));
		for (const tag of data.tags ?? []) {
			currentTags.add(tag);
		}
		tagsInput = Array.from(currentTags).join(", ");
		touched.tags = true;
	} catch (error) {
		tagAiError = errorMessage(error);
	} finally {
		tagAiLoading = false;
	}
}

function closePreview() {
	previewOpen = false;
}

async function openPreview(node: ImportTreeNode) {
	if (node.kind !== "doc") return;
	const docId = node.id;
	previewOpen = true;
	previewError = "";
	previewDocId = docId;
	previewTitle = node.title;
	previewHPath = node.hPath;

	const cached = previewCache[docId];
	if (cached) {
		previewTitle = cached.title;
		previewHPath = cached.hPath;
		previewHtml = cached.html;
		previewLoading = false;
		return;
	}

	previewHtml = "";
	previewLoading = true;
	try {
		const response = await fetch(
			`${previewApiPath}?id=${encodeURIComponent(docId)}`,
		);
		const data = await readJson<{ content: string; hPath: string }>(response);
		if (previewDocId !== docId) return;
		const html = renderMarkdown(data.content ?? "");
		previewHtml = html;
		previewHPath = data.hPath || node.hPath;
		previewCache = {
			...previewCache,
			[docId]: {
				title: node.title,
				hPath: previewHPath,
				html,
			},
		};
	} catch (error) {
		if (previewDocId !== docId) return;
		previewError = errorMessage(error);
	} finally {
		if (previewDocId === docId) previewLoading = false;
	}
}

function resetLocalContentEditor(message: string) {
	localContentController?.abort();
	localContentController = null;
	localContentLoading = false;
	localContentLoadedDocId = "";
	localContentDraft = "";
	localContentState = "";
	localContentError = "";
	localContentMessage = message;
}

async function loadLocalContent(doc: ImportDocNode) {
	localContentController?.abort();
	const controller = new AbortController();
	localContentController = controller;
	localContentLoading = true;
	localContentError = "";
	localContentMessage = "正在读取本地 LOCAL 区块...";

	try {
		const params = new URLSearchParams({
			docId: doc.id,
		});
		const response = await fetch(`${localContentApiPath}?${params.toString()}`, {
			signal: controller.signal,
		});
		const data = await readJson<ImportLocalContentResponse>(response);
		if (localContentController !== controller) {
			return;
		}

		localContentLoadedDocId = data.docId;
		localContentDraft = data.localContent ?? "";
		localContentState = data.protectedState;
		localContentMessage = data.message;
	} catch (error) {
		if ((error as Error).name !== "AbortError") {
			localContentLoadedDocId = "";
			localContentDraft = "";
			localContentState = "";
			localContentError = errorMessage(error);
			localContentMessage = "LOCAL 内容加载失败，请稍后重试。";
		}
	} finally {
		if (localContentController === controller) {
			localContentController = null;
			localContentLoading = false;
		}
	}
}

async function runJob(dryRun: boolean) {
	if (selectedDocs.length === 0) {
		pushJob(
			dryRun ? "预演失败" : "同步失败",
			"attention",
			"请先选择至少 1 篇文档。",
		);
		return;
	}
	if (
		selectedDocs.length === 1 &&
		(localContentLoading || localContentLoadedDocId !== selectedDocs[0].id)
	) {
		pushJob(
			dryRun ? "预演失败" : "同步失败",
			"attention",
			"单篇 LOCAL 内容仍在加载，请稍候再执行。",
		);
		return;
	}
	runningAction = dryRun ? "dryRun" : "sync";
	try {
		const response = await fetch(jobsApiPath, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				dryRun,
				syncMode,
				docIds: selectedDocs.map((doc) => doc.id),
				metadata: {
					category: category.trim(),
					tags: parseTags(tagsInput),
					publishedAt,
					slug: slug.trim(),
					slugPolicy,
					draft,
					localBlockNote: localBlockNote.trim(),
					localContentOverride:
						selectedDocs.length === 1 ? localContentDraft : undefined,
				},
			}),
		});
		const result = await readJson<ImportJobResult>(response);
		jobs = [result.job, ...jobs];
		previewItems = result.items;
		latestSummary = result.summary;
		writable = result.writable;
		applyPreviewStatus(result.items);
	} catch (error) {
		pushJob(dryRun ? "预演失败" : "同步失败", "attention", errorMessage(error));
	} finally {
		runningAction = null;
	}
}

async function logout() {
	loggingOut = true;
	try {
		const response = await fetch(logoutApiPath, {
			method: "POST",
		});
		const payload =
			(await response.json()) as ApiResponse<AdminSessionResponse>;
		if (!payload.ok) {
			throw new Error(payload.error);
		}
		window.location.href = loginPagePath;
	} catch (error) {
		pushJob("退出失败", "attention", errorMessage(error));
		loggingOut = false;
	}
}

async function runSearch(keyword: string) {
	searchController?.abort();
	const controller = new AbortController();
	searchController = controller;
	searchLoading = true;
	searchError = "";
	try {
		const response = await fetch(
			`${searchApiPath}?keyword=${encodeURIComponent(keyword)}`,
			{
				signal: controller.signal,
			},
		);
		const data = await readJson<SearchResponse>(response);
		searchResults = data.items;
		syncSelectedDocs(data.items);
	} catch (error) {
		if ((error as Error).name !== "AbortError") {
			searchResults = [];
			searchError = errorMessage(error);
		}
	} finally {
		if (searchController === controller) searchLoading = false;
	}
}

onMount(() => {
	ready = true;
	void Promise.all([loadNotebooks(), loadHistory()]);
});

onDestroy(() => {
	if (searchTimer) clearTimeout(searchTimer);
	searchController?.abort();
	localContentController?.abort();
});

$: if (ready) {
	const keyword = query.trim();
	if (searchTimer) clearTimeout(searchTimer);
	if (keyword.length < 2) {
		searchController?.abort();
		searchLoading = false;
		searchError = "";
		searchResults = [];
	} else {
		searchTimer = setTimeout(() => void runSearch(keyword), 260);
	}
}

$: rows = flattenTree(notebooks, expandedIds);
$: selectedDocs = Object.values(selectedDocsById).sort((a, b) =>
	b.updated.localeCompare(a.updated),
);
$: {
	if (selectedDocs.length !== 1) {
		localContentWatchDocId = "";
		resetLocalContentEditor(
			selectedDocs.length === 0
				? "请选择 1 篇文档后编辑 LOCAL。"
				: "当前选中多篇文档，LOCAL 编辑仅支持单篇。",
		);
	} else if (localContentWatchDocId !== selectedDocs[0].id) {
		localContentWatchDocId = selectedDocs[0].id;
		void loadLocalContent(selectedDocs[0]);
	}
}
$: recommendedTags = Array.from(
	new Set(selectedDocs.flatMap((node) => node.tags)),
);
$: notebookNames = Array.from(
	new Set(selectedDocs.map((node) => node.notebookName)),
);
$: stats = {
	newCount: selectedDocs.filter((node) => node.status === "new").length,
	updatedCount: selectedDocs.filter((node) => node.status === "updated").length,
	conflictCount: selectedDocs.filter((node) => node.status === "conflict")
		.length,
};
$: if (!touched.category)
	category =
		selectedDocs.length === 0
			? ""
			: notebookNames.length === 1
				? notebookNames[0]
				: "批量导入";
$: if (!touched.tags) tagsInput = recommendedTags.join(", ");
$: if (!touched.published) publishedAt = "";
$: if (!touched.slug)
	slug =
		selectedDocs.length === 1
			? buildSlug(selectedDocs[0].title, selectedDocs[0].id)
			: "";
</script>

<section class="min-h-[100dvh] bg-[#f3f1ea] px-4 py-6 text-[#161816] dark:bg-[#101311] dark:text-[#eef1eb] sm:px-6 lg:px-8">
	<div class="mx-auto max-w-[1400px] space-y-6">
		<header class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<span class="text-[11px] uppercase tracking-[0.28em] text-[#7d776b] dark:text-[#90a094]">Import Console</span>
				<h1 class="text-2xl font-semibold tracking-[-0.04em]">导入后台</h1>
			</div>
			<div class="flex flex-wrap gap-2 text-xs">
				<span class="rounded-full border border-[#cfe1d3] bg-[#edf5ef] px-3 py-1 text-[#2c593f] dark:border-[#254334] dark:bg-[#18241d] dark:text-[#afd2bf]">思源服务端代理</span>
				<span class="rounded-full border border-[#d9d4c8] bg-white px-3 py-1 text-[#5f5b52] dark:border-[#303934] dark:bg-[#131816] dark:text-[#bbc4bb]">管理鉴权已启用</span>
			</div>
		</header>

		<div class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] items-start">
			<section class="rounded-[2rem] border border-[#d8d2c6] bg-[#fbfaf6] p-5 dark:border-[#262d28] dark:bg-[#161b18]">
				<div class="flex flex-col gap-3 border-b border-[#e6dfd2] pb-5 dark:border-[#232a25] lg:flex-row lg:items-center lg:justify-between">
					<div>
						<div class="text-xs uppercase tracking-[0.28em] text-[#7d776b] dark:text-[#90a094]">源目录</div>
						<h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em]">思源文档树</h2>
					</div>
					<div class="grid gap-3 sm:grid-cols-[1fr_auto]">
						<label class="flex items-center gap-3 rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm dark:border-[#2c3530] dark:bg-[#121713]">
							<span class="font-mono text-[11px] uppercase tracking-[0.2em] text-[#8b8578] dark:text-[#8ea291]">Search</span>
							<input bind:value={query} class="w-full bg-transparent outline-none" placeholder="搜索标题、路径或标签" type="text" />
						</label>
						<label class="flex items-center gap-3 rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm dark:border-[#2c3530] dark:bg-[#121713]">
							<input bind:checked={recursive} class="h-4 w-4 accent-[#3e745e]" type="checkbox" />
							<span>目录递归</span>
						</label>
					</div>
				</div>

				{#if query.trim().length >= 2}
					<div class="mt-5 rounded-[1.5rem] border border-[#e5ddd0] bg-white p-4 dark:border-[#242c27] dark:bg-[#121713]">
						<div class="mb-3 flex items-center justify-between"><div class="text-sm font-medium">搜索结果</div><div class="text-xs text-[#7c766a] dark:text-[#90a094]">{searchLoading ? "检索中" : `${searchResults.length} 条`}</div></div>
						{#if searchError}
							<div class="text-sm text-[#8a4e4e] dark:text-[#d59b9b]">{searchError}</div>
						{:else if searchLoading}
							<div class="text-sm text-[#7a7468] dark:text-[#97a49a]">正在拉取思源搜索结果...</div>
						{:else if searchResults.length === 0}
							<div class="text-sm text-[#7a7468] dark:text-[#97a49a]">没有匹配到文档。</div>
						{:else}
							<div class="space-y-2">
								{#each searchResults as item}
									<button class="w-full rounded-[1.25rem] border border-[#e3dccf] bg-[#faf8f1] px-4 py-3 text-left dark:border-[#28312c] dark:bg-[#141916]" on:click={() => toggleSelection(item)} type="button">
										<div class="flex items-center justify-between gap-3">
											<div class="min-w-0"><div class="truncate text-sm font-medium">{item.title}</div><div class="truncate text-xs text-[#7b7568] dark:text-[#90a094]">{item.notebookName} · {item.updatedLabel}</div></div>
											<span class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${statusMeta[item.status].tone}`}><span class={`h-2 w-2 rounded-full ${statusMeta[item.status].dot}`}></span>{statusMeta[item.status].label}</span>
										</div>
										<div class="mt-2 truncate font-mono text-[11px] text-[#90897c] dark:text-[#738476]">{item.hPath}</div>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<div class="mt-5 rounded-[1.5rem] border border-[#e5ddd0] bg-[#f7f4ec] p-3 dark:border-[#242c27] dark:bg-[#131816]">
					<div class="mb-3 flex items-center justify-between px-2"><div class="text-sm font-medium">目录与文档</div><div class="text-xs text-[#7b7568] dark:text-[#8ea291]">{rows.length} 个可见节点</div></div>
					{#if treeError}
						<div class="px-2 text-sm text-[#8a4e4e] dark:text-[#d59b9b]">{treeError}</div>
					{:else if notebooksLoading}
						<div class="px-2 text-sm text-[#7a7468] dark:text-[#97a49a]">正在连接思源并加载笔记本...</div>
					{:else if rows.length === 0}
						<div class="px-2 text-sm text-[#7a7468] dark:text-[#97a49a]">当前没有可展示的目录节点。</div>
					{:else}
						<div class="space-y-2">
							{#each rows as row (row.node.id)}
								<div class={`rounded-[1.25rem] border px-3 py-3 transition ${isSelected(row.node, selectedDocsById, activeBranchKeys) ? "border-[#bbd2c2] bg-[#eef4ef] dark:border-[#294133] dark:bg-[#16211a]" : "border-[#d8d2c6] bg-white dark:border-[#2c3530] dark:bg-[#121713]"}`} style={`padding-left:${row.depth * 20 + 12}px`}>
									<div class="flex items-center gap-3">
										{#if row.node.kind === "notebook" || row.node.hasChildren}
											<button class="flex h-8 w-8 items-center justify-center rounded-full border border-[#d8d2c6]" on:click={() => toggleExpand(row.node)} type="button">{expandedIds.includes(row.node.id) ? "−" : "+"}</button>
										{:else}
											<div class="flex h-8 w-8 items-center justify-center text-[#8d877a]">•</div>
										{/if}
										<button class={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold ${isSelected(row.node, selectedDocsById, activeBranchKeys) ? "border-[#3f7b57] bg-[#3f7b57] text-white" : "border-[#bfb8aa] text-transparent"}`} on:click={() => toggleSelection(row.node)} type="button">✓</button>
										<div
											class="min-w-0 flex-1 cursor-pointer text-left"
											role="button"
											tabindex="0"
											on:click={() => toggleSelection(row.node)}
											on:keydown={(event) => {
												if (event.key === "Enter" || event.key === " ") {
													event.preventDefault();
													toggleSelection(row.node);
												}
											}}
										>
											<div class="flex items-center justify-between gap-3">
												<div class="min-w-0">
													<div class="truncate text-sm font-medium">{row.node.title}</div>
													<div class="truncate text-xs text-[#7e786b] dark:text-[#8ea291]">{row.node.notebookName}{#if row.node.kind === "doc"} · {row.node.updatedLabel}{/if}{#if loadingNodeIds.includes(row.node.id)} · 加载中{/if}</div>
												</div>
												{#if row.node.kind === "doc"}
													<div class="flex items-center gap-2">
														<button class="rounded-full border border-[#d7d1c5] bg-white px-3 py-1 text-xs text-[#6b655a] transition hover:bg-[#f2eee4] dark:border-[#2c3530] dark:bg-[#121713] dark:text-[#9aa59b] dark:hover:bg-[#1a211d]" on:click|stopPropagation={() => openPreview(row.node)} type="button">预览</button>
														<span class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${statusMeta[row.node.status].tone}`}><span class={`h-2 w-2 rounded-full ${statusMeta[row.node.status].dot}`}></span>{statusMeta[row.node.status].label}</span>
													</div>
												{:else}
													<span class="rounded-full border border-[#d9d4c8] bg-white px-3 py-1 text-xs text-[#5f5b52] dark:border-[#303934] dark:bg-[#131816] dark:text-[#bbc4bb]">笔记本</span>
												{/if}
											</div>
											<div class="mt-2 truncate font-mono text-[11px] text-[#90897c] dark:text-[#738476]">{row.node.kind === "notebook" ? `/${row.node.notebookName}` : row.node.hPath}</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</section>

			<div class="grid gap-6 xl:sticky xl:top-6 self-start">
				<section class="rounded-[2rem] border border-[#d8d2c6] bg-[#fbfaf6] p-5 dark:border-[#262d28] dark:bg-[#161b18]">
					<div class="flex flex-wrap items-start justify-between gap-4 border-b border-[#e6dfd2] pb-4 dark:border-[#232a25]">
						<div>
							<div class="text-xs uppercase tracking-[0.28em] text-[#7d776b] dark:text-[#90a094]">发布配置</div>
							<h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em]">元数据与同步规则</h2>
						</div>
						<div class="flex items-center gap-2">
							<div class="rounded-full border border-[#d9d4c8] bg-white px-3 py-1 text-xs text-[#5f5b52] dark:border-[#303934] dark:bg-[#131816] dark:text-[#bbc4bb]">
								当前用户：{adminUser || "admin"}
							</div>
							<button class="rounded-full border border-[#d9d4c8] bg-white px-3 py-1 text-xs text-[#5f5b52] transition hover:bg-[#f3efe6] disabled:opacity-50 dark:border-[#303934] dark:bg-[#131816] dark:text-[#bbc4bb] dark:hover:bg-[#1a211d]" disabled={loggingOut} on:click={logout} type="button">
								{loggingOut ? "退出中..." : "退出登录"}
							</button>
						</div>
					</div>

					<div class="mt-4 rounded-[1.5rem] border border-[#e5ddd0] bg-[#f7f4ec] p-4 dark:border-[#242c27] dark:bg-[#131816]">
						<div class="flex flex-wrap items-start justify-between gap-4">
							<div class="min-w-0">
								<div class="text-xs uppercase tracking-[0.28em] text-[#7d776b] dark:text-[#90a094]">执行协议</div>
								<div class="mt-2 text-lg font-semibold">{syncModeMeta[syncMode].title}</div>
								<div class="mt-1 text-sm text-[#6d675c] dark:text-[#9cab9f]">{syncModeMeta[syncMode].desc}</div>
							</div>
						</div>
						<div class="mt-3 grid gap-3 sm:grid-cols-3">
							<div class="rounded-[1.1rem] border border-[#d8d2c6] bg-white p-3 dark:border-[#2c3530] dark:bg-[#121713]"><div class="text-[11px] uppercase tracking-[0.24em] text-[#7d776b] dark:text-[#8ea291]">本次选中</div><div class="mt-2 text-2xl font-semibold">{selectedDocs.length}</div></div>
							<div class="rounded-[1.1rem] border border-[#d8d2c6] bg-white p-3 dark:border-[#2c3530] dark:bg-[#121713]"><div class="text-[11px] uppercase tracking-[0.24em] text-[#7d776b] dark:text-[#8ea291]">待更新</div><div class="mt-2 text-2xl font-semibold">{stats.updatedCount}</div></div>
							<div class="rounded-[1.1rem] border border-[#d8d2c6] bg-white p-3 dark:border-[#2c3530] dark:bg-[#121713]"><div class="text-[11px] uppercase tracking-[0.24em] text-[#7d776b] dark:text-[#8ea291]">风险文档</div><div class="mt-2 text-2xl font-semibold">{stats.conflictCount}</div></div>
						</div>
					</div>

					<div class="mt-5 grid gap-4">
						<input bind:value={category} class="rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]" on:input={() => (touched.category = true)} placeholder="分类" type="text" />
						<div class="space-y-2">
							<div class="flex flex-col gap-2 sm:flex-row">
								<input bind:value={tagsInput} class="flex-1 rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]" on:input={() => { touched.tags = true; tagAiError = ""; }} placeholder="标签，逗号分隔" type="text" />
								<button class="rounded-[1.25rem] border border-[#cfe1d3] bg-[#edf5ef] px-4 py-3 text-sm text-[#2c593f] transition hover:bg-[#e3efe6] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#294133] dark:bg-[#16211a] dark:text-[#afd2bf]" disabled={tagAiLoading || selectedDocs.length === 0} on:click={extractTags} type="button">
									{tagAiLoading ? "提取中..." : "AI 提取"}
								</button>
							</div>
							{#if tagAiError}
								<div class="text-xs text-[#8a4e4e] dark:text-[#d59b9b]">{tagAiError}</div>
							{/if}
						</div>
						<div class="grid gap-4 md:grid-cols-2">
							<div class="grid gap-2">
								<input bind:value={publishedAt} class="rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]" on:input={() => (touched.published = true)} type="date" />
								<div class="px-1 text-xs text-[#7d776b] dark:text-[#90a094]">不再自动补时间。新导入文档请手动选择发布日期，已导入文档留空会沿用原值。</div>
							</div>
							<input bind:value={slug} class="rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none disabled:opacity-50 dark:border-[#2c3530] dark:bg-[#121713]" disabled={selectedDocs.length !== 1} on:input={() => (touched.slug = true)} placeholder="Slug" type="text" />
						</div>
						<div class="grid gap-2">
							{#each Object.entries(syncModeMeta) as [mode, meta]}
								<button class={`rounded-[1.25rem] border px-4 py-4 text-left ${syncMode === mode ? "border-[#c6d7cc] bg-[#eef5ef] dark:border-[#294133] dark:bg-[#16211a]" : "border-[#ddd6c9] bg-white dark:border-[#2c3530] dark:bg-[#121713]"}`} on:click={() => (syncMode = mode as SyncMode)} type="button">
									<div class="flex items-center justify-between gap-3"><div class="text-sm font-medium">{meta.title}</div><div class="font-mono text-[11px] uppercase tracking-[0.22em] text-[#7d776b] dark:text-[#90a094]">{mode}</div></div>
									<div class="mt-2 text-sm text-[#6d675c] dark:text-[#9cab9f]">{meta.desc}</div>
								</button>
							{/each}
						</div>
						<div class="grid gap-4 md:grid-cols-2">
							<label class="flex items-center justify-between rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm dark:border-[#2c3530] dark:bg-[#121713]"><span>草稿导入</span><input bind:checked={draft} class="h-4 w-4 accent-[#3e745e]" type="checkbox" /></label>
							<select bind:value={slugPolicy} class="rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]"><option value="stable">首次生成后固定</option><option value="manual">单篇手动指定</option><option value="title">跟随标题重算</option></select>
						</div>
						<div class="rounded-[1.25rem] border border-[#ddd6c9] bg-white p-4 dark:border-[#2c3530] dark:bg-[#121713]">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="text-sm font-medium">文档编辑（LOCAL）</div>
								<span class="rounded-full border border-[#d8d2c6] bg-[#f7f4ec] px-2 py-1 text-[11px] text-[#6f695d] dark:border-[#2c3530] dark:bg-[#171d19] dark:text-[#95a79b]">
									仅单篇 · 始终覆盖
								</span>
							</div>
							<div class="mt-2 text-xs text-[#7d776b] dark:text-[#90a094]">
								{localContentLoading ? "正在读取..." : localContentMessage}
							</div>
							{#if localContentError}
								<div class="mt-2 text-xs text-[#8a4e4e] dark:text-[#d59b9b]">{localContentError}</div>
							{/if}
							{#if localContentState}
								<div class="mt-2 text-xs text-[#7d776b] dark:text-[#90a094]">保护区状态：{localContentState}</div>
							{/if}
							<textarea
								bind:value={localContentDraft}
								class="mt-3 min-h-[150px] w-full rounded-[1rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#2c3530] dark:bg-[#121713]"
								disabled={selectedDocs.length !== 1 || localContentLoading}
								placeholder={
									selectedDocs.length === 1
										? "输入这篇文章的 LOCAL 区块内容，执行导入时会覆盖写入。"
										: "仅单篇可编辑"
								}
							></textarea>
						</div>
						<div class="grid gap-2">
							<div class="text-xs uppercase tracking-[0.24em] text-[#7d776b] dark:text-[#90a094]">批量默认 LOCAL 说明</div>
							<textarea bind:value={localBlockNote} class="min-h-[110px] rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]"></textarea>
							<div class="px-1 text-xs text-[#7d776b] dark:text-[#90a094]">当一次选择多篇文档时，仍使用这里的内容作为新文档 LOCAL 默认值。</div>
						</div>
						<div class="rounded-[1.25rem] border border-[#ddd6c9] bg-white p-4 text-sm dark:border-[#2c3530] dark:bg-[#121713]">{selectedDocs.length === 0 ? "等待文档选择" : `来源建议：${notebookNames.join(" / ") || "未识别"}`}</div>
					</div>

					<div class="mt-6 border-t border-[#e6dfd2] pt-5 dark:border-[#232a25]">
						<div class="flex flex-wrap items-end justify-between gap-4">
							<div><div class="text-xs uppercase tracking-[0.28em] text-[#7d776b] dark:text-[#90a094]">任务流</div><h2 class="mt-2 text-xl font-semibold tracking-[-0.04em]">预演与同步</h2></div>
							<div class="flex flex-wrap gap-3">
								<button class="rounded-full border border-[#d9d4c8] bg-white px-4 py-2 text-sm transition hover:bg-[#f3efe6] disabled:opacity-50 dark:border-[#303934] dark:bg-[#131816] dark:hover:bg-[#1a211d]" disabled={runningAction !== null || (selectedDocs.length === 1 && (localContentLoading || localContentLoadedDocId !== selectedDocs[0].id))} on:click={() => runJob(true)} type="button">{runningAction === "dryRun" ? "预演中..." : "Dry Run"}</button>
								<button class="rounded-full border border-[#386f59] bg-[#386f59] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={runningAction !== null || (selectedDocs.length === 1 && (localContentLoading || localContentLoadedDocId !== selectedDocs[0].id))} on:click={() => runJob(false)} type="button">{runningAction === "sync" ? "执行中..." : "执行同步"}</button>
							</div>
						</div>
						{#if latestSummary}
							<div class="mt-4 rounded-[1.25rem] border border-[#e5ddd0] bg-white p-4 text-sm text-[#5f5a4f] dark:border-[#242c27] dark:bg-[#121713] dark:text-[#b9c4ba]">共 {latestSummary.total} 篇，新增 {latestSummary.newCount}，更新 {latestSummary.updatedCount}，跳过 {latestSummary.syncedCount}，阻断 {latestSummary.conflictCount}{#if !writable}<div class="mt-2 text-xs text-[#9b6b35] dark:text-[#d7b37f]">当前版本只生成预演和执行计划，真实写入器还没接。</div>{/if}</div>
						{/if}
						<div class="mt-4 space-y-3">
							{#if historyError}
								<div class="text-sm text-[#8a4e4e] dark:text-[#d59b9b]">{historyError}</div>
							{:else if historyLoading && jobs.length === 0}
								<div class="text-sm text-[#7a7468] dark:text-[#97a49a]">正在加载历史任务...</div>
							{:else if jobs.length === 0}
								<div class="text-sm text-[#7a7468] dark:text-[#97a49a]">还没有任务记录，先跑一次 Dry Run。</div>
							{:else}
								{#each jobs as job}
									<div class="rounded-[1.25rem] border border-[#e5ddd0] bg-white px-4 py-4 dark:border-[#242c27] dark:bg-[#121713]">
										<div class="flex items-center justify-between gap-3"><div class="flex items-center gap-3"><span class={`h-2.5 w-2.5 rounded-full ${job.status === "success" ? "bg-[#88b298]" : job.status === "attention" ? "bg-[#d7b37f]" : job.status === "queued" ? "bg-[#99a9a1]" : "bg-[#5f8d74]"}`}></span><div class="text-sm font-medium">{job.label}</div></div><div class="font-mono text-[11px] uppercase tracking-[0.2em] text-[#7d776b] dark:text-[#92a095]">{job.id} · {job.timestamp}</div></div>
										<div class="mt-2 text-sm leading-7 text-[#6d675c] dark:text-[#b8c3b9]">{job.detail}</div>
									</div>
								{/each}
							{/if}
						</div>
						{#if previewItems.length > 0}
							<div class="mt-4 space-y-3">
								{#each previewItems as item}
									<div class="rounded-[1.25rem] border border-[#e5ddd0] bg-white px-4 py-4 dark:border-[#242c27] dark:bg-[#121713]">
										<div class="flex items-center justify-between gap-3"><div class="min-w-0"><div class="truncate text-sm font-medium">{item.title}</div><div class="truncate text-xs text-[#7d776b] dark:text-[#92a095]">{item.notebookName} · {item.hPath}</div></div><span class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${statusMeta[item.status].tone}`}><span class={`h-2 w-2 rounded-full ${statusMeta[item.status].dot}`}></span>{statusMeta[item.status].label}</span></div>
										<div class="mt-3 text-sm leading-7 text-[#6d675c] dark:text-[#c2ccc3]">{item.reason}</div>
										<div class="mt-2 font-mono text-[11px] text-[#7d776b] dark:text-[#8ea291]">target: {item.targetPath}</div>
										{#if item.existingPath}<div class="mt-1 font-mono text-[11px] text-[#7d776b] dark:text-[#8ea291]">existing: {item.existingPath}</div>{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</section>
			</div>
		</div>
	</div>

	<div class={`fixed inset-0 z-50 ${previewOpen ? "" : "pointer-events-none"}`}>
		<div class={`absolute inset-0 bg-black/30 transition ${previewOpen ? "opacity-100" : "opacity-0"}`} on:click={closePreview}></div>
		<aside class={`absolute right-0 top-0 flex h-full w-[420px] max-w-[92vw] flex-col border-l border-[#e5ddd0] bg-[#fbfaf6] shadow-2xl transition dark:border-[#242c27] dark:bg-[#121713] ${previewOpen ? "translate-x-0" : "translate-x-full"}`}>
			<div class="flex items-start justify-between gap-4 border-b border-[#e5ddd0] px-5 py-4 dark:border-[#242c27]">
				<div class="min-w-0">
					<div class="text-xs uppercase tracking-[0.28em] text-[#7d776b] dark:text-[#90a094]">文档预览</div>
					<div class="mt-2 truncate text-lg font-semibold">{previewTitle || "未选择文档"}</div>
					{#if previewHPath}
						<div class="mt-1 truncate font-mono text-[11px] text-[#90897c] dark:text-[#8ea291]">{previewHPath}</div>
					{/if}
				</div>
				<button class="rounded-full border border-[#d9d4c8] bg-white px-3 py-1 text-xs text-[#5f5b52] transition hover:bg-[#f3efe6] dark:border-[#303934] dark:bg-[#131816] dark:text-[#bbc4bb] dark:hover:bg-[#1a211d]" on:click={closePreview} type="button">关闭</button>
			</div>
			<div class="flex-1 overflow-y-auto px-5 py-4">
				{#if previewLoading}
					<div class="text-sm text-[#7a7468] dark:text-[#97a49a]">正在加载预览内容...</div>
				{:else if previewError}
					<div class="text-sm text-[#8a4e4e] dark:text-[#d59b9b]">{previewError}</div>
				{:else if previewHtml}
					<div class="prose prose-sm max-w-none text-[#2b2a27] dark:prose-invert dark:text-[#e7ebe6]">
						{@html previewHtml}
					</div>
				{:else}
					<div class="text-sm text-[#7a7468] dark:text-[#97a49a]">请选择一篇文档进行预览。</div>
				{/if}
			</div>
		</aside>
	</div>
</section>
