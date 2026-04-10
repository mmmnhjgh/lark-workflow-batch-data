# Base 分页读取

> **前置条件：** 先阅读 [`../SKILL.md`](../SKILL.md) 和 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)。

多维表格（Base）大数据量读取的工作流，解决 Agent 只读十几条就停的问题。

## 核心命令

```bash
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset <N> --limit <N>
```

| 参数 | 说明 |
|------|------|
| `--base-token` | Base Token（wiki 链接需先转 obj_token） |
| `--table-id` | 表 ID 或表名 |
| `--offset` | 分页偏移，默认 `0` |
| `--limit` | 每页条数，范围 1–200，默认 100 |
| `--view-id` | 可选，按视图筛选读取 |

## 分页续读工作流

### 标准分页模式（推荐）

适用于：需要读取全量或大量数据

```
步骤 1：获取总览（可选，确认数据量）
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset 0 --limit 1

步骤 2：循环分页读取
offset = 0
total_read = 0
has_more = true

while has_more:
    执行: lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset {offset} --limit 200
    
    成功 → total_read += 返回记录数, offset += 返回记录数
    失败且可重试 → 等待后重试（offset 不变）
    失败且不可恢复 → 报告断点 offset，等待用户指示
    
    检查 has_more：
    has_more=true → 继续循环
    has_more=false → 结束

步骤 3：汇报结果
"共读取 {total_read} 条记录。"
```

### 按需读取模式

适用于：用户只需前 N 条或样例数据

```bash
# 只看前 10 条样例
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --limit 10

# 按视图筛选读取
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --view-id <VIEW_ID> --limit 200
```

按需读取时，**不继续翻页**，即使用户需要更多数据也只在用户明确要求时才继续。

### API 级别全量拉取

适用于：需要一次性拉取所有数据用于导出

```bash
# 使用 --page-all 自动翻页（仅 API 命令支持）
lark-cli base records list --base-token <TOKEN> --table-id <ID> --page-all --page-limit 0
```

> ⚠️ Shortcut 命令（`+record-list`）不支持 `--page-all`，需要在循环中手动翻页。

## 断点续读

当分页读取中断后（网络超时、上下文溢出等），可从断点恢复：

```bash
# 从上次成功读取的 offset 继续读
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset {last_offset} --limit 200
```

**断点信息记录**：每次成功读取后，记录当前 `offset` 值。这样即使中断，也能从断点恢复。

## 读取优化策略

### 1. 减少数据量 — 视图筛选

```bash
# 先设置视图筛选条件
lark-cli base +view-set-filter --base-token <TOKEN> --table-id <ID> --view-id <VIEW_ID> --json '<filter>'

# 再按筛选后结果读取
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --view-id <VIEW_ID> --limit 200
```

### 2. 减少数据量 — 服务端聚合

只需统计结果时，**不要拉全量数据到客户端**，使用 `+data-query` 服务端聚合：

```bash
# 统计各部门人数
lark-cli base +data-query --base-token <TOKEN> --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [{"field_name": "部门", "alias": "dept"}],
  "measures": [{"field_name": "姓名", "aggregation": "count", "alias": "count"}],
  "shaper": {"format": "flat"}
}'
```

详见 [`analysis.md`](lark-workflow-batch-data-analysis.md)。

### 3. 合理设置 page size

| 场景 | 推荐 limit | 说明 |
|------|-----------|------|
| 样例查看 | 10 | 快速了解数据结构 |
| 正常分页 | 100 | 平衡性能和数据量 |
| 大批量导出 | 200 | 减少请求次数 |

## 与其他模块配合

- 读取后需要写入另一张表 → 参考 [`migration.md`](lark-workflow-batch-data-migration.md)
- 读取后需要更新当前表 → 参考 [`base-write.md`](lark-workflow-batch-data-base-write.md)
- 只需要统计分析 → 参考 [`analysis.md`](lark-workflow-batch-data-analysis.md)
- 遇到错误 → 参考 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)