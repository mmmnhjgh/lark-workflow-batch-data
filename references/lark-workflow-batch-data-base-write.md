# Base 批量写入

> **前置条件：** 先阅读 [`../SKILL.md`](../SKILL.md) 和 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)。

多维表格（Base）大批量写入的工作流，包含写前校验、分批策略、断点续写和错误恢复。

## 核心命令

```bash
# 创建单条记录
lark-cli base +record-upsert --base-token <TOKEN> --table-id <ID> --json '{"字段名":"值"}'

# 更新记录（带 record-id）
lark-cli base +record-upsert --base-token <TOKEN> --table-id <ID> --record-id <REC_ID> --json '{"字段名":"新值"}'
```

## 写前校验（必做）

在写入任何数据之前，**必须**执行以下步骤：

### Step 1：获取字段结构

```bash
lark-cli base +field-list --base-token <TOKEN> --table-id <ID>
```

从返回结果中：
- **标记存储字段**（可写）：text, number, select, multi_select, date, checkbox, user, link, location, phone, url, email
- **标记只读字段**（不可写）：formula, lookup, auto_number, created_time, modified_time, created_by, modified_by
- **特殊处理**：attachment 字段必须用 `+record-upload-attachment`，不能通过 `+record-upsert` 写入

### Step 2：构造写入数据

根据字段类型构造正确的 JSON 值（详见 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md) 的"类型校验清单"）：

```json
{
  "项目名称": "Apollo",
  "状态": "进行中",
  "标签": ["高优", "外部依赖"],
  "工时": 8,
  "截止时间": "2026-03-24 10:00:00",
  "负责人": [{"id": "ou_xxx"}],
  "关联任务": [{"id": "rec_xxx"}]
}
```

### Step 3：连通性验证（推荐）

```bash
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --limit 1
```

确认 Token 和表 ID 有效，且当前身份有读写权限。

### Step 4：干跑预览（如支持）

```bash
lark-cli base +record-upsert --base-token <TOKEN> --table-id <ID> --json '{sample_data}' --dry-run
```

## 分批写入工作流

### 标准分批模式（推荐）

适用于：创建大量新记录

```
准备数据 → 拆分为每批 ≤500 条 → 逐批写入 → 批次间延迟

将数据拆分为批次（每批 ≤500 条）：
  batch_index = 0
  total_written = 0
  failed_records = []
  
  对于 batch[batch_index] 中的每条记录：
    1. 构造 --json（只包含存储字段）
    2. 执行 +record-upsert --json '{fields}'
    3. 成功 → total_written++
    4. 失败且可重试 → 等待后重试
    5. 失败且不可恢复 → 记录到 failed_records，跳过继续
    
  每批完成后：
    - 等待 0.5–1 秒
    - 汇报进度："已写入 {total_written} 条，当前批次 {batch_index+1}/{total_batches}"
    
  所有批次完成后：
    - 汇报最终结果（成功数、失败数、失败详情）
```

### 更新模式

适用于：批量更新已有记录

```
步骤 1：读取需要更新的记录
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --limit 200

步骤 2：提取 record_id 和需要更新的字段

步骤 3：逐条更新（每批 ≤500 条，串行执行）
lark-cli base +record-upsert --base-token <TOKEN> --table-id <ID> \
  --record-id <REC_ID> --json '{"字段名":"新值"}'

注意：更新时必须传 --record-id，否则会创建新记录
```

### 批量更新单字段

适用于：批量修改某几条记录的某个字段

```
步骤 1：获取目标记录 ID 列表
（通过 +record-list 或 +data-query 获取）

步骤 2：逐条更新（串行，记录间延迟 0.5s）
for each record_id:
    lark-cli base +record-upsert --base-token <TOKEN> --table-id <ID> \
      --record-id <REC_ID> --json '{"目标字段":"新值"}'
    等待 0.5 秒
```

## 断点续写

当写入中断后恢复：

**关键状态变量：**

| 变量 | 说明 | 恢复方式 |
|------|------|---------|
| `total_written` | 已成功写入条数 | 从数据列表的第 `total_written + 1` 条继续 |
| `failed_records` | 失败记录列表 | 汇报给用户，不重复写入 |
| `batch_index` | 当前批次索引 | 从该批次的第一条继续 |

**恢复流程：**

```
1. 确认已写入数量：lark-cli base +record-list --limit 1 检查表状态
2. 从未写入的数据开始，重新执行批量写入
3. 已写入的记录跳过（可通过 record_id 检查避免重复）
```

**避免重复写入：**

- 如果使用 `+record-upsert` 不带 `--record-id`，每次调用都会创建新记录
- 为避免中断恢复后重复创建，建议：
  - 方案 A：写入前先查询已有记录，计算差集后只写入差集
  - 方案 B：添加唯一标识字段，写入时检查是否已存在
  - 方案 C：记录已写入的 record_id 列表，恢复时跳过已写入的

## 字段写入规范速查

| 字段类型 | 写入值格式 | 注意事项 |
|---------|-----------|---------|
| text | `"字符串"` | 传 null 可清空 |
| number | `12.5` | 传数字，不传字符串 |
| select（单选） | `"Todo"` | 传选项名，不传 ID |
| multi_select | `["A","B"]` | 传选项名数组 |
| date | `"2026-03-24 10:00:00"` | 优先用此格式 |
| checkbox | `true` / `false` | 传布尔值 |
| user | `[{"id":"ou_xxx"}]` | 至少包含 id |
| link（关联） | `[{"id":"rec_xxx"}]` | 至少包含 id |
| location | `{"lng":116.39,"lat":39.91}` | 经纬度对象 |

**严禁写入的字段：** formula, lookup, auto_number, created_time, modified_time, created_by, modified_by

**特殊字段：** attachment 必须用 `+record-upload-attachment`，不能通过 `+record-upsert` 写入

## 保守写入模板

面对不确定的数据时，采用保守策略：

```
1. 先用 1 条数据试写，验证字段映射正确
2. 检查返回结果，确认字段值符合预期
3. 再用 10 条数据小批量写入，确认稳定性
4. 最后按 500 条/批全速写入
```

## 与其他模块配合

- 写入前需要读取源数据 → 参考 [`base-read.md`](lark-workflow-batch-data-base-read.md)
- 跨表迁移数据 → 参考 [`migration.md`](lark-workflow-batch-data-migration.md)
- 遇到写入错误 → 参考 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)
- 写入电子表格 → 参考 [`sheets-ops.md`](lark-workflow-batch-data-sheets-ops.md)
- 从文件导入 → 参考 [`import-export.md`](lark-workflow-batch-data-import-export.md)