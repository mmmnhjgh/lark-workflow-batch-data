# 导入导出

> **前置条件：** 先阅读 [`../SKILL.md`](../SKILL.md) 和 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)。

本地文件导入到飞书文档、飞书文档导出到本地的完整工作流。

## 1. 导入本地文件到多维表格（Base）

### 支持的文件类型

| 本地文件扩展名 | 导入为目标 | 大小上限 |
|--------------|-----------|---------|
| `.xlsx` | `bitable` | 800MB |
| `.csv` | `bitable` | 100MB |
| `.xlsx` | `sheet` | 800MB |
| `.csv` | `sheet` | 20MB |
| `.xls` | `sheet` | 20MB |

### 导入命令

```bash
# 导入 Excel 为多维表格（Base）
lark-cli drive +import --file ./data.xlsx --type bitable --name "客户数据表"

# 导入 CSV 为多维表格
lark-cli drive +import --file ./data.csv --type bitable --name "导入数据" --folder-token <FOLDER_TOKEN>

# 导入 Excel 为电子表格
lark-cli drive +import --file ./data.xlsx --type sheet --name "月报"

# 干跑预览（不发请求）
lark-cli drive +import --file ./data.xlsx --type bitable --dry-run
```

### 导入超时恢复

导入是异步操作，大文件可能需要较长时间。`+import` 内置了轮询机制，但如果超时：

```bash
# +import 返回 ready=false 和 timed_out=true 时，使用 ticket 继续查询
lark-cli drive +task_result --scenario import --ticket <TICKET>
```

**恢复流程：**

```
1. 执行 +import
2. 返回 ready=false, timed_out=true → 记录 ticket
3. 执行 +task_result --scenario import --ticket <TICKET>
4. 重复查询直到 ready=true 或确认失败
5. 成功 → 获取 base_token/url，后续使用 lark-cli base +... 操作
```

### 导入后校验

```bash
# Step 1：获取导入后的表信息
lark-cli base +table-list --base-token <IMPORTED_TOKEN>

# Step 2：检查记录数量
lark-cli base +record-list --base-token <IMPORTED_TOKEN> --table-id <FIRST_TABLE_ID> --limit 1

# Step 3：对比源文件行数与导入后记录数
# 如果差异较大，可能存在导入失败或数据清洗问题
```

### 文件超限时的拆分策略

| 场景 | 解决方案 |
|------|---------|
| CSV 超过 100MB 无法导入 bitable | 拆分为多个小 CSV，逐个导入后合并 |
| Excel 超大无法一次性处理 | 导入为 sheet 后，用 +read 分片读取再写入 Base |

## 2. 导入本地文件到电子表格

```bash
# 导入 Excel 为电子表格
lark-cli drive +import --file ./report.xlsx --type sheet --name "月度报表"

# 导入 CSV 为电子表格
lark-cli drive +import --file ./data.csv --type sheet --name "数据表"
```

导入后可用 `lark-cli sheets +info` 和 `lark-cli sheets +read` 操作数据。

## 3. 导出飞书文档到本地

### 电子表格导出

```bash
# 导出为 xlsx
lark-cli sheets +export --spreadsheet-token <TOKEN> --file-extension xlsx --output-path "./data.xlsx"

# 导出为 csv（需指定 sheet-id）
lark-cli sheets +export --spreadsheet-token <TOKEN> --file-extension csv --sheet-id <SHEET_ID> --output-path "./data.csv"

# 不下载，只获取 file_token
lark-cli sheets +export --spreadsheet-token <TOKEN> --file-extension xlsx
```

### 多维表格导出

多维表格没有直接的导出命令，需通过分页读取后导出：

```
方案 A：分页读取 + 本地拼装
1. +record-list 分页读取全量数据
2. 在本地拼装为 CSV/JSON

方案 B：先导入到 Sheets 再导出
1. +record-list 读取 Base 数据
2. +write 写入到 Sheets
3. +export 导出 Sheets 为 xlsx/csv
```

## 4. Bot 身份导入的权限处理

使用 `--as bot` 导入创建文档后，CLI 会**自动为当前 CLI 用户授予 full_access（可管理）权限**：

```bash
# bot 身份导入
lark-cli drive +import --file ./data.xlsx --type bitable --as bot

# 导入成功后，结果中包含 permission_grant 字段：
# status = granted  → 当前用户已获得权限
# status = skipped  → 没有可用用户 open_id，需手动授权
# status = failed   → 授权失败，需重试
```

**如果权限被跳过或失败：**

```bash
# 先完成登录
lark-cli auth login

# 然后重试导入或手动授权
```

## 5. 常见导入导出错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 文件扩展名不支持 | 导入 .md 到 bitable | 检查文件类型与目标类型是否匹配 |
| 文件太大 | 超过格式限额 | 拆分文件后逐个导入 |
| 导入任务超时 | 大文件处理慢 | 用 `+task_result --ticket` 继续查询 |
| 格式转换错误 | 列类型推断失败 | 导入后用 `+field-update` 调整字段类型 |
| 导出为空 | sheet-id 错误 | 用 `+info` 确认 sheet-id |

## 与其他模块配合

- 导入后需要大量写入 → 参考 [`base-write.md`](lark-workflow-batch-data-base-write.md)
- 导入前需要批量准备数据 → 参考 [`sheets-ops.md`](lark-workflow-batch-data-sheets-ops.md)
- 数据迁移 → 参考 [`migration.md`](lark-workflow-batch-data-migration.md)
- 遇到错误 → 参考 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)