import type { APIRoute } from "astro";
import type { ImportLocalContentResponse } from "@/types/admin";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";
import { buildLocalImportIndex } from "@/utils/admin/posts";
import { inspectProtectedBlocks } from "@/utils/admin/protected-blocks";

export const prerender = false;

function buildResponse(input: ImportLocalContentResponse) {
	return jsonOk<ImportLocalContentResponse>(input);
}

export const GET: APIRoute = async ({ url }) => {
	const docId = url.searchParams.get("docId")?.trim();
	if (!docId) {
		return jsonError("缺少 docId 参数。", 400);
	}

	try {
		const index = await buildLocalImportIndex();
		const existing = index.byDocId.get(docId);

		if (!existing) {
			return buildResponse({
				docId,
				exists: false,
				protectedState: "absent",
				localContent: "",
				message: "本地未找到已导入文章；执行导入时将按当前编辑器内容写入 LOCAL。",
			});
		}

		const inspection = inspectProtectedBlocks(existing.content);
		const messageByState = {
			managed: "已读取本地 LOCAL 区块；本次导入会按当前编辑器内容覆盖。",
			broken:
				"检测到保护区块结构异常，当前回填为空；该文档会在导入阶段被阻断，请先修复受控区块。",
			absent:
				"当前文档缺少受控区块，回填为空；该文档会在导入阶段被阻断，请先修复受控区块。",
		} as const;

		return buildResponse({
			docId,
			exists: true,
			protectedState: inspection.state,
			localContent:
				inspection.state === "managed" ? inspection.localContent : "",
			message: messageByState[inspection.state],
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
