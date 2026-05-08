# IDme Playwright + CloakBrowser

这是一个新的独立脚手架目录，用于后续编写 IDme 相关 Playwright/CloakBrowser 自动化。

## 文件说明

- `src/idme.js`：主启动脚本，默认使用 CloakBrowser 打开页面。
- `start-idme.bat`：Windows 双击启动脚本。
- `package.json`：项目依赖和启动命令。

## 安装依赖

第一次使用前，在当前目录执行：

```bat
npm install
```

## 启动

```bat
npm start
```

或者双击：

```bat
start-idme.bat
```

## 常用参数

```bat
node src\idme.js --url https://api.id.me/en/session/new --headed
node src\idme.js --url https://api.id.me/en/session/new --headless
node src\idme.js --url https://api.id.me/en/session/new --profile .idme-profile
node src\idme.js --url https://api.id.me/en/session/new --slow 500
node src\idme.js --url https://api.id.me/en/session/new --proxy http://wXYSygNq:rIj4WNT75PF12hPb@us.proxy302.com:2222
node src\idme.js --url https://api.id.me/en/session/new --no-proxy
```

默认参数：

- URL：`https://api.id.me/en/session/new`
- 浏览器：CloakBrowser
- 模式：有头模式
- 用户数据目录：`.idme-profile`
- 代理：`http://wXYSygNq:***@us.proxy302.com:2222`

## 语法检查

```bat
npm run check
```
