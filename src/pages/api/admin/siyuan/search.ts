import type { APIRoute } from "astro";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { attachImportStatus, buildLocalImportIndex } from "@/utils/admin/posts";
import { searchDocs } from "@/utils/admin/siyuan";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const keyword = url.searchParams.get("keyword")?.trim() || "";
	const notebookId = url.searchParams.get("notebookId")?.trim() || undefined;

	if (keyword.length > 0 && keyword.length < 2) {
		return jsonError("搜索关键词至少 2 个字符。", 400);
	}

	try {
		const [items, importIndex] = await Promise.all([
			searchDocs({
				keyword,
				notebookId,
				limit: 12,
			}),
			buildLocalImportIndex(),
		]);

		return jsonOk({
			keyword,
			items: attachImportStatus(items, importIndex),
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
