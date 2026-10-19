const common = String.raw`通用选项：
  --base-url URL    应用根地址，不含 /api/v1；覆盖 INBOX_URL 与配置文件
  --mailbox EMAIL   本次邮箱；覆盖 INBOX_MAILBOX 与配置文件
  --config PATH    读取当前用户持有的 0600 JSON 配置（详见 inbox help config）
  --json           成功时 stdout 只有一行 JSON；错误写 stderr，退出码非 0
  -h, --help       显示当前命令帮助，无需配置或联网（帮助始终为文本）
认证：CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET；详见 inbox help config。
同一选项不能重复。`;

const paging = String.raw`分页选项：
  --page N         正整数，默认 1；一次只请求一页，不自动翻页
  --limit N        正整数，默认 20；服务端可限制最大值
JSON：{"emails":[...],"totalCount":number|null}；数组版 API 无总数时为 null。
每项只含元数据和 snippet，不夹正文。下一页用 --page 2，详情用 inbox show EMAIL_ID。`;

const time = String.raw`时间筛选（list/search 共用，按收件时间）：
  --after DATE     YYYY-MM-DD 或 ISO 时间，start 包含该时刻
  --before DATE    YYYY-MM-DD 或 ISO 时间，end 不包含该时刻
  --since Nh|Nd    正整数小时/天，例如 24h、7d；1d 固定为 24h，截止当前时刻
  --today          本地今天 00:00 到明天 00:00
  --yesterday      本地昨天 00:00 到今天 00:00
日期和不带偏移的 ISO 默认使用运行机器的本地时区；Z 或 ±HH:MM 指定明确偏移。
--today/--yesterday 按本地日历计算，夏令时日未必为 24h；doctor 显示当前时区。
自动化可用 TZ=UTC；例如 2026-04-01T09:00:00+08:00 表示明确的 UTC+8 时刻。
区间为 [start, end)，映射 API date_start（含）/date_before（不含）。
--after/--before 可组合且必须 start < end；--since/--today/--yesterday 互斥，
也不能与 --after/--before 混用；同一选项不能重复。
示例（整个 4 月，不要把 before 写成 4 月 30 日）：
  inbox list --after 2026-04-01 --before 2026-05-01 --json
  TZ=UTC inbox search '账单' --since 7d`;

const downloads = String.raw`保存规则：
  --output PATH    单个目标文件；与 --dir 互斥
  --dir DIR        目标目录，默认当前目录；缺失的目录会创建
已有目标文件明确拒绝覆盖，不自动改名；默认附件名会净化路径分隔符和控制字符。
流式写入同目录 0600 临时 .part 文件，完整后 rename；中断清理当前临时文件。
拒绝 HTTP 重定向，避免 Service Auth 凭据跨源；拒绝意外 HTML/Access 登录页。
请求超时 60 秒。JSON 成功结构：{"files":["绝对目标路径",...]}。`;

const config = String.raw`配置与 Cloudflare Access Service Auth

1. 设置服务根地址和默认邮箱：
   export INBOX_URL='https://inbox.example.com'
   export INBOX_MAILBOX='reader@example.com'
2. 安全读取管理员提供的 Service Token，避免写入命令历史（Bash）：
   read -r -p 'Access Client ID: ' CF_ACCESS_CLIENT_ID
   read -r -s -p 'Access Client Secret: ' CF_ACCESS_CLIENT_SECRET
   printf '\n'
   export CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
3. 验证：inbox doctor --json

CF_ACCESS_CLIENT_ID 与 CF_ACCESS_CLIENT_SECRET 必须成对提供。
服务端 Cloudflare Access 策略须允许该 Service Token；CLI 不创建应用 token，
不提供登录命令，不接受命令行 secret 参数，不打印凭据或服务端错误正文。
远程 URL 必须 HTTPS；HTTP 仅供 localhost/loopback 本地测试。
URL 不得含账号密码、查询或片段，也不要附加 /api/v1。

可选文件：~/.config/cf-agent-inbox/config.json，必须由当前用户持有且权限 0600。
示例仅含占位符；保存真实凭据的文件不得提交 Git：
  {
    "baseURL": "https://inbox.example.com",
    "mailbox": "reader@example.com",
    "accessClientId": "SERVICE_TOKEN_CLIENT_ID_PLACEHOLDER",
    "accessClientSecret": "SERVICE_TOKEN_CLIENT_SECRET_PLACEHOLDER"
  }
文件选择：--config PATH > INBOX_CONFIG > 上述默认路径。
URL/邮箱值优先级：--base-url/--mailbox > 环境变量 > 文件。
INBOX_URL 优先于兼容别名 INBOX_BASE_URL；INBOX_MAILBOX 为默认邮箱。
对应 CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET 环境变量分别覆盖文件值。
指定配置文件不存在或权限错误会失败；help 不读取任何配置。
示例：inbox list --mailbox 'other@example.com' --today`;

