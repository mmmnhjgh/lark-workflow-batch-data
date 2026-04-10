# 数据迁移

> **前置条件：** 先阅读 [`../SKILL.md`](../SKILL.md)、[`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)、[`base-read.md`](lark-workflow-batch-data-base-read.md) 和 [`base-write.md`](lark-workflow-batch-data-base-write.md)。

多云表格之间、或电子表格到多维表格的数据迁移工作流。

## 迁移架构

```
源表 ──读取──► 数据缓冲 ──映射──► 目标表
   (分页)      (分批)       (字段映射)   (分批写入)
```

## Step 1：读取源表结构

```bash
# 源表字段结构
lark-cli base +field-list --base-token <SOURCE_TOKEN> --table-id <SOURCE_TABLE_ID>

# 源表数据量确认
lark-cli base +record-list --base-token <SOURCE_TOKEN> --table-id <SOURCE_TABLE_ID> --limit 1
```

## Step 2：读取目标表结构

```bash
# 目标表字段结构（如果目标表已存在）
lark-cli base +field-list --base-token <TARGET_TOKEN> --table-id <TARGET_TABLE_ID>

# 如果目标表不存在，需要先创建
lark-cli base +table-create --base-token <TARGET_TOKEN> --json '<table_schema>'
```

## Step 3：字段映射

### 自动映射规则

根据源表和目标表的字段列表，建立映射：

| 映射策略 | 说明 |
|---------|------|
| 同名同类型 | 直接映射，无需转换 |
| 同名不同类型 | 需要类型转换 |
| 源有目标无 | 目标表需新建字段 |
| 源无目标有 | 目标表该字段留空 |

### 类型转换指引

| 源类型 | 目标类型 | 转换方式 |
|-------|---------|---------|
| text | select | 值不变，目标为单选 |
| text | number | 尝试数值化，失败设为 null |
| number | text | 转为字符串 |
| select | text | 选项名作为文本 |
| date | text | 格式化为 `YYYY-MM-DD HH:mm:ss` |
| text | date | 解析日期字符串 |

**只读字段不迁移**：formula, lookup, auto_number, created_time, modified_time, created_by, modified_by

## Step 4：分页读取 + 分批写入（核心循环）

### Base → Base 迁移

```
状态变量：{ 
  offset: 0, 
  total_read: 0, 
  total_written: 0, 
  failed_records: [] 
}

循环读取源表（每页 200 条）：
  1. 执行 +record-list --base-token <SOURCE_TOKEN> --table-id <SOURCE_TABLE_ID> --offset {offset} --limit 200
  2. 对每条记录：
     a. 过滤掉只读字段
     b. 按字段映射转换值
     c. 构造 +record-upsert --json
  3. 逐条写入目标表
  4. 每条写入后等待 0.5 秒（避免并发冲突）
  5. 记录成功/失败数量
  6. offset += 200, total_read += 本次条数

断点续传：记录 offset 和 total_written，失败后可从此处恢复
```

### Sheets → Base 迁移

```
1. 先获取 Sheets 元信息
   lark-cli sheets +info --spreadsheet-token <SHEET_TOKEN>

2. 分片读取 Sheets （每次 200 行）
   lark-cli sheets +read --spreadsheet-token <SHEET_TOKEN> --sheet-id <ID> --range "A{start}:Z{end}"

3. 将每行数据映射到 Base 字段
   - 第 1 行通常是表头，作为字段名映射依据
   - 后续行作为记录数据

4. 分批写入 Base（每批 ≤500 条）
   循环写入 +record-upsert，每条间隔 0.5 秒
```

### Base → Sheets 迁移

```
1. 分页读取 Base 表
   循环 +record-list --limit 200

2. 将记录转为二维数组格式（表头 + 数据行）

3. 分片写入 Sheets
   每 5000 行一片，使用 +write 或 +append
```

## Step 5：增量迁移

当只需迁移新增或变更记录时：

### 方案 A：时间戳筛选

```bash
# 使用视图筛选（先创建筛选视图）
lark-cli base +view-set-filter --base-token <TOKEN> --table-id <ID> \
  --view-id <VIEW_ID> --json '<filter_conditions>'

# 读取筛选后的记录
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> \
  --view-id <VIEW_ID> --limit 200
```

### 方案 B：服务端查询

```bash
# 使用 +data-query 筛选特定条件的记录
lark-cli base +data-query --base-token <TOKEN> --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [],
  "measures": [{"field_name": "字段名", "aggregation": "count"}],
  "filters": {
    "type": 1,
    "conjunction": "and",
    "conditions": [{"field_name": "更新时间", "operator": "isGreater", "value": ["2026-04-01 00:00:00"]}]
  },
  "shaper": {"format": "flat"}
}'
```

## Step 6：校验

迁移完成后，对比源表和目标表的记录数：

```bash
# 源表记录数（取 total 字段或读最后一页的 offset）
lark-cli base +record-list --base-token <SOURCE_TOKEN> --table-id <SOURCE_TABLE_ID> --limit 1

# 目标表记录数
lark-cli base +record-list --base-token <TARGET_TOKEN> --table-id <TARGET_TABLE_ID> --limit 1
```

**校验清单：**

| 校验项 | 方法 |
|--------|------|
| 记录总数 | 对比源表和目标表的总记录数 |
| 关键字段完整性 | 抽样读取 10 条记录，检查字段值是否完整 |
| 数据类型正确性 | 检查 number、date 等类型是否正确转换 |
| 空值处理 | 确认源表空值在目标表的表现（null vs 空字符串） |

## 迁移进度汇报模板

```
## 迁移进度汇报

| 指标 | 数值 |
|------|------|
| 源表记录总数 | {source_total} |
| 已读取 | {total_read} |
| 已写入成功 | {total_written} |
| 写入失败 | {len(failed_records)} |
| 当前读取断点 | offset={offset} |

失败记录详情（如有）：
- 记录 #{id}: {错误原因}

预计剩余：{source_total - total_read} 条待读取

是否继续？
```

## 特殊场景

### 大表迁移优化

单表超过 1 万条记录时：
1. 先将源表导出为 CSV（使用 `+export` 或 `+record-list` 全量导出）
2. 使用 `drive +import --type bitable` 导入到目标 Base
3. 导入后使用 `+field-update` 调整字段类型

### 多表关联迁移

迁移有关联关系（link 字段）的表时：
1. **先迁移被关联的表**（获取目标表的记录 ID 映射）
2. **再迁移关联表**（将源表的 link 值替换为目标表的记录 ID）
3. 映射关系需要在迁移过程中记录源 record_id → 目标 record_id

## 与其他模块配合

- 读取源数据 → [`base-read.md`](lark-workflow-batch-data-base-read.md)
- 写入目标表 → [`base-write.md`](lark-workflow-batch-data-base-write.md)
- 文件导入 → [`import-export.md`](lark-workflow-batch-data-import-export.md)
- 分析统计 → [`analysis.md`](lark-workflow-batch-data-analysis.md)
- 错误处理 → [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)