# Fuwari 思源博客发布系统

基于 Astro + Fuwari 改造，目标是把思源笔记里的文档通过受控导入链路发布到博客前台。

当前仓库已经落地这些能力：

- 前台博客站点，生产访问路径是 `https://li7.linuxdo.space:8443/blog/`
- 管理后台，生产访问路径是 `https://li7.linuxdo.space:8443/blog/admin/import/`
- 思源服务端代理，浏览器不直连思源 Token
- 导入预演、真实写入、导入历史、后台鉴权
- 导入后可触发后台发布任务，重建前台站点

## 目录说明

- `src/pages/admin/`：后台页面
- `src/pages/api/admin/`：后台 API
- `src/utils/admin/`：思源代理、鉴权、导入、发布辅助逻辑
- `ops/`：生产部署资产
- `docs/deploy-server.md`：服务器部署说明

## 本地开发

```bash
pnpm install
pnpm dev
```

至少准备这些环境变量：

```bash
HOST=127.0.0.1
PORT=4322
SIYUAN_API_URL=http://127.0.0.1:3000
SIYUAN_API_TOKEN=replace-with-your-siyuan-token
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-a-random-secret
AUTO_PUBLISH_AFTER_IMPORT=0
PUBLISH_SERVICE_NAME=fuwari-blog-publish.service
```

## 生产部署

推荐部署形态：

- Astro Node 适配器跑在 `127.0.0.1:4322`
- Nginx 统一从 `/blog/` 反代
- `systemd` 托管主站服务和发布服务

具体命令和配置看 [docs/deploy-server.md](./docs/deploy-server.md)。

## GitHub Actions 部署

仓库内已经提供 `.github/workflows/deploy.yml`，需要准备这些 Secrets：

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`
- `DEPLOY_ENV_FILE`

注意：

- 工作流同步代码时会排除 `src/content/posts/imported/`，避免覆盖服务器上已导入的文章
- `.runtime/` 也会保留，避免清空导入历史
