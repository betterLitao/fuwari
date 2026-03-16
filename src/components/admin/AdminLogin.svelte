<script lang="ts">
import type { AdminSessionResponse, ApiResponse } from "@/types/admin";
import { url } from "@/utils/url-utils";

export let nextPath = url("/admin/import/");
export let configured = true;
export let defaultUsername = "admin";

const loginApiPath = url("/api/admin/auth/login/");
const importConsolePath = url("/admin/import/");

let username = defaultUsername;
let password = "";
let error = "";
let loading = false;

async function submitLogin() {
	if (!configured) {
		error = "管理员鉴权未配置，请先设置环境变量。";
		return;
	}

	error = "";
	loading = true;

	try {
		const response = await fetch(loginApiPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				username,
				password,
			}),
		});
		const payload =
			(await response.json()) as ApiResponse<AdminSessionResponse>;
		if (!payload.ok) {
			throw new Error(payload.error);
		}

		window.location.href = nextPath || importConsolePath;
	} catch (submitError) {
		error =
			submitError instanceof Error
				? submitError.message
				: "登录失败，请稍后重试。";
	} finally {
		loading = false;
	}
}
</script>

<section class="flex min-h-[100dvh] items-center justify-center bg-[#ece8de] px-4 py-8 dark:bg-[#0f120f]">
	<div class="w-full max-w-[420px] rounded-[2.2rem] border border-[#202620] bg-[#171a18] p-8 text-[#edf2ed] shadow-[0_28px_60px_-42px_rgba(10,14,10,0.8)]">
		<div class="flex items-center justify-between gap-4">
			<h1 class="text-2xl font-semibold tracking-[-0.04em]">管理员登录</h1>
			{#if !configured}
				<span class="rounded-full border border-[#4a2626] bg-[#261818] px-3 py-1 text-xs text-[#d79d9d]">未配置</span>
			{/if}
		</div>

		<form class="mt-8 space-y-4" on:submit|preventDefault={submitLogin}>
			<label class="grid gap-2">
				<span class="text-xs uppercase tracking-[0.24em] text-[#8ea291]">用户名</span>
				<input bind:value={username} class="rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-[#708070]" placeholder="admin" type="text" />
			</label>
			<label class="grid gap-2">
				<span class="text-xs uppercase tracking-[0.24em] text-[#8ea291]">密码</span>
				<input bind:value={password} class="rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-[#708070]" placeholder="请输入管理员密码" type="password" />
			</label>

			{#if error}
				<div class="rounded-[1.2rem] border border-[#60433d] bg-[#2a1d18] px-4 py-3 text-sm text-[#e0b0a0]">
					{error}
				</div>
			{/if}

			<button class="w-full rounded-[1.2rem] border border-[#3f775d] bg-[#3f775d] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#35654f] disabled:cursor-not-allowed disabled:opacity-60" disabled={loading || !configured} type="submit">
				{loading ? "登录中..." : "进入后台"}
			</button>
		</form>
	</div>
</section>
