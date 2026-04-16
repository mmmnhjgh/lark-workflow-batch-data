---
name: lark-workflow-batch-data
version: 2.0.0
description: "飞书批量数据操作（高优先级）：处理所有飞书多维表格和电子表格的大批量数据操作。当涉及超过20条读取、超过10条写入、任何数据分析、文件导入导出、跨表迁移，或提到'批量''全部''上千条''所有数据''统计''汇总''导入''导出''迁移''Excel'等关键词时，必须使用此 Skill！"
metadata:
  priority: 100
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli base --help; lark-cli sheets --help; lark-cli drive --help"
  triggers:
    - "批量"
    - "全部"
    - "所有数据"
    - "上千条"
    - "几百条"
    - "读取所有"
    - "导出"
    - "导入"
    - "Excel"
    - "CSV"
    - "统计"
    - "分析"
    - "汇总"
    - "迁移"
    - "同步"
    - "只处理了十几条"
    - "数据量大"
    - "翻页"
    - "分页"
    - "断点续传"
  examples:
    - input: "帮我读取这个多维表格的所有数据"
      output: "使用 base_read_batch 模板"
    - input: "把这 2000 条数据写入多维表格"
      output: "使用 base_write_batch 模板"
    - input: "统计各部门的人数"
      output: "使用 base_analysis 模板"
    - input: "把这个 Excel 导入到飞书"
      output: "使用 excel_import 模板"
    - input: "把 A 表的数据迁移到 B 表"
      output: "使用 data_migration 模板"
  templates:
    - name: base_read_batch
      description: "批量读取多维表格数据，自动分页续读、断点续传、进度显示"
      params:
        base_token: "多维表格的 token（必需）"
        table_id: "表 ID 或表名（必需）"
        limit: "每页条数，默认 200"
        offset: "起始偏移量，默认 0（用于断点续传）"
      example: "帮我读取这个多维表格的所有数据，有 3000 条"
    - name: base_write_batch
      description: "批量写入数据到多维表格，自动分批处理、写前校验、失败记录收集"
      params:
        base_token: "多维表格的 token（必需）"
        table_id: "表 ID 或表名（必需）"
        data: "要写入的数据列表（必需）"
        batch_size: "每批条数，默认 500"
      example: "帮我把这 2000 条数据写入多维表格"
    - name: base_analysis
      description: "使用服务端聚合分析数据，避免上下文溢出"
      params:
        base_token: "多维表格的 token（必需）"
        table_id: "表 ID 或表名（必需）"
        dimensions: "维度字段列表，例如：['部门']"
        measures: "度量字段列表，例如：[{field_name: '姓名', aggregation: 'count'}]"
      example: "帮我统计各部门的人数和平均薪资"
    - name: data_migration
      description: "跨表数据迁移，自动处理字段映射和进度追踪"
      params:
        source_base_token: "源多维表格的 token（必需）"
        source_table_id: "源表 ID 或表名（必需）"
        target_base_token: "目标多维表格的 token（必需）"
        target_table_id: "目标表 ID 或表名（必需）"
        field_mapping: "字段映射，例如：{'源字段': '目标字段'}"
      example: "帮我把 A 表的数据迁移到 B 表"
    - name: excel_import
      description: "导入 Excel/CSV 到多维表格，处理超时、状态轮询和断点续传"
      params:
        file_path: "Excel/CSV 文件路径（必需）"
        base_name: "目标多维表格名称"
      example: "帮我把这个 data.xlsx 导入到飞书多维表格"
---

# 批量数据操作工作流

**CRITICAL — 开始前 MUST 先用 Read 工具读取 [`../lark-shared/SKILL.md`](../lark-shared/SKILL.md)，其中包含认证、权限处理**

## 适用场景

- "帮我把这个 Excel 导入到多维表格" / "批量写入上千条记录"
- "导出多维表格所有数据" / "把表里的数据全量拉出来"
- "把 A 表的数据迁移到 B 表" / "跨表同步数据"
- "分析这张表的销售汇总" / "统计各部门人数"
- "我的 Agent 操作飞书文档时只处理了十几条数据就停了"
- "批量更新几千条记录的某个字段"

## 核心问题

Agent 直接调用飞书 API 操作大数据量文档时，常遇到以下问题导致只能处理十几条数据就中断：

| 痛点 | 根因 | 本 Skill 对策 |
|------|------|---------------|
| 单次返回数据有限 | API 分页限制（200条/页） | 分页续读 + 断点续传 |
| 写入大量数据超时 | 缺少分批策略 | 500条/批 + 批次间延迟 |
| 并发写入冲突 | 1254291 错误 | 串行写入 + 退避重试 |
| 网络波动中断 | 无恢复机制 | 断点续传从上次进度恢复 |
| 字段类型不匹配 | 1254015 错误 | 写前校验 + 跳过错误记录 |
| 全量拉取到客户端计算 | 上下文溢出 | 服务端聚合 +data-query |

## 前置条件

