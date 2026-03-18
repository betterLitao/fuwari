# Fuwari 思源博客发布系统

基于 Astro + Fuwari 改造，目标是把思源笔记里的文档通过受控导入链路发布到博客前台。

当前仓库已经落地这些能力：

- 前台博客站点，生产访问路径是 `https://li7.linuxdo.space:8443/blog/`
- 管理后台，生产访问路径是 `https://li7.linuxdo.space:8443/blog/admin/import/`
- 思源服务端代理，浏览器不直连思源 Token
- 导入预演、真实写入、导入历史、后台鉴权
- AI 自动打标签（导入时调用 CPA 接口生成标签）
- 导入后台支持“单篇 LOCAL 编辑”，可按文档覆盖 LOCAL 区块
- AI 提取前会校验模型可用性（`/v1/models`），并返回可读错误提示
- 导入后可触发后台发布任务，由服务器 dispatch GitHub CI 构建并发布

## 目录说明

- `src/pages/admin/`：后台页面
- `src/pages/api/admin/`：后台 API
- `src/utils/admin/`：思源代理、鉴权、导入、发布辅助逻辑
- `src/utils/admin/protected-blocks.ts`：受保护块控制
- `.runtime/admin/import-history.json`：导入历史记录
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
CPA_BASE_URL=https://api.example.com
CPA_API_KEY=replace-with-your-cpa-key
CPA_MODEL=replace-with-your-cpa-model
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-a-random-secret
AUTO_PUBLISH_AFTER_IMPORT=1
PUBLISH_SERVICE_NAME=fuwari-blog-publish.service
```

> `CPA_BASE_URL` / `CPA_API_KEY` / `CPA_MODEL` 用于导入时 AI 自动打标签，缺少任一项会在 AI 提取时返回配置错误。

## 受控导入机制

系统通过 `SYNC` / `LOCAL` 标记控制文章同步行为：

- `SYNC`：允许被同步覆盖的文章
- `LOCAL`：本地保留内容，不参与同步

> 注意：被保护的文章块（`protected-blocks.ts`）不会被覆盖，导入冲突时会标记 `conflict` 状态。

### 单篇 LOCAL 编辑规则

- 导入页仅在“选中 1 篇文档”时启用 LOCAL 编辑区
- 会先读取本地受控文章的 LOCAL 内容并回填到编辑框
- 执行 `Dry Run` / `执行同步` 时，单篇模式始终用编辑框内容覆盖 LOCAL
- 多篇导入时，LOCAL 编辑区禁用，继续使用 `localBlockNote` 批量默认逻辑

## 导入流程

1. 登录后台，浏览思源笔记本目录，选择文档
2. 执行预演（dry-run），预览生成的 Markdown 及状态（`new / updated / synced / conflict`）
3. 确认无误后执行真实导入，写入 `src/content/posts/imported/`
4. 图片资源自动下载到 `public/imported-assets/<slug>/` 并重写路径
5. 导入历史记录写入 `.runtime/admin/import-history.json`（保留最近 40 条）
6. 若 `AUTO_PUBLISH_AFTER_IMPORT=1`，自动触发 `fuwari-blog-publish.service`，由其调用 GitHub `workflow_dispatch` 完成 CI 构建发布

## 生产部署

推荐部署形态：

- Astro Node 适配器跑在 `127.0.0.1:4322`
- Nginx 统一从 `/blog/` 反代
- `systemd` 托管主站服务（`fuwari-blog.service`）和发布服务（`fuwari-blog-publish.service`）

具体命令和配置看 [docs/deploy-server.md](./docs/deploy-server.md)。

## GitHub Actions 部署

仓库内提供三条工作流链路：

- `build.yml`：构建前从服务器拉导入内容，构建并产出瘦包 artifact
- `biome.yml`：代码质量检查
- `deploy.yml`：等待前两条通过后上传并激活 release

需要准备这些 Secrets（`build.yml`、`deploy.yml`、`publish-imported-content.yml` 共同使用）：

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`
- `DEPLOY_ENV_FILE`

`DEPLOY_ENV_FILE` 内容模板：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=4322
SIYUAN_API_URL=http://127.0.0.1:3000
SIYUAN_API_TOKEN=replace-with-your-siyuan-token
CPA_BASE_URL=https://api.example.com
CPA_API_KEY=replace-with-your-cpa-key
CPA_MODEL=replace-with-your-cpa-model
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-a-random-secret
AUTO_PUBLISH_AFTER_IMPORT=1
PUBLISH_SERVICE_NAME=fuwari-blog-publish.service
PUBLISH_GITHUB_TOKEN=replace-with-your-github-token
PUBLISH_GITHUB_REPOSITORY=betterLitao/fuwari
PUBLISH_GITHUB_WORKFLOW=publish-imported-content.yml
PUBLISH_GITHUB_REF=main
KEEP_RELEASES=5
```

注意：

- `main` 分支构建会先用 SSH + `rsync` 拉取服务器导入内容；拉取失败会阻断部署
- release 包不再包含 `node_modules`，上传阶段使用 `rsync --partial --append-verify` 支持断点续传
- 服务器会按 lock 哈希复用 `shared/node_modules-cache`，仅缓存 miss 时才安装生产依赖
- `src/content/posts/imported/`、`public/imported-assets/`、`.runtime/` 会挂到服务器共享目录，避免覆盖已导入文章、资源和历史记录
- 可以在服务器上用 `fuwari-release list`、`fuwari-release current`、`fuwari-release switch <release-id>` 查看和切换版本
- 导入后的自动发布只走 CI（`publish-imported-content.yml`），失败不会回退到服务器本地构建
- 若手动修过服务器 `shared/.env.production`，记得同步更新 GitHub `DEPLOY_ENV_FILE`，避免下次部署回滚配置
