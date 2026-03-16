import { defineMiddleware } from "astro:middleware";
import { readAdminSession, isAdminAuthConfigured } from "@/utils/admin/auth";

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
		!isProtectedPath(context.url.pathname) ||
		isAuthRoute(context.url.pathname) ||
		isPublicAdminPage(context.url.pathname)
	) {
		return next();
	}

	if (!isAdminAuthConfigured()) {
		if (context.url.pathname.startsWith("/api/admin/")) {
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

	if (context.url.pathname.startsWith("/api/admin/")) {
		return Response.json(
			{
				ok: false,
				error: "未登录或登录已失效。",
			},
			{ status: 401 },
		);
	}

	const nextPath = `${context.url.pathname}${context.url.search}`;
	return context.redirect(`/admin/login/?next=${encodeURIComponent(nextPath)}`);
});
