# 服务器部署说明

## 部署形态

- 外网入口：`https://li7.linuxdo.space:8443/blog/`
- 后台入口：`https://li7.linuxdo.space:8443/blog/admin/import/`
- Node 服务监听：`127.0.0.1:4322`
- 主服务：`fuwari-blog.service`
- 发布服务：`fuwari-blog-publish.service`
- 项目根目录：`/www/wwwroot/fuwari-blog`
- 当前版本软链接：`/www/wwwroot/fuwari-blog/current`
- 版本目录：`/www/wwwroot/fuwari-blog/releases/<release-id>`
- 共享目录：`/www/wwwroot/fuwari-blog/shared`

## 目录结构

```bash
/www/wwwroot/fuwari-blog/
├── current -> /www/wwwroot/fuwari-blog/releases/20260318-131200-c0f8fdc
├── incoming/
├── releases/
│   ├── 20260318-131200-c0f8fdc/
│   └── 20260318-140500-publish/
└── shared/
    ├── .env.production
    ├── runtime/
    ├── node_modules-cache/
    ├── content/posts/imported/
    └── public/imported-assets/
```

说明：

- GitHub Actions 在 Runner 上先同步 `shared/content/posts/imported` 与 `shared/public/imported-assets`，再构建 release 包上传到 `incoming/`
- release 包是瘦包（不包含 `node_modules/`，并排除 imported 源文件与图片目录）
- `deploy-server.sh` 在服务器上解压到 `releases/<release-id>/`
- `deploy-server.sh` 会按 `package.json + pnpm-lock.yaml + Node/Pnpm/arch` 计算依赖缓存 key，并复用 `shared/node_modules-cache/`
- `current` 只负责指向当前在线版本
- `shared/.env.production` 独立于 release，切版本不会丢
- `shared/content/posts/imported/` 会在部署时挂进 release，保留后台导入的文章
- `shared/public/imported-assets/` 会在部署时挂进 release，保留后台导入下载的图片
- `shared/runtime/` 会在部署时挂进 release，保留导入历史等运行时数据

## 首次部署

1. 先准备 GitHub Actions Secrets：

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`
- `DEPLOY_ENV_FILE`

2. `DEPLOY_ENV_FILE` 至少包含：

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=4322
SIYUAN_API_URL=http://127.0.0.1:3000
SIYUAN_API_TOKEN=replace-with-your-siyuan-token
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-a-random-secret
CPA_BASE_URL=http://127.0.0.1:8317
CPA_API_KEY=replace-with-your-cpa-key
CPA_MODEL=replace-with-your-cpa-model
AUTO_PUBLISH_AFTER_IMPORT=1
PUBLISH_SERVICE_NAME=fuwari-blog-publish.service
PUBLISH_GITHUB_TOKEN=replace-with-your-github-token
PUBLISH_GITHUB_REPOSITORY=betterLitao/fuwari
PUBLISH_GITHUB_WORKFLOW=publish-imported-content.yml
PUBLISH_GITHUB_REF=main
KEEP_RELEASES=5
```

3. 向 `main` 推送一次提交（可空提交），触发 `Build and Check` + `Code quality`，再由 `Deploy to Server` 自动执行。

首发成功后会自动完成这些事：

- 创建 `incoming/`、`releases/`、`shared/`
- 安装/更新 `fuwari-blog.service`
- 安装/更新 `fuwari-blog-publish.service`
- 安装版本管理命令 `fuwari-release`
- 切换 `current`
- 重启主服务并做健康检查

## GitHub Actions 实际流程

工作流现在是这条链路：

1. `Build and Check`（Node 22）先通过 `rsync` 拉取服务器导入内容；同步失败直接失败并阻断后续部署。
2. `Build and Check` 在 Runner 上构建并产出瘦包 artifact（不含 `node_modules`）。
3. `Code quality` 执行 `biome ci ./src`。
4. `Deploy to Server` 仅在同一 `head_sha` 的 `Build and Check` 与 `Code quality` 都成功时执行。
5. Deploy 下载 artifact，并用 `rsync --partial --append-verify` 上传到 `incoming/<release-id>.tar.gz`（支持续传）。
6. 服务器执行 `ops/deploy-server.sh`：解包、准备依赖缓存、切换 `current`、重启服务、健康检查。
7. 健康检查失败自动回滚到上一个版本。

## Nginx 路由

把 `ops/nginx/fuwari-blog.location.conf` 里的两个 `location` 段加入：

- `/www/server/panel/vhost/nginx/li7.linuxdo.space.conf` 的 `8080` server
- `/www/server/panel/vhost/nginx/li7.linuxdo.space.conf` 的 `8443 ssl` server

然后执行：

```bash
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
```

## 版本查看与手动切换

查看当前版本：

```bash
fuwari-release current
```

查看历史版本：

```bash
fuwari-release list
```

手动切到某个版本：

```bash
fuwari-release switch 20260318-131200-c0f8fdc
```

切换命令会自动：

- 修改 `current` 软链接
- 重启 `fuwari-blog.service`
- 做健康检查
- 失败时自动回滚

## 导入后的发布链路

后台导入后自动发布改为“服务器触发 CI 发布”，不再在服务器本地执行 `pnpm build`：

1. 后台导入写入 `shared/content/posts/imported/*.md`
2. 异步触发 `fuwari-blog-publish.service`
3. `ops/publish-site.sh` 调用 GitHub `workflow_dispatch` 触发 `publish-imported-content.yml`
4. `publish-imported-content.yml` 在 Runner 上拉导入内容、构建瘦包、上传并激活 release
5. 发布失败仅记录失败，不回退到本地构建（需人工重试 CI）

## 常用排障命令

```bash
systemctl status fuwari-blog.service --no-pager
systemctl status fuwari-blog-publish.service --no-pager
journalctl -u fuwari-blog.service -n 50 --no-pager
journalctl -u fuwari-blog-publish.service -n 50 --no-pager
fuwari-release current
fuwari-release list
readlink -f /www/wwwroot/fuwari-blog/current
```

## 风险点

- `Build and Check`（main 分支）依赖 SSH 拉取服务器导入内容，若 SSH/网络异常会直接阻断部署
- `PUBLISH_GITHUB_TOKEN` 需要 `workflow` 权限，泄露风险高于只读令牌
- 复用现有部署 SSH 密钥给 CI 拉取导入内容，权限面较大（已接受该风险）
- 首次依赖缓存 miss 时会执行一次 `pnpm install --prod --frozen-lockfile`，会慢于缓存命中
- `KEEP_RELEASES` 太小会影响回滚窗口，太大则会占磁盘
- 如果手动改了 `shared/.env.production`，需要重启服务才能让主进程读到新环境变量
