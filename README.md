# 批量数据操作工作流 (lark-workflow-batch-data)

<div align="center">

![飞书 CLI](https://img.shields.io/badge/飞书%20CLI-v1.0.7-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Skill](https://img.shields.io/badge/Skill-AI%20Agent-orange)
![Version](https://img.shields.io/badge/version-1.0.0-orange)

**让 AI Agent 稳定处理上千条飞书数据，不再十几条就卡住！**

</div>

## 🎯 解决的问题

使用 AI Agent 操作飞书多维表格和电子表格时，面对上千条数据往往**只能处理十几条就中断**。根本原因：

- ❌ **API 分页限制** — 200 条/页，Agent 不会自动翻页
- ❌ **写入缺少分批** — 一次性尝试写入过多数据导致超时
- ❌ **并发冲突** — 错误码 1254291，写入互相冲突
- ❌ **网络中断无恢复** — 失败后从头再来，没有断点续传
- ❌ **上下文溢出** — 全量拉取数据到客户端计算，Agent 截断

## ✨ 核心功能

| 功能 | 描述 |
|------|------|
| 🔁 **断点续传** | 读取维护 offset 状态，写入维护 batch_index，中断后从断点恢复 |
| 🔄 **退避重试** | 429 速率限制指数退避（2s→4s→8s），并发冲突固定间隔重试，批量超限自动缩减 |
| 🛡️ **部分失败容错** | 单条/单批失败记录到 failed_records，跳过继续，最终统一汇报 |
| 📊 **服务端优先聚合** | 统计分析走 +data-query，不拉全量到客户端，避免上下文溢出 |
| 📝 **进度汇报** | 每阶段汇报已处理数/总数/断点信息，失败时提供恢复命令 |
| 📂 **跨表数据迁移** | 源表分页读取 → 字段映射 → 目标表分批写入，支持增量迁移 |
| 📥 **文件导入导出** | 本地 Excel/CSV 一键导入 Base，导出超时自动续查 |

## 📖 工作流程

### 批量读取流程

```
用户请求大量数据
    │
    ▼
确认数据类型（Base/Sheets）
    │
    ▼
分页读取（200条/页）─── 有更多数据 ──► 继续翻页
    │                                        │
    ▼                                       ▼
  失败？── 可重试 ──► 退避重试           汇报进度
    │
    ▼
  不可恢复 ──► 报告断点 offset，用户可从断点继续
```

### 批量写入流程

```
写入大量数据
    │
    ▼
写前校验（+field-list → 过滤只读字段 → 类型检查）
    │
    ▼
分批写入（≤500条/批，串行，批次间延迟0.5-1s）
    │
    ├── 成功 ──► batch_index++，继续下一批
    ├── 可重试错误 ──► 退避重试当前批次
    └── 不可恢复错误 ──► 记录到 failed_records，跳过继续
    │
    ▼
汇报结果（成功数/失败数/断点信息/恢复命令）
```

### 大数据分析流程

```
用户需要统计/分析
    │
    ▼
只需聚合结果？── 是 ──► +data-query（服务端计算，不拉全量）
    │
    否
    ▼
分页读取明细 ──► +record-list --limit 200 --offset N
```

## 🚀 快速开始

### 前置要求

- ✅ 已安装 Node.js (v16+)
- ✅ 已安装飞书 CLI
- ✅ 已配置飞书账号

### 1. 安装飞书 CLI

```bash
# 全局安装飞书 CLI
npm install -g @larksuite/cli

# 安装官方 Skills
npx skills add https://github.com/larksuite/cli -y -g
```

### 2. 配置和授权

```bash
# 初始化配置（首次使用）
lark-cli config init

# 授权登录（根据需要选择域）
lark-cli auth login --domain base         # 多维表格
lark-cli auth login --domain sheets       # 电子表格
lark-cli auth login --domain drive        # 导入导出
lark-cli auth login --domain base,sheets,drive  # 全部
```

**授权说明**：
- `base`: 多维表格读写操作
- `sheets`: 电子表格读写操作
- `drive`: 文件导入导出

### 3. 安装本 Skill

#### 🌟 方式 1：通过 GitHub 仓库链接安装（推荐）

```bash
npx skills add https://github.com/mmmnhjgh/lark-workflow-batch-data -y -g
```

#### 方式 2：手动安装

```bash
# Linux/macOS
cp -r lark-workflow-batch-data ~/.agents/skills/lark-workflow-batch-data

# Windows
xcopy /E /I lark-workflow-batch-data %USERPROFILE%\.agents\skills\lark-workflow-batch-data
```

### 4. 验证安装

```bash
npx skills list
# 应该能看到 lark-workflow-batch-data
```

### 5. 开始使用

在 AI Agent（如 OpenCode、Claude Code）中直接使用自然语言：

```
帮我把这个 Excel 导入到多维表格，有 2000 条记录
```

AI Agent 会自动：
1. 使用 `drive +import` 导入文件
2. 导入后校验记录数
3. 如有失败，从断点继续

## 💡 使用场景

### 场景 1：批量读取多维表格

**用户输入**：
```
帮我把这张表的所有记录都读出来，有 3000 条
```

**AI Agent 自动执行**：
```bash
# 分页续读，每页 200 条
lark-cli base +record-list --base-token app_xxx --table-id tbl_xxx --offset 0 --limit 200
lark-cli base +record-list --base-token app_xxx --table-id tbl_xxx --offset 200 --limit 200
lark-cli base +record-list --base-token app_xxx --table-id tbl_xxx --offset 400 --limit 200
# ... 直到 has_more=false
```

### 场景 2：批量写入上千条记录

**用户输入**：
```
帮我把这 2000 条数据写入多维表格
```

**AI Agent 自动执行**：
```bash
# Step 1: 写前校验
lark-cli base +field-list --base-token app_xxx --table-id tbl_xxx

# Step 2: 逐条写入（每批间隔 0.5-1s）
lark-cli base +record-upsert --base-token app_xxx --table-id tbl_xxx --json '{"姓名":"张三","部门":"技术"}'
lark-cli base +record-upsert --base-token app_xxx --table-id tbl_xxx --json '{"姓名":"李四","部门":"产品"}'
# ... 每 500 条为一批，批次间延迟
```

### 场景 3：统计各部门人数

**用户输入**：
```
帮我看一下各部门有多少人
```

**AI Agent 自动执行**（服务端聚合，不拉全量）：
```bash
lark-cli base +data-query --base-token app_xxx --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [{"field_name": "部门", "alias": "dept"}],
  "measures": [{"field_name": "姓名", "aggregation": "count", "alias": "headcount"}],
  "shaper": {"format": "flat"}
}'
```

### 场景 4：跨表数据迁移

**用户输入**：
```
帮我把 A 表的数据迁移到 B 表
```

**AI Agent 自动执行**：
```bash
# Step 1: 读取源表结构
lark-cli base +field-list --base-token <SOURCE_TOKEN> --table-id <SOURCE_ID>

# Step 2: 读取目标表结构
lark-cli base +field-list --base-token <TARGET_TOKEN> --table-id <TARGET_ID>

# Step 3: 分页读取 + 字段映射 + 分批写入（断点续传）
lark-cli base +record-list --base-token <SOURCE_TOKEN> --table-id <SOURCE_ID> --offset 0 --limit 200
# ... 逐条映射后写入目标表

# Step 4: 校验记录数
lark-cli base +record-list --base-token <TARGET_TOKEN> --table-id <TARGET_ID> --limit 1
```

### 场景 5：导入 Excel 到多维表格

**用户输入**：
```
帮我把这个 Excel 导入到飞书多维表格
```

**AI Agent 自动执行**：
```bash
# 导入文件
lark-cli drive +import --file ./data.xlsx --type bitable --name "客户数据表"

# 如果超时续查
lark-cli drive +task_result --scenario import --ticket <TICKET>

# 导入后校验
lark-cli base +table-list --base-token <IMPORTED_TOKEN>
lark-cli base +record-list --base-token <IMPORTED_TOKEN> --table-id <FIRST_TABLE_ID> --limit 1
```

### 场景 6：Agent 操作截断恢复

**用户输入**：
```
之前读取表格只处理了 200 条就停了，继续
```

**AI Agent 自动执行**：
```bash
# 从断点续读
lark-cli base +record-list --base-token app_xxx --table-id tbl_xxx --offset 200 --limit 200
```

## 🔧 技术架构

本 Skill 基于飞书 CLI 1.0.7+ 的以下能力：

| 模块 | 功能 | 命令示例 |
|------|------|----------|
| **base** | 多维表格记录读写、字段查询、数据聚合 | `+record-list`, `+record-upsert`, `+data-query`, `+field-list` |
| **sheets** | 电子表格读写、追加、导出 | `+read`, `+write`, `+append`, `+export`, `+info` |
| **drive** | 文件导入、任务续查、导出 | `+import`, `+task_result` |
| **wiki** | Wiki 链接解析（获取真实 obj_token） | `wiki spaces get_node` |
| **auth** | 权限管理和授权 | `auth login`, `auth status` |

### 断点续传机制

| 操作 | 断点变量 | 恢复方式 |
|------|---------|---------|
| Base 读取 | `offset` | `+record-list --offset {last_offset}` |
| Base 写入 | `batch_index` | 从第 `batch_index * 500 + 1` 条继续写入 |
| Sheets 写入 | `start_row` | `+write --range "A{start_row}"` |
| 文件导入 | `ticket` | `+task_result --ticket <TICKET>` |

### 错误恢复策略

| 错误类型 | 错误码 | 恢复策略 |
|---------|--------|---------|
| 速率限制 | 429 | 指数退避 2s→4s→8s，最多 3 次 |
| 并发冲突 | 1254291 | 等待 1s 重试 |
| 批量超限 | 1254104 | 自动缩减批次 500→250→125 |
| 字段类型不匹配 | 1254015 | 记录到 failed_records，跳过继续 |
| 网络超时 | timeout | 从断点续传 |
| Token 无效 | baseToken invalid | 检查 wiki 链接转换 |

## 📋 覆盖场景

| 场景 | 参考文档 |
|------|---------|
| 多维表格分页读取 | [base-read.md](references/lark-workflow-batch-data-base-read.md) |
| 多维表格批量写入 | [base-write.md](references/lark-workflow-batch-data-base-write.md) |
| 电子表格批量读写 | [sheets-ops.md](references/lark-workflow-batch-data-sheets-ops.md) |
| 文件导入导出 | [import-export.md](references/lark-workflow-batch-data-import-export.md) |
| 跨表数据迁移 | [migration.md](references/lark-workflow-batch-data-migration.md) |
| 大数据分析 | [analysis.md](references/lark-workflow-batch-data-analysis.md) |
| 错误恢复机制 | [error-recovery.md](references/lark-workflow-batch-data-error-recovery.md) |

## ⚙️ 权限要求

| 功能域 | 所需 Scope | 用途 | 必要性 |
|--------|-----------|------|--------|
| base | `base:base:read` | 读取多维表格 | 必需 |
| base | `base:base:write` | 写入多维表格 | 写入时必需 |
| sheets | `sheets:spreadsheet:read` | 读取电子表格 | 读取时必需 |
| sheets | `sheets:spreadsheet:write` | 写入电子表格 | 写入时必需 |
| drive | `drive:drive:read` | 文件导出 | 导出时必需 |
| drive | `drive:drive:write` | 文件导入 | 导入时必需 |

## 🐛 错误处理

### 权限不足

```bash
# 查看缺失的 scope，然后补充授权
lark-cli auth login --domain base
# 或完整授权
lark-cli auth login --domain base,sheets,drive
```

### Token 无效

```bash
# 如果链接是 /wiki/TOKEN 格式，需要先转换
lark-cli wiki spaces get_node --params '{"token":"wiki_token"}'
# 使用返回的 obj_token 作为 --base-token
```

### 写入字段错误

```bash
# 先获取字段结构，确认字段名和类型
lark-cli base +field-list --base-token <TOKEN> --table-id <ID>
# 检查是否误写了只读字段（formula/lookup/系统字段）
```

### 导入超时

```bash
# 使用返回的 ticket 继续查询
lark-cli drive +task_result --scenario import --ticket <TICKET>
```

## 📝 最佳实践

1. **分而不全** — 永远不要一次拉取/写入全部数据，采用分页/分批 + 断点续传
2. **读前知结构** — 写入前必先 `+field-list`，读取前必先 `+info`
3. **服务端优先** — 统计分析走 `+data-query`，不拉全量到客户端
4. **串行不并发** — 所有 `+xxx-list` 禁止并发调用
5. **批次间延迟** — 写操作每批间隔 0.5–1 秒
6. **失败不停步** — 单条/单批失败时记录错误继续后续，最终统一汇报
7. **只写存储字段** — 跳过 formula/lookup/系统字段
8. **干跑预览** — 写入前 `--dry-run` 确认参数（如支持）

## 📂 文件结构

```
lark-workflow-batch-data/
├── SKILL.md                                          # 主 Skill 文件（决策树 + 全局原则）
└── references/
    ├── lark-workflow-batch-data-error-recovery.md     # 错误恢复机制（核心创新）
    ├── lark-workflow-batch-data-base-read.md           # Base 分页读取 + 断点续读
    ├── lark-workflow-batch-data-base-write.md          # Base 批量写入 + 断点续写
    ├── lark-workflow-batch-data-sheets-ops.md          # Sheets 批量读写 + 导出
    ├── lark-workflow-batch-data-import-export.md        # 文件导入导出 + 超时恢复
    ├── lark-workflow-batch-data-migration.md           # 跨表数据迁移 + 字段映射
    └── lark-workflow-batch-data-analysis.md            # 服务端聚合分析
```

## 📚 参考资源

- [飞书 CLI 官方仓库](https://github.com/larksuite/cli)
- [飞书开放平台](https://open.feishu.cn/)
- [SKILL.md](./SKILL.md) - 详细的 Skill 定义文件

## 🏆 参赛信息

本作品参加 **飞书 CLI 创作者大赛**

### 作品特点

- 🔁 **断点续传** — 首次为飞书 CLI 引入 offset/batch_index/start_row 状态变量机制，中断后可从断点恢复
- 🔄 **退避重试** — 指数退避 + 固定间隔重试 + 批次自动缩减，保障大批量操作稳定性
- 🛡️ **部分失败容错** — 单条失败不影响整批，failed_records 统一汇报
- 📊 **服务端优先** — 统计分析走 +data-query，避免 Agent 上下文溢出
- ✅ **实用性强** — 直击"Agent 操作大量数据只能处理十几条"这一核心痛点
- ✅ **技术完整** — 覆盖飞书 3 大业务域（Base/Sheets/Drive），7 大操作场景

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

<div align="center">

**让 AI Agent 稳定处理上千条飞书数据！** 🚀

Made with ❤️ for 飞书 CLI 创作者大赛