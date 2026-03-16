# 服务器部署说明

## 部署形态

- 外网入口：`https://li7.linuxdo.space:8443/blog/`
- 后台入口：`https://li7.linuxdo.space:8443/blog/admin/import/`
- Node 服务监听：`127.0.0.1:4322`
- 主服务：`fuwari-blog.service`
- 发布服务：`fuwari-blog-publish.service`
- 项目目录：`/www/wwwroot/fuwari-blog`

## 首次部署

1. 同步仓库到服务器目录：

```bash
mkdir -p /www/wwwroot/fuwari-blog
```

2. 写入生产环境变量：

```bash
cat > /www/wwwroot/fuwari-blog/.env.production <<'EOF'
NODE_ENV=production
HOST=127.0.0.1
PORT=4322
SIYUAN_API_URL=http://127.0.0.1:3000
SIYUAN_API_TOKEN=replace-with-your-siyuan-token
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_SESSION_SECRET=replace-with-a-random-secret
AUTO_PUBLISH_AFTER_IMPORT=1
PUBLISH_SERVICE_NAME=fuwari-blog-publish.service
EOF
```

3. 在仓库根目录执行部署脚本：

```bash
cd /www/wwwroot/fuwari-blog
bash ops/deploy-server.sh
```

## Nginx 路由

把 `ops/nginx/fuwari-blog.location.conf` 里的两个 `location` 段加入：

- `/www/server/panel/vhost/nginx/li7.linuxdo.space.conf` 的 `8080` server
- `/www/server/panel/vhost/nginx/li7.linuxdo.space.conf` 的 `8443 ssl` server

然后执行：

```bash
/www/server/nginx/sbin/nginx -t -c /www/server/nginx/conf/nginx.conf
/www/server/nginx/sbin/nginx -s reload -c /www/server/nginx/conf/nginx.conf
```

## 后续更新

如果是手工更新代码：

```bash
cd /www/wwwroot/fuwari-blog
bash ops/deploy-server.sh
```

如果是 GitHub Actions 更新：

- 使用仓库内 `Deploy to Server` 工作流
- `rsync` 会保留服务器上的 `src/content/posts/imported/` 和 `.runtime/`

## 导入后的发布链路

- 导入后台先写 `src/content/posts/imported/*.md`
- 然后异步触发 `fuwari-blog-publish.service`
- 发布服务执行 `corepack pnpm build`
- 构建成功后重启 `fuwari-blog.service`

查看日志：

```bash
systemctl status fuwari-blog.service --no-pager
systemctl status fuwari-blog-publish.service --no-pager
journalctl -u fuwari-blog.service -n 50 --no-pager
journalctl -u fuwari-blog-publish.service -n 50 --no-pager
```

## 风险点

- 不要把部署同步做成全量覆盖 `src/content/posts/imported/`，否则已导入内容会丢
- 当前站点挂在 `/blog/` 子路径，前端和后台请求都必须走带 base 的地址
- 如果导入后前台没更新，先查 `fuwari-blog-publish.service` 是否构建失败
