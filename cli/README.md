# 收件 CLI

安装入口见[项目说明](<https://github.com/TTTPOB/cf-agent-inbox#readme>)。打包版需要 Node.js **>=22**，无需 npm 安装。

使用指南在 CLI 帮助中，帮助无需配置或联网：

~~~sh
inbox --help
inbox help search
inbox help config
~~~

## 源码开发与验证

源码直接执行需要 Node.js **>=22.18**，使用 Node 内置类型擦除与内置模块，无额外运行时依赖。

~~~sh
node cli/main.ts --help
node --test cli/*.test.ts
npx tsc -p cli/tsconfig.json
~~~

[main.ts](<main.ts>) 是单一入口，[help.ts](<help.ts>) 维护用户指南；测试使用本地 HTTP mock。

## 打包

在仓库构建环境安装依赖后：

~~~sh
npm run build:cli
node dist/cli/inbox.mjs --help
~~~

打包输出是带可执行 shebang 的 ESM JavaScript；可通过符号链接启动。构建脚本和 Release 归档由项目统一维护。
