import type { APIRoute } from "astro";
import {
	getDefaultAdminUsername,
	isAdminAuthConfigured,
	setAdminSessionCookie,
	verifyAdminCredentials,
} from "@/utils/admin/auth";
import { jsonError, jsonOk } from "@/utils/admin/http";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
	if (!isAdminAuthConfigured()) {
		return jsonError(
			"管理员鉴权未配置，请设置 ADMIN_PASSWORD 和 ADMIN_SESSION_SECRET。",
			503,
		);
	}

	let payload: { username?: string; password?: string };

	try {
		payload = (await request.json()) as {
			username?: string;
			password?: string;
		};
	} catch {
		return jsonError("请求体不是合法 JSON。", 400);
	}

	const username = payload.username?.trim() || "";
	const password = payload.password || "";

	if (!username || !password) {
		return jsonError("用户名和密码不能为空。", 400);
	}

	if (!verifyAdminCredentials(username, password)) {
		return jsonError("用户名或密码错误。", 401);
	}

	setAdminSessionCookie(cookies, getDefaultAdminUsername());

	return jsonOk({
		session: {
			authenticated: true,
			username: getDefaultAdminUsername(),
		},
		configured: true,
	});
};
