import type { APIRoute } from "astro";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { attachImportStatus, buildLocalImportIndex } from "@/utils/admin/posts";
import { listDocTree } from "@/utils/admin/siyuan";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const notebookId = url.searchParams.get("notebookId")?.trim();
	const path = url.searchParams.get("path")?.trim() || "/";
	const recursive = url.searchParams.get("recursive") === "1";

	if (!notebookId) {
		return jsonError("缺少 notebookId 参数。", 400);
	}

	try {
		const [nodes, importIndex] = await Promise.all([
			listDocTree({
				notebookId,
				path,
				recursive,
			}),
			buildLocalImportIndex(),
		]);

		return jsonOk({
			nodes: attachImportStatus(nodes, importIndex),
			path,
			recursive,
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
