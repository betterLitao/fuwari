import { spawn } from "node:child_process";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

interface PublishTriggerResult {
	enabled: boolean;
	message: string;
}

function getPublishServiceName() {
	return (
		import.meta.env.PUBLISH_SERVICE_NAME?.trim() ||
		"fuwari-blog-publish.service"
	);
}

export function isAutoPublishEnabled() {
	const raw = import.meta.env.AUTO_PUBLISH_AFTER_IMPORT?.trim().toLowerCase() || "";
	return TRUE_VALUES.has(raw);
}

export function triggerPublishBuild(): PublishTriggerResult {
	if (!isAutoPublishEnabled()) {
		return {
			enabled: false,
			message:
				"当前环境未启用自动发布，前台生效前还需手动执行构建并重启站点服务。",
		};
	}

	const publishService = getPublishServiceName();
	const child = spawn("systemctl", ["restart", publishService], {
		cwd: process.cwd(),
		detached: true,
		stdio: "ignore",
	});
	child.unref();

	return {
		enabled: true,
		message: `已提交后台发布任务，前台刷新以 ${publishService} 完成为准。`,
	};
}