const json = String.raw`JSON 与退出码

各业务命令支持 --json：成功 stdout 仅一行 JSON，无进度日志；错误写 stderr，
退出码非 0，失败不输出半个 JSON。帮助（含 --help --json）始终输出文本。
  list/search   {"emails":[...],"totalCount":number|null}
                每项有 id/subject/sender/recipient/date/received_at/read/starred/snippet，
                不含正文；旧版数组 API 的 totalCount 为 null，不代表 0。
  show          邮件详情对象，并提供纯文本 body_text
  attachments   {"attachments":[...]}
  download      {"files":["绝对目标路径",...]}
  export        {"files":["绝对目标路径"]}
  doctor        {"ok":true,"baseURL":"服务地址","mailbox":"邮箱地址","node":"版本","timezone":"时区","authenticated":true|false}
                authenticated 仅表示配置了 Service Token；连接/认证失败仍退出非 0。
--all 下载部分成功后若失败，不输出成功 JSON，先前完成的文件仍保留。
示例：inbox list --since 24h --json > inbox-page.json`;

const globalHelp = String.raw`只读收件 CLI — inbox

先运行 inbox help config 配置 Service Auth，再运行 inbox doctor。
帮助无需配置或联网；支持 inbox help COMMAND 与 inbox COMMAND --help。

用法：inbox COMMAND [参数] [选项]
命令：
  doctor                       验证连接、认证与当前时区
  list                         浏览 Inbox 收件列表
  search [关键词]              按文字与显式条件搜索（不解析 Gmail DSL）
  show EMAIL_ID                查看纯文本正文
  attachments EMAIL_ID         列出附件元数据
  download EMAIL_ID ATTACHMENT_ID | download EMAIL_ID --all
                               下载一个或全部附件
  export EMAIL_ID               导出原始 RFC822 EML
  help [命令或专题]             查看帮助
专题：inbox help config | inbox help time | inbox help json

常用示例：
  inbox list --today --json
  inbox search '账单' --from 'billing@example.com' --since 7d
  inbox show EMAIL_ID
  inbox download EMAIL_ID --all --dir ./attachments
  inbox export EMAIL_ID --output ./original.eml

` + common + String.raw`
时间：本地时区、按收件时间、start 含/end 不含；详见 inbox help time。
运行：打包版需要 Node >=22；直接执行 TypeScript 源码需要 Node >=22.18。
本工具只有收件读取和下载，不发送、回复或创建草稿。`;

