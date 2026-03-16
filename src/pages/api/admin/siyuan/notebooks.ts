import type { APIRoute } from "astro";
import { jsonError, jsonOk, getErrorMessage } from "@/utils/admin/http";
import { listNotebooks } from "@/utils/admin/siyuan";

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		return jsonOk({
			notebooks: await listNotebooks(),
		});
	} catch (error) {
		return jsonError(getErrorMessage(error));
	}
};
