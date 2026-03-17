import type { APIRoute } from "astro";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { exportDocMarkdown } from "@/utils/admin/siyuan";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const id = url.searchParams.get("id")?.trim();
	if (!id) {
		return jsonError("缺少 id 参数。", 400);
	}

	try {
		const { content, hPath } = await exportDocMarkdown(id);
		return jsonOk({
			content,
			hPath,
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
