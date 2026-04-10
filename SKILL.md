---
name: lark-workflow-batch-data
version: 1.0.0
description: "批量数据操作工作流：编排飞书多维表格和电子表格的大批量读取、写入、更新、导入导出操作，内置断点续传和错误恢复机制。当用户需要处理上百或上千条数据、批量导入导出、跨表数据迁移、大数据量分析，或 Agent 操作飞书文档因数据量大而提前截断时使用。"
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli base --help; lark-cli sheets --help; lark-cli drive --help"
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

## 参考

- [lark-shared](../lark-shared/SKILL.md) — 认证、权限（必读）
- [lark-base](../lark-base/SKILL.md) — 多维表格操作
- [lark-sheets](../lark-sheets/SKILL.md) — 电子表格操作
- [lark-drive](../lark-drive/SKILL.md) — 云空间操作