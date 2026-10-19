# 项目开发约定

- 保持个人仅收件范围：Web 阅读、CLI、正文、附件、原始 EML。不要添加发信、草稿、MCP、自动 AI 或后台同步服务。
- 沿用 npm 与 package-lock.json；完整测试使用 Node.js 24。
- 代码注释用英文，面向用户的文档和帮助用中文。操作指南维护在 CLI 分层帮助中，skill 只提供发现入口。
- 时间筛选按收件时间：date_start 包含起点，date_before 排除终点；list/search 保持一致。
- 配置实际域名、凭据、账户标识和本机路径的文件必须留在 Git ignore 范围内。公开测试只使用合成数据。
- Cloudflare 部署和资源变更需要明确授权；保留已有 MX、catch-all 和无关资源。
- 修改后运行 npm run typecheck、npm test、npm run build、npm run build:cli；发布包需验证真实安装路径及帮助命令。
- 不把本地 wall time 当成云端 CPU 数据；完成报告区分实现、验证结果与未验证项。
