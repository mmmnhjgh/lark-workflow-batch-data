# Sheets 批量操作

> **前置条件：** 先阅读 [`../SKILL.md`](../SKILL.md) 和 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)。

电子表格（Sheets）大批量读取、写入、导出的工作流。

## 核心命令

| 操作 | 命令 | 说明 |
|------|------|------|
| 获取元信息 | `+info` | 获取 sheet ID、行数、列数 |
| 读取 | `+read` | 读取单元格范围，最多 200 行/次 |
| 写入覆盖 | `+write` | 覆盖写入，最多 5000 行 × 100 列 |
| 追加 | `+append` | 追加行，最多 5000 行 × 100 列 |
| 导出 | `+export` | 导出为 xlsx 或 csv |

## 写前准备

```bash
# Step 1：获取表格元信息（sheet ID、行数、列数）
lark-cli sheets +info --spreadsheet-token <TOKEN>

# Step 2（推荐）：干跑预览
lark-cli sheets +write --spreadsheet-token <TOKEN> --range "<SHEET_ID>!A1" --values '<JSON>' --dry-run
```

## 大批量读取

### 分片读取模式

`+read` 每次最多返回 200 行，需要分片读取：

```
状态变量：{ start_row: 1, total_read: 0 }

1. 先获取总行数（+info）确认数据范围
2. 从第 1 行开始，每次读 200 行：

lark-cli sheets +read --spreadsheet-token <TOKEN> \
  --sheet-id <SHEET_ID> --range "A{start_row}:Z{end_row}"

3. start_row += 200, total_read += 本次读取行数
4. 直到读取到空数据或超出总行数
```

### 全量导出模式（推荐）

需要导出全量数据时，`+export` 更高效：

```bash
# 导出为 xlsx
lark-cli sheets +export --spreadsheet-token <TOKEN> --file-extension xlsx --output-path "./data.xlsx"

# 导出为 csv（需指定 sheet-id）
lark-cli sheets +export --spreadsheet-token <TOKEN> --file-extension csv --sheet-id <SHEET_ID> --output-path "./data.csv"
```

导出后可在本地用其他工具处理数据，不受行数限制。

## 大批量写入

### 覆盖写入（+write）

```bash
# 写入到指定范围（最多 5000 行 × 100 列）
lark-cli sheets +write --spreadsheet-token <TOKEN> \
  --sheet-id <SHEET_ID> --range "A1" \
  --values '[["姓名","年龄"],["张三",25],["李四",30]]'
```

**分片写入策略**（数据超过 5000 行时）：

```
状态变量：{ start_row: 1, rows_written: 0 }

将数据按 5000 行分片：
  对于分片[start_row]：
    1. 构造 values JSON（本片的行数据）
    2. 执行 +write 指定起始范围
    
    # 第一片从 A1 开始
    lark-cli sheets +write --spreadsheet-token <TOKEN> \
      --sheet-id <SHEET_ID> --range "A1" \
      --values '<第一片数据>'
    
    # 后续片从对应行开始
    lark-cli sheets +write --spreadsheet-token <TOKEN> \
      --sheet-id <SHEET_ID> --range "A{start_row}" \
      --values '<后续片数据>'
    
    3. 成功 → start_row += 本片行数, rows_written += 本片行数
    4. 失败 → 记录 start_row，从该行恢复
    5. 每片之间等待 0.5 秒

最终汇报：总写入 {rows_written} 行
```

### 追加写入（+append）

追加模式更安全，不会覆盖现有数据：

```bash
# 追加行到数据末尾（最多 5000 行 × 100 列）
lark-cli sheets +append --spreadsheet-token <TOKEN> \
  --sheet-id <SHEET_ID> --range "A1" \
  --values '[["新增行1",100],["新增行2",200]]'
```

**分批追加策略**（数据超过 5000 行时）：

```
状态变量：{ batch_index: 0, total_appended: 0 }

将数据按 5000 行分批：
  对于 batch[batch_index]：
    1. 构造 values JSON
    2. 执行 +append（自动追加到末尾）
    3. 成功 → batch_index++, total_appended += 本批行数
    4. 失败 → 从该批恢复
    5. 每批之间等待 0.5 秒
```

## 断点续写

### 覆盖写入断点

记录 `start_row`，失败后从断点恢复：

```
失败时记录：start_row = {最后成功写入的行号 + 1}
恢复命令：
  lark-cli sheets +write --spreadsheet-token <TOKEN> \
    --sheet-id <SHEET_ID> --range "A{start_row}" \
    --values '<断点之后的行数据>'
```

### 追加写入断点

追加模式每次自动接在末尾，断点恢复更简单：

```
失败时记录：batch_index = {最后成功的批次索引}
恢复时：从 batch_index + 1 批开始继续 +append
```

## 查找后写入

先定位数据再写入：

```bash
# Step 1：查找目标行
lark-cli sheets +find --spreadsheet-token <TOKEN> \
  --sheet-id <SHEET_ID> --query "关键词"

# Step 2：根据查找结果，写入到指定位置
lark-cli sheets +write --spreadsheet-token <TOKEN> \
  --sheet-id <SHEET_ID> --range "D10" \
  --values '[["更新值"]]'
```

## 写入校验

写入后验证数据完整性：

```bash
# 读取刚写入的区域，确认行数匹配
lark-cli sheets +read --spreadsheet-token <TOKEN> \
  --sheet-id <SHEET_ID> --range "A1:D{expected_end_row}"
```

对比返回的 `updated_rows` / `updated_cells` 与预期值，判断写入是否完整。

## 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 写入后数据显示 #REF! | 范围冲突 | 确认 range 不与其他写入操作重叠 |
| 只写了部分行 | 超过 5000 行限制 | 分片写入，每片 ≤5000 行 |
| 追加后数据位置不对 | range 参数不当 | 用 `A1` 即可，+append 自动定位末尾 |
| 权限不足 | 无写入权限 | `auth login --domain sheets` 或切换 `--as` |

## 与其他模块配合

- 写入前需要读取源表数据 → 参考 [`base-read.md`](lark-workflow-batch-data-base-read.md)
- Base 表批量写入 → 参考 [`base-write.md`](lark-workflow-batch-data-base-write.md)
- 从文件导入 → 参考 [`import-export.md`](lark-workflow-batch-data-import-export.md)
- 数据迁移 → 参考 [`migration.md`](lark-workflow-batch-data-migration.md)
- 遇到错误 → 参考 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)