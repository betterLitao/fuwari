import type { APIRoute } from "astro";
import { readImportHistory } from "@/utils/admin/history";
import { getErrorMessage, jsonError, jsonOk } from "@/utils/admin/http";

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		return jsonOk({
			entries: await readImportHistory(),
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
