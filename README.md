# 忆检

忆检是一套本地优先的知识考察与间隔复习网页。它从 PDF / DOCX 的红色文字中提取题目与答案，把知识点转换成填空题或四选一题，并依据艾宾浩斯式复习间隔安排错题回顾。

## 核心能力

- 本地解析电子 PDF、扫描 PDF 与 DOCX 的红色文字，不调用 AI 识别 API。
- 识别跨行、跨页、多空题、同行答案与解析，并保留原题干和来源位置。
- 在本机自动归档大学英语、计算机基础、大学语文、高等数学及知识点大类。
- 学习考察可按科目与知识点大类筛选。
- 导入当天的 ChatGPT 导出 ZIP / `conversations.json`、Codex JSONL、JSON / Markdown / 纯文本记录。
- 今日组卷只生成选择题，题量由用户决定，逐题提交后显示答案和解析。
- 选择题严格判分；填空题仅在明确同义或缩写时自动判对，模糊近义答案会让用户确认后再写入成绩。
- 错题回到 10 分钟阶段，随后按 1、2、4、7、15、30 天逐级复习。
- 知识点、作答、试卷进度与今日记录只保存在当前浏览器的 IndexedDB。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

线上版本使用 Sites/Cloudflare Worker 作为托管适配层，但本项目不依赖线上数据库、对象存储、登录服务或 AI API。应用可以直接在本机 Node.js 服务器运行，所有文档解析、题目生成和学习记录仍在浏览器本地完成。

### 本地生产服务器

```bash
npm install
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
```

浏览器打开 `http://localhost:3000`。Windows、macOS 和 Linux 都可以使用这套方式；不需要 Cloudflare 账号，也不需要 `.openai/hosting.json`。

### Docker 自托管

```bash
docker build -t yijian-local-study .
docker run --rm -p 3000:3000 yijian-local-study
```

Docker 容器只提供网页服务，不会接收或保存用户上传的 PDF、DOCX 和学习记录。

### 打包到 GitHub

```bash
npm run package:github
```

命令会在 `release/` 生成一个干净的源码 ZIP，自动排除 `node_modules`、构建产物、临时文件、`.openai` 托管元数据和本地会话目录。也可以直接把项目源码上传到 GitHub；不要提交 `.env`、`tmp/` 或从 Codex 导出的私人会话文件。

完整验证：

```bash
npm run lint
npm test
```

`npm test` 会依次执行 TypeScript 检查、生产构建，以及页面渲染、文档结构、PDF 文字结构、科目分类、近似判分和今日导入/组卷测试。

## 导出今天的 Codex 学习记录

普通网页不能跨站读取网页版 ChatGPT，也不能绕过浏览器权限读取本机 Codex 会话。本项目没有伪造“自动同步”，而是提供一个不调用 AI/API 的本地伴侣脚本：

```bash
npm run history:codex
```

脚本扫描 `~/.codex/sessions` 的主任务记录，按本地当天过滤并排除子代理，默认输出到 Git 已忽略的 `tmp/` 目录。也可指定日期与输出路径：

```bash
npm run history:codex -- --date 2026-07-26 --out tmp/codex-today.json
```

导出文件可能包含私人会话内容。只导入你愿意在当前设备处理的文件，不要将其提交到仓库。

ChatGPT 可导入官方数据导出的 ZIP / `conversations.json`，也可按页面模板粘贴当前对话。导入、日期过滤、去重、分类和组卷均在浏览器内完成。

## 四川专升本英语说明

今日英语组卷参考现行四川普通高校专升本《大学英语》考试要求中的客观选择题范围。这里生成的是用户自定题量的选择题专项训练，不等同于包含主观题、满分 150 分的官方完整模拟卷。

## 常用命令

- `npm run dev`：启动本地开发服务
- `npm run build`：生成生产构建
- `npm run typecheck`：执行 TypeScript 检查
- `npm run lint`：执行 ESLint
- `npm test`：执行完整自动化验证
- `npm run history:codex`：本地导出当天 Codex 主任务记录
