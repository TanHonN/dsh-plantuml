# 开发指南

## 项目结构

- **Host** 负责注册插件路由、读写配置并调用 PlantUML 命令、JAR 或服务端。[Host 源码](../src/host/)
- **Web Client** 注册会话围栏、侧栏 Markdown 预览和配置页。会话和侧栏共用图形卡片。图像预览、草稿、队列、视口和导出各由独立模块处理。[客户端入口](../src/client/plugin.js) · [图形卡片](../src/client/card.js) · [配置页](../src/client/settings.js)
- **插件配置与资源** 包含 DSH 加载配置、图标和本地化资源。插件入口、发布文件与构建脚本由包清单声明。[加载配置](../config/cordis.patch.yml) · [资源目录](../assets/) · [包清单](../package.json)
- **测试** 覆盖客户端注册、草稿与队列、导出、侧栏围栏识别、Host 路由及渲染后端。[测试目录](../test/)

## 构建与验证

1. 在仓库根目录运行 `npm install`，安装开发依赖。
2. 修改客户端源码后，运行 `npm run build:client` 更新发布入口。[客户端构建脚本](../scripts/build-client.js) · [客户端构建产物](../dist/client.js)
3. 运行 `npm run check`，验证构建产物与源码一致，检查语法并运行测试。

要运行真实 JAR 测试，可将 `DSH_PLANTUML_TEST_JAR` 设为本机 PlantUML JAR 的绝对路径后执行 `npm run check`。

## 打包

在仓库根目录运行 `npm run pack:local`。命令会先构建客户端，再生成 `dist/dsh-plantuml-<版本>.tgz`。验证新包后，清理 `dist/` 中过时的安装包。
