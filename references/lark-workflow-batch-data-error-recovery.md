# 错误恢复机制

> 本文件是批量数据操作的错误恢复核心参考。执行任何批量操作前必须阅读。

## 1. 错误分类与应对

| 类别 | 错误码/信号 | 是否可重试 | 恢复策略 |
|------|-----------|----------|---------|
| 速率限制 | HTTP 429 / `rate_limit` | ✅ 可重试 | 指数退避重试（2s→4s→8s，最多3次） |
| 并发冲突 | 1254291 | ✅ 可重试 | 等待 1s 后重试当前批次 |
| 批量超限 | 1254104（>500条） | ⚠️ 需调整 | 自动将批次缩减一半重试（500→250→125），最多缩减2次 |
| 字段类型不匹配 | 1254015 | ❌ 需修正 | 跳过错误记录，收集到 `failed_records` |
| 字段不存在 | 1254045 | ❌ 需修正 | 停止并提示字段名，建议先 `+field-list` 确认 |
| Token 无效 | `param baseToken is invalid` / `base_token invalid` | ❌ 需修正 | 检查是否为 wiki 链接需要转换为 obj_token |
| 权限不足 | 125403 / Permission denied | ❌ 需授权 | 提示 `auth login --domain base` 或切换 `--as` 身份 |
| 记录不存在 | 1254044 | ❌ 跳过 | 删除操作时记录已不存在，直接跳过 |
| 网络超时 | timeout / connection error | ✅ 可重试 | 从断点续传（offset / batch_index / start_row） |
| 部分成功 | 混合成功+失败 | ⚠️ 部分可恢复 | 记录断点，跳过失败记录，继续后续批次 |

## 2. 重试策略

### 2.1 指数退避重试（适用于 429 速率限制、网络超时）

```
首次失败 → 等待 2 秒 → 重试
二次失败 → 等待 4 秒 → 重试
三次失败 → 等待 8 秒 → 重试
四次失败 → 标记为不可恢复，报告断点信息
```

### 2.2 固定间隔重试（适用于 1254291 并发冲突）

```
失败 → 等待 1 秒 → 重试
再失败 → 等待 1 秒 → 重试
三次失败后 → 等待 2 秒 → 重试
连续 5 次失败 → 标记为不可恢复
```

### 2.3 批次缩减重试（适用于 1254104 批量超限）

```
批次 500 条 → 1254104 报错 → 缩减为 250 条重试
批次 250 条 → 1254104 报错 → 缩减为 125 条重试
批次 125 条 → 1254104 报错 → 缩减为 50 条重试
批次 50 条 → 仍然报错 → 标记为不可恢复，可能是字段内容本身的问题
```

## 3. 断点续传模式

### 3.1 读取断点续读（Base +record-list）

维护进度状态，失败后从断点恢复：

```
状态变量：{ offset: 0, total_read: 0, has_more: true }

循环：
  1. 执行 lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset {offset} --limit 200
  2. 成功 → offset += 返回记录数, total_read += 返回记录数
  3. 失败且可重试 → 等待后重试（offset 不变）
  4. 失败且不可恢复 → 报告已读 offset，用户可从该 offset 恢复
  5. has_more 为 false → 结束

恢复命令示例：
  lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset {last_successful_offset} --limit 200
```

### 3.2 写入断点续写（Base +record-upsert 批量）

```
状态变量：{ batch_index: 0, total_written: 0, failed_records: [] }

将数据拆分为每批 ≤500 条：
  对于 batch[batch_index]：
    1. 执行 +record-upsert --json '{fields}'（逐条写入）
       或构建批量请求
    2. 成功 → batch_index++, total_written += 本批数量
    3. 失败且可重试 → 等待后重试当前 batch_index
    4. 失败且不可恢复 → 记录到 failed_records，batch_index++（跳过继续）
    5. 批次间延迟 0.5–1 秒

最终汇报：total_written 条成功，failed_records 中为失败详情

恢复信息：
  "已写入 {total_written} 条，失败 {len(failed_records)} 条。
   下次从第 {batch_index * batch_size + 1} 条继续。"
```

### 3.3 Sheets 写入断点续写

```
状态变量：{ start_row: 1, rows_written: 0 }

将数据按 5000 行分片：
  对于分片[start_row]：
    1. 执行 +write 或 +append 写入该分片
    2. 成功 → start_row += 5000, rows_written += 本片行数
    3. 失败 → 记录 start_row，从该行恢复

恢复命令示例：
  lark-cli sheets +append --spreadsheet-token <TOKEN> --sheet-id <ID> --values '<JSON>'
  （从 start_row 对应的数据分片开始）
```

