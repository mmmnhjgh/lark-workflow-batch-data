# lark-workflow-batch-data

飞书 CLI 批量数据操作 Skill — 解决 Agent 操作大量数据时只能处理十几条就截断的问题。

## 问题背景

使用 AI Agent 操作飞书多维表格和电子表格时，面对上千条数据往往只能处理十几条就中断。根本原因包括：

- API 分页限制（200 条/页），Agent 不会自动翻页
- 写入缺少分批策略，一次性尝试写入过多数据导致超时
- 并发写入冲突（错误码 1254291）
- 网络波动中断后无恢复机制
- 全量拉取数据到客户端计算，上下文溢出

## 解决方案

本 Skill 为飞书 CLI 引入了完整的 **批量数据操作工作流**，包含：

### 🔁 断点续传
- 读取维护 `offset` 状态，中断后从断点恢复
- 写入维护 `batch_index` 状态，失败后从断点续写
- 所有操作记录进度状态，支持恢复

### 🔄 退避重试
- 429 速率限制 → 指数退避（2s→4s→8s，最多 3 次）
- 1254291 并发冲突 → 固定间隔重试
- 1254104 批量超限 → 自动缩减批次（500→250→125）

### 🛡️ 部分失败容错
- 单条/单批失败记录到 `failed_records`，跳过继续
- 最终统一汇报成功数、失败数、失败详情

### 📊 服务端优先聚合
- 统计分析走 `+data-query`，不拉全量到客户端
- 避免 Agent 上下文溢出

### 📝 进度汇报
- 每阶段向用户汇报已处理数/总数/断点信息
- 失败时提供恢复命令，用户可从断点继续

## 覆盖场景

| 场景 | 参考文档 |
|------|---------|
| 多维表格分页读取 | [base-read.md](references/lark-workflow-batch-data-base-read.md) |
| 多维表格批量写入 | [base-write.md](references/lark-workflow-batch-data-base-write.md) |
| 电子表格批量读写 | [sheets-ops.md](references/lark-workflow-batch-data-sheets-ops.md) |
| 文件导入导出 | [import-export.md](references/lark-workflow-batch-data-import-export.md) |
| 跨表数据迁移 | [migration.md](references/lark-workflow-batch-data-migration.md) |
| 大数据分析 | [analysis.md](references/lark-workflow-batch-data-analysis.md) |
| 错误恢复机制 | [error-recovery.md](references/lark-workflow-batch-data-error-recovery.md) |

## 快速开始

### 安装飞书 CLI

```bash
npm install -g @larksuite/cli
npx skills add larksuite/cli -y -g
```

### 安装本 Skill

将本仓库的 `lark-workflow-batch-data/` 目录复制到你的 skills 目录：

```bash
# 复制到 skills 目录
cp -r lark-workflow-batch-data/ ~/.agents/skills/lark-workflow-batch-data/
```

### 配置认证

```bash
# 多维表格操作
lark-cli auth login --domain base

# 电子表格操作
lark-cli auth login --domain sheets

# 导入导出
lark-cli auth login --domain drive

# 全部
lark-cli auth login --domain base,sheets,drive
```

### 使用示例

#### 批量读取多维表格（分页续读）

```bash
# 第 1 页
lark-cli base +record-list --base-token app_xxx --table-id tbl_xxx --offset 0 --limit 200

# 第 2 页（从断点续读）
lark-cli base +record-list --base-token app_xxx --table-id tbl_xxx --offset 200 --limit 200
```

#### 批量写入多维表格（分批写入）

```bash
# 先获取字段结构（必做）
lark-cli base +field-list --base-token app_xxx --table-id tbl_xxx

# 逐条写入，每批间隔 0.5-1 秒
lark-cli base +record-upsert --base-token app_xxx --table-id tbl_xxx --json '{"姓名":"张三","部门":"技术"}'
```

#### 服务端聚合（不拉全量数据）

```bash
lark-cli base +data-query --base-token app_xxx --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [{"field_name": "部门", "alias": "dept"}],
  "measures": [{"field_name": "姓名", "aggregation": "count", "alias": "headcount"}],
  "shaper": {"format": "flat"}
}'
```

#### 导入文件到多维表格

```bash
lark-cli drive +import --file ./data.xlsx --type bitable --name "客户数据表"
```

## 文件结构

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

## 比赛评审标准对应

| 标准 | 本 Skill 如何满足 |
|------|----------------|
| **原创性** | 首个为飞书 CLI 引入断点续传 + 退避重试 + 部分失败容错 + 进度汇报体系的 Skill |
| **实用性** | 直击"Agent 操作大量数据时只处理十几条就截断"这一核心痛点，覆盖读取/写入/迁移/分析全场景 |
| **创新性** | 断点续传模式（offset/batch_index/start_row 状态变量）、指数退避重试、批次自动缩减、进度汇报模板 |
| **技术可行性** | 完全基于 lark-cli 现有命令，不依赖额外库或服务，开箱即用 |

## License

MIT