# CF Agent Inbox

个人收件工作台：在 Web 中阅读邮件，让 CLI 或 agent 搜索正文、下载附件、导出原始 EML。运行于 Cloudflare Workers、Durable Objects SQLite 和私有 R2；通过 Cloudflare Email Routing 接收现有邮箱转发的邮件。

## 安装 CLI

先安装 **Node.js >=22.18**，然后运行：

```bash
curl -fsSL https://raw.githubusercontent.com/TTTPOB/cf-agent-inbox/main/scripts/install.sh | bash
```

安装脚本下载最新 Release 的预构建包，使用 GitHub 提供的附件 digest 校验，安装到 `~/.local/lib/cf-agent-inbox`，并创建 `~/.local/bin/inbox`。不需要 clone、npm install 或管理员权限；确保 `~/.local/bin` 在 PATH 中。Linux/macOS 需要 curl、tar。

```bash
inbox help config   # 配置服务 URL、邮箱与 Cloudflare Service Auth
inbox doctor        # 检查真实连接
inbox --help        # 查看命令入口
inbox search --help # 查看搜索参数和示例
inbox help time     # 查看时区与时间区间规则
```

具体用法以各层级 CLI 帮助为准。认证只使用 Cloudflare Service Auth；实际凭据放在私有环境文件或权限为 0600 的配置中。

## 给 agent 安装 skill

```bash
pnpx skills add TTTPOB/cf-agent-inbox --skill cf-agent-inbox
```

这个 skill 帮助 agent 发现 CLI 并查阅命令帮助。CLI 仍需按上面的方式安装和配置。

## 功能与数据

- Web：邮箱列表、线程阅读、搜索、已读/星标、移动、附件预览与下载。
- CLI：list/search 时间过滤、纯文本正文、JSON 输出、附件落盘、原始 EML 导出。
- 收件按 SMTP envelope 地址路由，保留原始 To/Cc，支持自动转发与密送。
- 同时保存纯文本、HTML、附件和原始 EML；Web 默认阻止外部图片，可手动加载。
- 这是仅收件项目，没有发信、草稿、MCP 或自动 AI；永久删除操作不开放。

整封入站邮件上限为 **25 MiB**，包括 MIME/Base64 开销。搜索使用 SQLite LIKE；列表使用分页而非增量同步游标。时间过滤按收件时间，区间起点包含、终点不包含。EML 与附件同桶保存不构成独立备份，重要邮件应在原邮箱保留副本或另行导出。

## 部署自己的实例

1. 准备 Cloudflare 账户、私有 R2 Standard 桶、SQLite Durable Object 和可用于 Email Routing 的收件域。保留其他邮件服务仍在使用的主域 MX。
2. 复制 Wrangler 示例为不提交 Git 的 `wrangler.local.jsonc`，填写实际桶、收件域、地址白名单与自定义 hostname。设置 `INBOX_WRANGLER_CONFIG=wrangler.local.jsonc` 供构建使用。
3. 为 hostname 的 Web 和全部 API 配置 Cloudflare Access：浏览器使用个人身份 Allow 策略，CLI 使用指定 Service Token 的 Service Auth 策略。配置 `TEAM_DOMAIN` 与 `POLICY_AUD`。
4. 保持 workers.dev、预览 URL 和 R2 公开访问关闭。后端验证 Access JWT 签名、issuer 和 audience；通过该 Access 应用的身份可访问实例内全部邮箱。
5. 执行 `INBOX_WRANGLER_CONFIG=wrangler.local.jsonc npm run deploy`。使用锁文件中的 Wrangler，以匹配 Vite 插件生成的配置格式。
6. 在 Web 中创建邮箱，再添加该地址的精确 Email Routing 规则指向 Worker。不要覆盖已有 catch-all。
7. 从原邮箱设置转发，检查邮件正文与附件。Free 能否满足实际邮件负载应通过云端验证，不以本地耗时代替计费 CPU。

本仓库不包含实际域名、账户标识、Access 凭据或本机部署配置。

## 开发与发布

完整测试建议使用 Node.js 24（后端测试使用内置 SQLite）：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:cli
npm run dev
```

本地开发跳过 Access 验证，只在受信本机运行。测试邮件在内存生成，不需要真实邮件样本。

分支和 PR 运行 CI。推送 `vX.Y.Z` tag 后，[Release workflow](.github/workflows/release.yml) 先验证类型、测试和构建，再发布 `cf-agent-inbox-cli.tar.gz`。发布流程不需要 Cloudflare 凭据，也不部署云资源。

## 来源与许可

基于 [Cloudflare Agentic Inbox](https://github.com/cloudflare/agentic-inbox) 的 `48039bb6785af34e592c2966f87cde2b255c4c80`，不是 Cloudflare 官方产品。保留上游版权声明，使用 [Apache-2.0](LICENSE) 许可。此分支以新部署为目标，不提供已有上游 AI/MCP Durable Objects 的原地迁移流程。