根据操作类型授权对应 scope：

```bash
# 多维表格操作
lark-cli auth login --domain base

# 电子表格操作
lark-cli auth login --domain sheets

# 导入导出
lark-cli auth login --domain drive

# 全部场景
lark-cli auth login --domain base,sheets,drive
```

## 决策树

```
用户意图
├── 读取/导出大量数据
│   ├── 只需聚合统计 → +data-query（服务端计算）→ 参考 analysis.md
│   ├── 需要全量明细
│   │   ├── Base 表 → +record-list 分页续读 → 参考 base-read.md
│   │   ├── Sheets 表 → +read 分片 或 +export 导出 → 参考 sheets-ops.md
│   │   └── 导出为文件 → +export → 参考 import-export.md
│   └── 部分数据 → +record-list --view-id 视图筛选
├── 写入/更新大量数据
│   ├── Base 表 → +record-upsert 分批写入 → 参考 base-write.md
│   ├── Sheets 表 → +write/+append 分片写入 → 参考 sheets-ops.md
│   └── 从本地文件导入 → drive +import → 参考 import-export.md
├── 数据迁移（A→B）
│   └── 读取源 → 写入目标 → 参考 migration.md
├── 遇到错误需要恢复
│   └── 参考断点信息 → 参考 error-recovery.md
└── Agent 操作截断
    └── 使用分页续读模式 → 参考 base-read.md 或 sheets-ops.md
```

## 全局原则

| # | 原则 | 说明 |
|---|------|------|
| 1 | **分而不全** | 永远不要一次拉取/写入全部数据，采用分页/分批 + 断点续传 |
| 2 | **读前知结构** | 写入前必先 `+field-list`，读取前必先 `+info` 或 `+table-get` |
| 3 | **服务端优先** | 统计分析走 `+data-query`，不拉全量到客户端 |
| 4 | **串行不并发** | 所有 `+xxx-list` 禁止并发调用 |
| 5 | **批次间延迟** | 写操作每批间隔 0.5–1 秒 |
| 6 | **失败不停步** | 单条/单批失败时记录错误继续后续，最终统一汇报 |
| 7 | **断点可续** | 每次调用记录 offset/batch_index，失败后可从此处恢复 |
| 8 | **干跑预览** | 写入前 `--dry-run` 确认参数（如支持） |
| 9 | **只写存储字段** | 跳过 formula/lookup/系统字段 |
| 10 | **进度透明** | 每完成一个阶段向用户汇报已处理/总数/断点信息 |

## 错误恢复策略总纲

> **执行任何批量操作前，MUST 先阅读 [`error-recovery.md`](references/lark-workflow-batch-data-error-recovery.md)**，了解完整的错误分类、重试策略、断点续传模式和进度汇报模板。

核心机制：

1. **断点续传** — 维护进度状态变量（offset / batch_index / start_row），失败后从断点恢复
2. **指数退避重试** — 429 速率限制 → 2s→4s→8s，最多 3 次；1254291 并发冲突 → 等 1s 重试
3. **部分失败容错** — 记录失败记录到 `failed_records`，跳过继续，最终统一汇报
4. **批次自动缩减** — 1254104 批量超限 → 自动将批次从 500 缩减到 250→125
5. **进度汇报** — 每阶段结束向用户报告成功/失败/断点信息

## Wiki 链接特殊处理

知识库链接（`/wiki/TOKEN`）背后可能是多维表格或电子表格。**不能直接假设 URL 中的 token 就是 base_token 或 spreadsheet_token**，必须先查询实际类型和真实 token：

```bash
lark-cli wiki spaces get_node --params '{"token":"wiki_token"}'
```

根据返回的 `obj_type` 选择后续操作：

| obj_type | 后续操作 |
|----------|---------|
| `bitable` | 使用 `node.obj_token` 作为 `--base-token` |
| `sheet` | 使用 `node.obj_token` 作为 spreadsheet token |

## 模块索引

| 模块 | 参考文档 | 说明 |
|------|---------|------|
| Base 分页读取 | [`base-read.md`](references/lark-workflow-batch-data-base-read.md) | +record-list 分页续读、断点续读、视图筛选 |
| Base 批量写入 | [`base-write.md`](references/lark-workflow-batch-data-base-write.md) | +record-upsert 分批写入、断点续写、写前校验 |
| Sheets 批量操作 | [`sheets-ops.md`](references/lark-workflow-batch-data-sheets-ops.md) | +read 分片、+write/+append 批量、+export 导出 |
| 导入导出 | [`import-export.md`](references/lark-workflow-batch-data-import-export.md) | drive +import、sheets +export、超时续查 |
| 数据迁移 | [`migration.md`](references/lark-workflow-batch-data-migration.md) | 源→目标迁移、字段映射、增量同步 |
| 大数据分析 | [`analysis.md`](references/lark-workflow-batch-data-analysis.md) | +data-query 服务端聚合、条件分析 |
| 错误恢复 | [`error-recovery.md`](references/lark-workflow-batch-data-error-recovery.md) | 错误分类、重试策略、断点续传、进度汇报 |

