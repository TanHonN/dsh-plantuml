# 项目协作指引

### 项目文件组织

项目目录、文件与资源的组织和维护遵循 `filetree-structure` skill。
创建或移动文件前，先查看相关目录及项目已有的结构约定。

Host 和 Web Client 源码位于 `src/`，插件配置位于 `config/`，图标与本地化资源位于 `assets/`。
使用 `npm run pack:local` 将安装包生成到 `dist/`。验证新包后清理过时的安装包。一次性图稿存放在 `.tmp/`。

### 项目记忆

本地若有项目记忆，入口为 `.memory/MEMORY.md`。
项目记忆的读取与维护遵循 `filetree-memory` skill。

### 项目临时区

项目临时区位于 `.tmp/`。
临时目录的建立、使用与维护遵循 `filetree-temp` skill。
需要在项目内使用独立 npm 缓存时，可通过 `--cache .tmp/npm-cache` 指定位置。