const pages: Record<string, string> = {
  doctor: String.raw`inbox doctor — 检查连接与认证
用法：inbox doctor [通用选项]
请求所选邮箱验证 API 可达，显示服务地址、邮箱、Node 版本、本地时区及 Service Token 配置状态。
邮箱来自 --mailbox > INBOX_MAILBOX > 配置文件；Service Token 不自动绑定邮箱。
401/403 或 Access 登录页视为失败；无自动登录，检查 Service Token 及服务端策略。
JSON：{"ok":true,"baseURL":"服务地址","mailbox":"邮箱地址","node":"版本","timezone":"时区","authenticated":true|false}。
authenticated 表示配置状态，不包含 ID/secret；详见 inbox help json。
示例：inbox doctor --json

` + common,
  list: String.raw`inbox list — 浏览 Inbox
用法：inbox list [时间选项] [分页选项] [通用选项]
固定读取 Inbox，不自动翻页。列表只有 ID、收件时间、发件人、主题；正文用 show。
示例：
  inbox list --today
  inbox list --since 7d --page 2 --limit 20 --json

` + time + '\n\n' + paging + '\n\n' + common,
  search: String.raw`inbox search — 文字与显式条件搜索
用法：inbox search [关键词] [搜索选项] [时间选项] [分页选项] [通用选项]
搜索选项：
  --query TEXT        普通关键词；与关键词位置参数互斥，多词请加引号
  --from ADDRESS      发件人条件，传 API from
  --to ADDRESS        收件人条件，传 API to
  --subject TEXT      主题条件，传 API subject
  --has-attachment    仅有附件的邮件，传 API has_attachment=true
不实现 Gmail DSL；'from:word' 只作为普通 query 原样传给 API。
可省略关键词，只用显式条件；列表不含正文。
示例：
  inbox search '账单' --from 'billing@example.com' --has-attachment --since 24h
  inbox search --subject '通知' --after 2026-04-01 --before 2026-05-01 --json

` + time + '\n\n' + paging + '\n\n' + common,
  show: String.raw`inbox show — 查看邮件正文
用法：inbox show EMAIL_ID [通用选项]
EMAIL_ID 来自 list/search 的 id。
优先显示 body_text，否则将 body_html 或旧版 body 去标签并解码常见 HTML 实体。
不渲染 HTML，不请求外部图片；JSON 为详情对象并补充纯文本 body_text。
需要原始邮件请用 inbox export；附件请用 inbox attachments / download。
示例：
  inbox show EMAIL_ID
  inbox show EMAIL_ID --json

` + common,
  attachments: String.raw`inbox attachments — 列出邮件附件
用法：inbox attachments EMAIL_ID [通用选项]
从邮件详情 attachments 读取 ID、文件名、MIME 类型与字节数，不下载文件。
JSON：{"attachments":[...]}；无附件时为 []。
示例：
  inbox attachments EMAIL_ID --json
  inbox download EMAIL_ID ATTACHMENT_ID --output ./invoice.pdf

` + common,
  download: String.raw`inbox download — 下载附件
用法：inbox download EMAIL_ID ATTACHMENT_ID [--output PATH | --dir DIR] [通用选项]
      inbox download EMAIL_ID --all [--dir DIR] [通用选项]
EMAIL_ID 来自 list/search，ATTACHMENT_ID 来自 attachments。
  --all            顺序下载邮件全部附件；与 ATTACHMENT_ID/--output 互斥
默认以附件净化后的名称保存。--all 同批净化后重名直接拒绝，请逐个 --output 指定。
部分成功：后续附件失败时，先前已完成文件保留，当前临时文件清理，退出非 0，
stdout 不输出成功 JSON。重试请逐个下载剩余附件或使用新目录，避免已有文件重名。
无附件的 --all 成功并返回 {"files":[]}。
示例：
  inbox download EMAIL_ID ATTACHMENT_ID --output ./invoice.pdf
  inbox download EMAIL_ID --all --dir ./attachments --json

` + downloads + '\n\n' + common,
  export: String.raw`inbox export — 导出原始 EML
用法：inbox export EMAIL_ID [--output PATH | --dir DIR] [通用选项]
通过 GET /api/v1/mailboxes/:mailboxId/emails/:id/raw 下载留存的原始 RFC822。
不从展示正文拼装 EML；未留存 raw 的旧邮件可能无法导出。
默认文件名为净化后的 EMAIL_ID.eml；--output 可指定完整目标文件名。
示例：
  inbox export EMAIL_ID --output ./original.eml
  inbox export EMAIL_ID --dir ./archive --json

` + downloads + '\n\n' + common,
  config,
  time,
  json,
  help: String.raw`inbox help — 查看离线帮助
用法：inbox help [命令或专题]
      inbox COMMAND --help
      inbox --help
命令：doctor、list、search、show、attachments、download、export、help。
专题：config（Service Auth 配置）、time（时间与时区）、json（输出约定）。
所有帮助均无需配置、认证或联网，始终在 stdout 输出文本并成功退出。
未知主题报错到 stderr，退出非 0。
示例：
  inbox help search
  inbox search --help
  inbox help config`,
};

export function helpText(topic?: string): string {
  if (!topic) return globalHelp;
  if (!Object.hasOwn(pages, topic)) throw new Error('未知帮助主题；运行 inbox help 查看入口');
  return pages[topic];
}