## 权限表

| 操作 | 所需 scope |
|------|-----------|
| 多维表格读取 | `base:base:read` |
| 多维表格写入 | `base:base:write` |
| 电子表格读取 | `sheets:spreadsheet:read` |
| 电子表格写入 | `sheets:spreadsheet:write` |
| 文件导入 | `drive:drive:write` |
| 文件导出 | `drive:drive:read` |

## OpenClaw 集成与 API 融合

### 问题分析

当使用 OpenClaw 时，可能会出现以下问题：
- OpenClaw 倾向于直接调用飞书 API，而不是使用本 Skill
- 即使使用本 Skill，也可能出现上下文溢出或操作中断的情况
- 缺乏标准化的模板，导致每次操作都需要重新构造命令

### 融合方案

#### 1. 智能路由机制

当检测到以下场景时，自动使用本 Skill 而非直接 API 调用：

| 场景 | 条件 | 处理方式 |
|------|------|----------|
| 大批量读取 | 数据量 > 200 条或用户明确要求全量数据 | 使用 `base_read_batch` 模板，自动分页续读 |
| 大批量写入 | 数据量 > 50 条或用户明确要求批量写入 | 使用 `base_write_batch` 模板，自动分批处理 |
| 数据分析 | 用户要求统计、汇总等分析操作 | 使用 `base_analysis` 模板，服务端聚合 |
| 跨表迁移 | 用户要求在不同表格间迁移数据 | 使用 `data_migration` 模板，自动字段映射 |
| 文件导入 | 用户要求导入 Excel/CSV 文件 | 使用 `excel_import` 模板，处理超时和断点 |

#### 2. 自动降级策略

当遇到以下情况时，自动从 API 调用降级到本 Skill：

1. **API 调用失败**：当直接 API 调用返回 429（速率限制）、1254291（并发冲突）等错误时
2. **上下文溢出**：当 Agent 处理数据时出现上下文长度限制警告
3. **操作中断**：当批量操作中途停止，需要断点续传时

#### 3. 模板使用指南

OpenClaw 可以通过以下方式使用模板：

```python
# 示例：使用 base_read_batch 模板读取大量数据
from lark_workflow_batch_data import BaseReadBatch

reader = BaseReadBatch(
    base_token="app_xxx",
    table_id="tbl_xxx",
    limit=200
)

# 自动分页读取所有数据
results = reader.read_all()

# 处理结果
for batch in results:
    print(f"读取了 {len(batch)} 条记录")
```

#### 4. 环境变量配置

为了让 OpenClaw 能够自动识别并使用本 Skill，建议设置以下环境变量：

```bash
# .env 文件
LARK_WORKFLOW_BATCH_DATA_ENABLED=true
LARK_WORKFLOW_BATCH_DATA_THRESHOLD=200  # 触发批量处理的阈值
LARK_WORKFLOW_BATCH_DATA_RETRY_TIMES=3  # 重试次数
```

### 实现建议

1. **创建 Python 包装器**：为 lark-cli 命令创建 Python 包装器，使 OpenClaw 能够更方便地调用

2. **添加状态管理**：在 OpenClaw 中添加状态管理模块，记录批量操作的进度和断点

3. **智能检测**：实现智能检测机制，自动判断何时使用本 Skill，何时使用直接 API 调用

4. **错误处理统一**：统一处理 API 错误和 Skill 错误，提供一致的错误恢复机制

5. **进度反馈**：在 OpenClaw 界面中显示批量操作的进度，让用户了解当前状态

### 示例：OpenClaw 集成代码

```python
# openclaw_lark_integration.py

def handle_lark_operation(user_input, context):
    # 检测操作类型和数据量
    operation_type = detect_operation_type(user_input)
    data_size = estimate_data_size(user_input, context)
    
    # 智能路由
    if operation_type == "read" and data_size > 200:
        # 使用批量读取模板
        return use_template("base_read_batch", user_input, context)
    elif operation_type == "write" and data_size > 50:
        # 使用批量写入模板
        return use_template("base_write_batch", user_input, context)
    elif operation_type == "analysis":
        # 使用服务端分析模板
        return use_template("base_analysis", user_input, context)
    elif operation_type == "migration":
        # 使用数据迁移模板
        return use_template("data_migration", user_input, context)
    elif operation_type == "import":
        # 使用文件导入模板
        return use_template("excel_import", user_input, context)
    else:
        # 使用直接 API 调用
        return use_direct_api(operation_type, user_input, context)
```

## 参考

- [lark-shared](../lark-shared/SKILL.md) — 认证、权限（必读）
- [lark-base](../lark-base/SKILL.md) — 多维表格操作
- [lark-sheets](../lark-sheets/SKILL.md) — 电子表格操作
- [lark-drive](../lark-drive/SKILL.md) — 云空间操作