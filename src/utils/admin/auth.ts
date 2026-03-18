import { createHmac, timingSafeEqual } from "node:crypto";
import type { AstroCookies } from "astro";
import { readServerEnv } from "@/utils/server-env";
import { getBaseUrl } from "@/utils/url-utils";

const COOKIE_NAME = "fuwari_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

interface SessionPayload {
	u: string;
	exp: number;
}

function getAuthConfig() {
	const username = readServerEnv("ADMIN_USERNAME") || "admin";
	const password = readServerEnv("ADMIN_PASSWORD");
	const sessionSecret = readServerEnv("ADMIN_SESSION_SECRET") || password;

	return {
		username,
		password: password ?? "",
		sessionSecret: sessionSecret ?? "",
		configured: Boolean(password && sessionSecret),
	};
}

function encodePayload(payload: SessionPayload) {
	return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(value: string): SessionPayload | null {
	try {
		return JSON.parse(
			Buffer.from(value, "base64url").toString("utf8"),
		) as SessionPayload;
	} catch {
		return null;
	}
}

function signValue(value: string, secret: string) {
	return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
	const encoder = new TextEncoder();
	const leftBuffer = encoder.encode(left);
	const rightBuffer = encoder.encode(right);

	if (leftBuffer.length !== rightBuffer.length) {
		return false;
	}

	return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminAuthConfigured() {
	return getAuthConfig().configured;
}

export function verifyAdminCredentials(username: string, password: string) {
	const config = getAuthConfig();
	if (!config.configured) {
		throw new Error(
			"缺少管理员鉴权配置，请设置 ADMIN_PASSWORD 和 ADMIN_SESSION_SECRET。",
		);
	}

	return (
		safeEqual(username.trim(), config.username) &&
		safeEqual(password, config.password)
	);
}

export function createAdminSessionToken(username: string) {
	const config = getAuthConfig();
	if (!config.configured) {
		throw new Error(
			"缺少管理员鉴权配置，请设置 ADMIN_PASSWORD 和 ADMIN_SESSION_SECRET。",
		);
	}

	const payload = encodePayload({
		u: username,
		exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
	});

	return `${payload}.${signValue(payload, config.sessionSecret)}`;
}

export function parseAdminSessionToken(token?: string | null) {
	const config = getAuthConfig();
	if (!token || !config.configured) {
		return null;
	}

	const [payloadPart, signaturePart] = token.split(".");
	if (!payloadPart || !signaturePart) {
		return null;
	}

	const expectedSignature = signValue(payloadPart, config.sessionSecret);
	if (!safeEqual(signaturePart, expectedSignature)) {
		return null;
	}

	const payload = decodePayload(payloadPart);
	if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) {
		return null;
	}

	if (!safeEqual(payload.u, config.username)) {
		return null;
	}

	return {
		username: payload.u,
	};
}

export function readAdminSession(cookies: AstroCookies) {
	return parseAdminSessionToken(cookies.get(COOKIE_NAME)?.value);
}

export function setAdminSessionCookie(cookies: AstroCookies, username: string) {
	const cookiePath = getBaseUrl();
	cookies.set(COOKIE_NAME, createAdminSessionToken(username), {
		httpOnly: true,
		path: cookiePath,
		sameSite: "lax",
		secure: import.meta.env.PROD,
		maxAge: SESSION_MAX_AGE,
	});
}

export function clearAdminSessionCookie(cookies: AstroCookies) {
	const cookiePath = getBaseUrl();
	cookies.delete(COOKIE_NAME, {
		path: cookiePath,
	});
}

export function getDefaultAdminUsername() {
	return getAuthConfig().username;
}
