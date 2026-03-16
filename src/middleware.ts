import { defineMiddleware } from "astro:middleware";
import { readAdminSession, isAdminAuthConfigured } from "@/utils/admin/auth";
import { stripBasePath, url } from "@/utils/url-utils";

function isProtectedPath(pathname: string) {
	return pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

function isAuthRoute(pathname: string) {
	return pathname.startsWith("/api/admin/auth/");
}

function isPublicAdminPage(pathname: string) {
	return pathname === "/admin/login/" || pathname === "/admin/login";
}

export const onRequest = defineMiddleware(async (context, next) => {
	const normalizedPath = stripBasePath(context.url.pathname);
	const session = readAdminSession(context.cookies);
	const locals = context.locals as typeof context.locals & {
		admin: {
			authenticated: boolean;
			username: string;
		};
	};
	locals.admin = {
		authenticated: Boolean(session),
		username: session?.username ?? "",
	};

	if (
		!isProtectedPath(normalizedPath) ||
		isAuthRoute(normalizedPath) ||
		isPublicAdminPage(normalizedPath)
	) {
		return next();
	}

	if (!isAdminAuthConfigured()) {
		if (normalizedPath.startsWith("/api/admin/")) {
			return Response.json(
				{
					ok: false,
					error: "管理员鉴权未配置，请设置 ADMIN_PASSWORD 和 ADMIN_SESSION_SECRET。",
				},
				{ status: 503 },
			);
		}

		return new Response("管理员鉴权未配置，请先设置环境变量。", { status: 503 });
	}

	if (session) {
		return next();
	}

	if (normalizedPath.startsWith("/api/admin/")) {
		return Response.json(
			{
				ok: false,
				error: "未登录或登录已失效。",
			},
			{ status: 401 },
		);
	}

	const nextPath = `${context.url.pathname}${context.url.search}`;
	return context.redirect(
		`${url("/admin/login/")}?next=${encodeURIComponent(nextPath)}`,
	);
});
