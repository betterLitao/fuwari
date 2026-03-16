<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import type {
		AdminSessionResponse,
		ApiResponse,
		ImportDocNode,
		ImportHistoryResponse,
		ImportJobRecord,
		ImportJobResult,
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

	const statusMeta: Record<ImportStatus, { label: string; tone: string; dot: string }> = {
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
		force_overwrite: { title: "强制覆盖同步区", desc: "重写 SYNC 区块，保留 LOCAL 区块。" },
	};

	const notebooksApiPath = url("/api/admin/siyuan/notebooks/");
	const historyApiPath = url("/api/admin/import/history/");
	const treeApiPath = url("/api/admin/siyuan/tree/");
	const jobsApiPath = url("/api/admin/import/jobs/");
	const logoutApiPath = url("/api/admin/auth/logout/");
	const searchApiPath = url("/api/admin/siyuan/search/");
	const loginPagePath = url("/admin/login/");

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

	let jobs: ImportJobRecord[] = [];
	let previewItems: ImportPreviewItem[] = [];
	let latestSummary: ImportJobResult["summary"] | null = null;
	let writable = false;
	let runningAction: "dryRun" | "sync" | null = null;

	const touched = { category: false, tags: false, published: false, slug: false };

	const errorMessage = (error: unknown) =>
		error instanceof Error ? error.message : "请求失败，请稍后重试。";

	const parseTags = (input: string) =>
		input
			.split(/[,\n]/)
			.map((item) => item.trim())
			.filter(Boolean);

	const formatDate = (raw: string) =>
		/^\d{14}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;

	const buildSlug = (title: string, docId: string) => {
		const normalized = title
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return normalized || `doc-${docId}`;
	};

	const collectDocs = (nodes: ImportTreeNode[]): ImportDocNode[] =>
		nodes.flatMap((node) =>
			node.kind === "notebook" ? collectDocs(node.children) : [node, ...collectDocs(node.children)],
		);

	const flattenTree = (nodes: ImportTreeNode[], depth = 0): TreeRow[] =>
		nodes.flatMap((node) => {
			const rows = [{ node, depth }];
			return expandedIds.includes(node.id) && node.children.length > 0
				? [...rows, ...flattenTree(node.children, depth + 1)]
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
					: { ...node, children: updateNode(node.children, targetId, updater) as ImportDocNode[] },
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
		for (const docId of Object.keys(selectionSources)) removeSource(docId, sourceKey);
		activeBranchKeys = activeBranchKeys.filter((item) => item !== sourceKey);
	}

	async function toggleSelection(node: ImportTreeNode) {
		const branchKey = `branch:${node.id}:${recursive ? "r" : "d"}`;
		if (node.kind === "notebook" || (node.kind === "doc" && recursive && node.hasChildren)) {
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

	function isSelected(node: ImportTreeNode) {
		return node.kind === "notebook"
			? activeBranchKeys.some((key) => key.startsWith(`branch:${node.id}:`))
			: Boolean(selectedDocsById[node.id]);
	}

	function pushJob(label: string, status: ImportJobRecord["status"], detail: string) {
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
				? { ...node, children: node.children.map((child) => patch(child) as ImportDocNode) }
				: {
						...node,
						status: statusMap.get(node.id) ?? node.status,
						children: node.children.map((child) => patch(child) as ImportDocNode),
					};
		notebooks = notebooks.map((node) => patch(node));
		searchResults = searchResults.map((node) => ({ ...node, status: statusMap.get(node.id) ?? node.status }));
		selectedDocsById = Object.fromEntries(
			Object.values(selectedDocsById).map((doc) => [doc.id, { ...doc, status: statusMap.get(doc.id) ?? doc.status }]),
		);
	}

	async function runJob(dryRun: boolean) {
		if (selectedDocs.length === 0) {
			pushJob(dryRun ? "预演失败" : "同步失败", "attention", "请先选择至少 1 篇文档。");
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
			const payload = (await response.json()) as ApiResponse<AdminSessionResponse>;
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
			const response = await fetch(`${searchApiPath}?keyword=${encodeURIComponent(keyword)}`, {
				signal: controller.signal,
			});
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

	$: rows = flattenTree(notebooks);
	$: selectedDocs = Object.values(selectedDocsById).sort((a, b) => b.updated.localeCompare(a.updated));
	$: recommendedTags = Array.from(new Set(selectedDocs.flatMap((node) => node.tags)));
	$: notebookNames = Array.from(new Set(selectedDocs.map((node) => node.notebookName)));
	$: stats = {
		newCount: selectedDocs.filter((node) => node.status === "new").length,
		updatedCount: selectedDocs.filter((node) => node.status === "updated").length,
		conflictCount: selectedDocs.filter((node) => node.status === "conflict").length,
	};
	$: if (!touched.category) category = selectedDocs.length === 0 ? "" : notebookNames.length === 1 ? notebookNames[0] : "批量导入";
	$: if (!touched.tags) tagsInput = recommendedTags.join(", ");
	$: if (!touched.published) publishedAt = selectedDocs[0] ? formatDate(selectedDocs[0].updated) : "";
	$: if (!touched.slug) slug = selectedDocs.length === 1 ? buildSlug(selectedDocs[0].title, selectedDocs[0].id) : "";
</script>

<section class="min-h-[100dvh] bg-[#f3f1ea] px-4 py-6 text-[#161816] dark:bg-[#101311] dark:text-[#eef1eb] sm:px-6 lg:px-8">
	<div class="mx-auto max-w-[1400px] space-y-6">
		<header class="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
			<div class="rounded-[2rem] border border-[#d8d2c6] bg-[#fbfaf6] p-6 dark:border-[#262d28] dark:bg-[#161b18]">
				<div class="mb-4 flex flex-wrap gap-3 text-xs">
					<span class="rounded-full border border-[#d9d4c8] bg-[#f4f1e8] px-3 py-1 uppercase tracking-[0.28em] text-[#676257] dark:border-[#2a322c] dark:bg-[#1a211d] dark:text-[#aab4ab]">Import Console</span>
					<span class="rounded-full border border-[#cfe1d3] bg-[#edf5ef] px-3 py-1 text-[#2c593f] dark:border-[#254334] dark:bg-[#18241d] dark:text-[#afd2bf]">思源服务端代理</span>
					<span class="rounded-full border border-[#d9d4c8] bg-white px-3 py-1 text-[#5f5b52] dark:border-[#303934] dark:bg-[#131816] dark:text-[#bbc4bb]">管理鉴权已启用</span>
				</div>
				<h1 class="max-w-[15ch] text-4xl font-semibold tracking-[-0.045em] md:text-5xl">把思源文档挑出来，再按受控结构发布。</h1>
				<p class="mt-4 max-w-[60ch] text-sm leading-7 text-[#5f5a4f] dark:text-[#a9b2a8]">这版已经接上真实目录树、服务端搜索和实际落盘导入。Token 不出浏览器，状态也不再靠 mock。</p>
			</div>
			<div class="grid gap-4 rounded-[2rem] border border-[#29322d] bg-[#161816] p-6 text-[#edf0eb]">
				<div class="flex items-start justify-between gap-4">
					<div>
					<div class="text-xs uppercase tracking-[0.3em] text-[#8ea291]">执行协议</div>
					<div class="mt-3 text-2xl font-semibold">{syncModeMeta[syncMode].title}</div>
					<div class="mt-2 text-sm leading-7 text-[#b6c1b7]">{syncModeMeta[syncMode].desc}</div>
					</div>
					<div class="flex flex-col items-end gap-3">
						<div class="rounded-full border border-white/10 px-3 py-1 text-xs text-[#cfd8cf]">
							当前用户：{adminUser || "admin"}
						</div>
						<button class="rounded-full border border-white/10 px-3 py-2 text-xs text-[#d9e2da] transition hover:bg-white/5 disabled:opacity-50" disabled={loggingOut} on:click={logout} type="button">
							{loggingOut ? "退出中..." : "退出登录"}
						</button>
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
					<div class="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><div class="text-[11px] uppercase tracking-[0.24em] text-[#8ea291]">本次选中</div><div class="mt-2 text-3xl font-semibold">{selectedDocs.length}</div></div>
					<div class="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><div class="text-[11px] uppercase tracking-[0.24em] text-[#8ea291]">待更新</div><div class="mt-2 text-3xl font-semibold">{stats.updatedCount}</div></div>
					<div class="rounded-[1.5rem] border border-white/10 bg-white/5 p-4"><div class="text-[11px] uppercase tracking-[0.24em] text-[#8ea291]">风险文档</div><div class="mt-2 text-3xl font-semibold">{stats.conflictCount}</div></div>
				</div>
			</div>
		</header>

		<div class="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
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
							{#each rows as row}
								<div class={`rounded-[1.25rem] border px-3 py-3 transition ${isSelected(row.node) ? "border-[#bbd2c2] bg-[#eef4ef] dark:border-[#294133] dark:bg-[#16211a]" : "border-[#d8d2c6] bg-white dark:border-[#2c3530] dark:bg-[#121713]"}`} style={`padding-left:${row.depth * 20 + 12}px`}>
									<div class="flex items-center gap-3">
										{#if row.node.kind === "notebook" || row.node.hasChildren}
											<button class="flex h-8 w-8 items-center justify-center rounded-full border border-[#d8d2c6]" on:click={() => toggleExpand(row.node)} type="button">{expandedIds.includes(row.node.id) ? "−" : "+"}</button>
										{:else}
											<div class="flex h-8 w-8 items-center justify-center text-[#8d877a]">•</div>
										{/if}
										<button class={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold ${isSelected(row.node) ? "border-[#3f7b57] bg-[#3f7b57] text-white" : "border-[#bfb8aa] text-transparent"}`} on:click={() => toggleSelection(row.node)} type="button">✓</button>
										<button class="min-w-0 flex-1 text-left" on:click={() => toggleSelection(row.node)} type="button">
											<div class="flex items-center justify-between gap-3">
												<div class="min-w-0">
													<div class="truncate text-sm font-medium">{row.node.title}</div>
													<div class="truncate text-xs text-[#7e786b] dark:text-[#8ea291]">{row.node.notebookName}{#if row.node.kind === "doc"} · {row.node.updatedLabel}{/if}{#if loadingNodeIds.includes(row.node.id)} · 加载中{/if}</div>
												</div>
												{#if row.node.kind === "doc"}
													<span class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${statusMeta[row.node.status].tone}`}><span class={`h-2 w-2 rounded-full ${statusMeta[row.node.status].dot}`}></span>{statusMeta[row.node.status].label}</span>
												{:else}
													<span class="rounded-full border border-[#d9d4c8] bg-white px-3 py-1 text-xs text-[#5f5b52] dark:border-[#303934] dark:bg-[#131816] dark:text-[#bbc4bb]">笔记本</span>
												{/if}
											</div>
											<div class="mt-2 truncate font-mono text-[11px] text-[#90897c] dark:text-[#738476]">{row.node.kind === "notebook" ? `/${row.node.notebookName}` : row.node.hPath}</div>
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</section>

			<div class="grid gap-6">
				<section class="rounded-[2rem] border border-[#d8d2c6] bg-[#fbfaf6] p-5 dark:border-[#262d28] dark:bg-[#161b18]">
					<div class="border-b border-[#e6dfd2] pb-5 dark:border-[#232a25]"><div class="text-xs uppercase tracking-[0.28em] text-[#7d776b] dark:text-[#90a094]">发布配置</div><h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em]">元数据与同步规则</h2></div>
					<div class="mt-5 grid gap-4">
						<input bind:value={category} class="rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]" on:input={() => (touched.category = true)} placeholder="分类" type="text" />
						<input bind:value={tagsInput} class="rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]" on:input={() => (touched.tags = true)} placeholder="标签，逗号分隔" type="text" />
						<div class="grid gap-4 md:grid-cols-2">
							<input bind:value={publishedAt} class="rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]" on:input={() => (touched.published = true)} type="date" />
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
						<textarea bind:value={localBlockNote} class="min-h-[110px] rounded-[1.25rem] border border-[#ddd6c9] bg-white px-4 py-3 text-sm outline-none dark:border-[#2c3530] dark:bg-[#121713]"></textarea>
						<div class="rounded-[1.25rem] border border-[#ddd6c9] bg-white p-4 text-sm dark:border-[#2c3530] dark:bg-[#121713]">{selectedDocs.length === 0 ? "等待文档选择" : `来源建议：${notebookNames.join(" / ") || "未识别"}`}</div>
					</div>
				</section>

				<section class="rounded-[2rem] border border-[#d8d2c6] bg-[#161816] p-5 text-[#edf0eb] dark:border-[#29322d]">
					<div class="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
						<div><div class="text-xs uppercase tracking-[0.28em] text-[#8ea291]">任务流</div><h2 class="mt-2 text-2xl font-semibold tracking-[-0.04em]">预演与同步</h2></div>
						<div class="flex flex-wrap gap-3">
							<button class="rounded-full border border-white/10 px-4 py-2 text-sm disabled:opacity-50" disabled={runningAction !== null} on:click={() => runJob(true)} type="button">{runningAction === "dryRun" ? "预演中..." : "Dry Run"}</button>
							<button class="rounded-full border border-[#386f59] bg-[#386f59] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={runningAction !== null} on:click={() => runJob(false)} type="button">{runningAction === "sync" ? "执行中..." : "执行同步"}</button>
						</div>
					</div>
					{#if latestSummary}
						<div class="mt-4 rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-[#c2ccc3]">共 {latestSummary.total} 篇，新增 {latestSummary.newCount}，更新 {latestSummary.updatedCount}，跳过 {latestSummary.syncedCount}，阻断 {latestSummary.conflictCount}{#if !writable}<div class="mt-2 text-xs text-[#d7b37f]">当前版本只生成预演和执行计划，真实写入器还没接。</div>{/if}</div>
					{/if}
					<div class="mt-4 space-y-3">
						{#if historyError}
							<div class="text-sm text-[#e0b0a0]">{historyError}</div>
						{:else if historyLoading && jobs.length === 0}
							<div class="text-sm text-[#b8c3b9]">正在加载历史任务...</div>
						{:else if jobs.length === 0}
							<div class="text-sm text-[#b8c3b9]">还没有任务记录，先跑一次 Dry Run。</div>
						{:else}
							{#each jobs as job}
								<div class="rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-4">
									<div class="flex items-center justify-between gap-3"><div class="flex items-center gap-3"><span class={`h-2.5 w-2.5 rounded-full ${job.status === "success" ? "bg-[#88b298]" : job.status === "attention" ? "bg-[#d7b37f]" : job.status === "queued" ? "bg-[#99a9a1]" : "bg-[#5f8d74]"}`}></span><div class="text-sm font-medium">{job.label}</div></div><div class="font-mono text-[11px] uppercase tracking-[0.2em] text-[#92a095]">{job.id} · {job.timestamp}</div></div>
									<div class="mt-2 text-sm leading-7 text-[#b8c3b9]">{job.detail}</div>
								</div>
							{/each}
						{/if}
					</div>
					{#if previewItems.length > 0}
						<div class="mt-4 space-y-3">
							{#each previewItems as item}
								<div class="rounded-[1.25rem] border border-white/10 bg-[#111512] px-4 py-4">
									<div class="flex items-center justify-between gap-3"><div class="min-w-0"><div class="truncate text-sm font-medium text-white">{item.title}</div><div class="truncate text-xs text-[#92a095]">{item.notebookName} · {item.hPath}</div></div><span class={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${statusMeta[item.status].tone}`}><span class={`h-2 w-2 rounded-full ${statusMeta[item.status].dot}`}></span>{statusMeta[item.status].label}</span></div>
									<div class="mt-3 text-sm leading-7 text-[#c2ccc3]">{item.reason}</div>
									<div class="mt-2 font-mono text-[11px] text-[#8ea291]">target: {item.targetPath}</div>
									{#if item.existingPath}<div class="mt-1 font-mono text-[11px] text-[#8ea291]">existing: {item.existingPath}</div>{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>
			</div>
		</div>
	</div>
</section>