## 4. 写入前置校验

在任何写入操作前，**必须**执行以下校验步骤，避免大量失败：

```bash
# Step 1: 获取字段结构
lark-cli base +field-list --base-token <TOKEN> --table-id <ID>

# Step 2: 过滤只读字段
# 从返回结果中标记以下字段类型为只读，写入时跳过：
# type=formula, type=lookup, type=auto_number
# property.created_time, property.modified_time
# property.created_by, property.modified_by

# Step 3（推荐）: 抽样验证连通性和权限
lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --limit 1

# Step 4（推荐）: 干跑预览（如支持）
lark-cli base +record-upsert --base-token <TOKEN> --table-id <ID> --json '{sample_data}' --dry-run
```

### 类型校验清单

| 字段类型 | 正确格式 | 常见错误 |
|---------|---------|---------|
| text / phone / url | `"字符串"` | 传数字、传对象 |
| number | `12.5` | 传字符串 `"12.5"` |
| select（单选） | `"选项名"` | 传选项 ID |
| select（多选） | `["A","B"]` | 传字符串而非数组 |
| datetime | `"2026-03-24 10:00:00"` | 传秒级时间戳 |
| checkbox | `true` / `false` | 传字符串 `"true"` |
| user | `[{"id":"ou_xxx"}]` | 传纯字符串 |
| link（关联） | `[{"id":"rec_xxx"}]` | 传纯字符串 |
| attachment | 必须用 `+record-upload-attachment` | 直接写 file_token |

## 5. 进度汇报模板

每个批量操作完成后，向用户汇报以下格式的进度：

```
## 批量操作汇报

| 指标 | 数值 |
|------|------|
| 目标总数 | {total} |
| 已成功 | {succeeded} |
| 已失败 | {failed} |
| 已跳过 | {skipped} |
| 当前断点 | {last_offset / batch_index / start_row} |
| 操作类型 | {读取 / 写入 / 更新 / 迁移} |

失败记录详情（如有）：
- 记录 #{id}: {错误原因}

恢复建议（如需断点续传）：
  从 offset={last_offset} 继续：lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset {last_offset} --limit 200

是否需要从断点继续？
```

## 6. 常见错误速查

| 错误码 | 含义 | 解决方案 |
|--------|------|----------|
| 1254064 | 日期格式错误 | 用毫秒时间戳或 `YYYY-MM-DD HH:mm:ss`，不用秒级时间戳 |
| 1254068 | 超链接格式错误 | 用 `{text, link}` 对象 |
| 1254066 | 人员字段错误 | 用 `[{"id":"ou_xxx"}]`，并确认 `user_id_type` |
| 1254045 | 字段名不存在 | 先 `+field-list` 确认字段名（含空格、大小写） |
| 1254015 | 字段值类型不匹配 | 先 `+field-list` 获取字段类型，再按类型构造值 |
| 1254104 | 批量超 500 条 | 分批调用，每批 ≤500 条 |
| 1254291 | 并发写冲突 | 串行写入 + 批次间延迟 0.5–1s |
| `param baseToken is invalid` | Token 错误 | 如为 wiki 链接，先用 `wiki spaces get_node` 获取真实 obj_token |

## 7. Agent 操作截断恢复场景

当 Agent 因为数据量大只处理了部分数据就中断时：

### 场景 A：读取中断

```
症状：Agent 只返回了前 10–20 条记录就停止
原因：未使用分页，或一次性返回数据超出上下文
恢复：
  1. 确认已读取的数量（通常为 --limit 默认值）
  2. 使用 --offset 从断点续读：
     lark-cli base +record-list --base-token <TOKEN> --table-id <ID> --offset {已读数量} --limit 200
  3. 重复直到 has_more=false
```

### 场景 B：写入中断

```
症状：批量写入只完成了一部分
原因：网络超时、并发冲突、上下文溢出
恢复：
  1. 确认已成功写入的数量（检查目标表记录数）
  2. 从未写入的数据开始，重新执行批量写入
  3. 使用 +record-list 确认已有数据，避免重复写入
```

### 场景 C：分析截断

```
症状：统计结果只包含部分数据
原因：拉取全量数据到客户端计算，数据量超出上下文
恢复：
  切换为 +data-query 服务端聚合，避免拉全量数据
  参考 analysis.md
```