# 模板使用指南

本指南详细介绍 lark-workflow-batch-data 的每个模板的使用方法。

## 模板列表

| 模板名称 | 描述 | 适用场景 |
|---------|------|---------|
| base_read_batch | 批量读取多维表格数据 | 需要读取大量数据、全量数据、分页读取 |
| base_write_batch | 批量写入数据到多维表格 | 需要写入大量数据、批量更新 |
| base_analysis | 使用服务端聚合分析数据 | 统计分析、避免上下文溢出 |
| data_migration | 跨表数据迁移 | 源表到目标表的数据迁移 |
| excel_import | 导入 Excel 到多维表格 | Excel/CSV 文件导入 |

---

## 1. base_read_batch 模板

### 功能说明

自动分页读取多维表格的所有数据，支持断点续传和进度显示。

### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| base_token | string | 是 | - | 多维表格的 token |
| table_id | string | 是 | - | 表 ID 或表名 |
| limit | number | 否 | 200 | 每页条数（1-200） |
| offset | number | 否 | 0 | 起始偏移量（用于断点续传） |

### 使用示例

#### Node.js

```javascript
const { useTemplate } = require('./index');

// 基本用法
const result = await useTemplate('base_read_batch', {
  base_token: 'app_xxx',
  table_id: 'tbl_xxx'
});

console.log(`共读取 ${result.total} 条记录`);
console.log('记录:', result.records);

// 指定参数
const result2 = await useTemplate('base_read_batch', {
  base_token: 'app_xxx',
  table_id: 'tbl_xxx',
  limit: 100,    // 每页 100 条
  offset: 200     // 从第 200 条开始
});
```

#### 命令行

```bash
# 基本用法
node index.js base_read_batch \
  --base-token app_xxx \
  --table-id tbl_xxx

# 指定参数
node index.js base_read_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --limit 100 \
  --offset 200

# 输出 JSON 格式
node index.js base_read_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --json
```

#### Python

```python
from lark_workflow_batch_data import use_template

result = use_template('base_read_batch', {
    'base_token': 'app_xxx',
    'table_id': 'tbl_xxx'
})

print(f"共读取 {result['total']} 条记录")
```

### 返回值格式

```javascript
{
  "records": [
    {
      "record_id": "rec_xxx",
      "fields": {
        "姓名": "张三",
        "部门": "技术部"
      },
      "created_time": 1234567890,
      "modified_time": 1234567890
    }
    // ... 更多记录
  ],
  "total": 1000
}
```

---

## 2. base_write_batch 模板

### 功能说明

批量写入数据到多维表格，自动分批处理、写前校验、失败记录收集。

### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| base_token | string | 是 | - | 多维表格的 token |
| table_id | string | 是 | - | 表 ID 或表名 |
| data | array | 是 | - | 要写入的数据列表 |

### 使用示例

#### Node.js

```javascript
const { useTemplate } = require('./index');

const data = [
  { 姓名: '张三', 部门: '技术部', 月薪: 15000 },
  { 姓名: '李四', 部门: '产品部', 月薪: 18000 },
  { 姓名: '王五', 部门: '设计部', 月薪: 16000 }
];

const result = await useTemplate('base_write_batch', {
  base_token: 'app_xxx',
  table_id: 'tbl_xxx',
  data: data
});

console.log(`成功写入: ${result.total_written} 条`);
console.log(`失败: ${result.failed_records.length} 条`);

if (result.failed_records.length > 0) {
  console.log('失败记录:', result.failed_records);
}
```

#### 命令行

```bash
# 使用 JSON 字符串
node index.js base_write_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --data '[{"姓名":"张三","部门":"技术部"}]'

# 使用 JSON 文件
node index.js base_write_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --data ./data.json

# 输出 JSON 格式
node index.js base_write_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --data ./data.json \
  --json
```

#### Python

```python
from lark_workflow_batch_data import use_template

data = [
    {'姓名': '张三', '部门': '技术部', '月薪': 15000},
    {'姓名': '李四', '部门': '产品部', '月薪': 18000}
]

result = use_template('base_write_batch', {
    'base_token': 'app_xxx',
    'table_id': 'tbl_xxx',
    'data': data
})

print(f"成功写入: {result['total_written']} 条")
```

### 返回值格式

```javascript
{
  "total_written": 98,
  "failed_records": [
    {
      "index": 5,
      "record": { "姓名": "测试", "部门": "测试" },
      "error": "字段类型不匹配"
    }
  ],
  "total_records": 100
}
```

---

## 3. base_analysis 模板

### 功能说明

使用服务端聚合分析数据，避免将全量数据拉取到客户端，防止上下文溢出。

### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| base_token | string | 是 | - | 多维表格的 token |
| table_id | string | 是 | - | 表 ID 或表名 |
| dimensions | array | 是 | - | 维度字段列表 |
| measures | array | 是 | - | 度量字段列表 |

#### measures 元素格式

```javascript
{
  "field_name": "字段名",
  "aggregation": "count|sum|avg|max|min",
  "alias": "别名（可选）"
}
```

### 使用示例

#### Node.js

```javascript
const { useTemplate } = require('./index');

const result = await useTemplate('base_analysis', {
  base_token: 'app_xxx',
  table_id: 'tbl_xxx',
  dimensions: ['部门', '职位'],
  measures: [
    { field_name: '姓名', aggregation: 'count', alias: '人数' },
    { field_name: '月薪', aggregation: 'avg', alias: '平均薪资' },
    { field_name: '月薪', aggregation: 'sum', alias: '总薪资' }
  ]
});

console.log('分析结果:', result);
```

#### 命令行

```bash
node index.js base_analysis \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --dimensions '["部门"]' \
  --measures '[{"field_name":"姓名","aggregation":"count"}]'
```

#### Python

```python
from lark_workflow_batch_data import use_template

result = use_template('base_analysis', {
    'base_token': 'app_xxx',
    'table_id': 'tbl_xxx',
    'dimensions': ['部门'],
    'measures': [
        {'field_name': '姓名', 'aggregation': 'count', 'alias': '人数'}
    ]
})
```

### 返回值格式

```javascript
{
  "data": {
    "items": [
      {
        "部门": "技术部",
        "人数": 50,
        "平均薪资": 18000
      },
      {
        "部门": "产品部",
        "人数": 30,
        "平均薪资": 19000
      }
    ]
  }
}
```

---

## 4. data_migration 模板

### 功能说明

跨表数据迁移，自动读取源表数据、处理字段映射、写入目标表。

### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| source_base_token | string | 是 | - | 源多维表格的 token |
| source_table_id | string | 是 | - | 源表 ID 或表名 |
| target_base_token | string | 是 | - | 目标多维表格的 token |
| target_table_id | string | 是 | - | 目标表 ID 或表名 |
| field_mapping | object | 否 | - | 字段映射，如 { "源字段": "目标字段" } |

### 使用示例

#### Node.js

```javascript
const { useTemplate } = require('./index');

// 简单迁移（字段名相同）
const result = await useTemplate('data_migration', {
  source_base_token: 'app_source',
  source_table_id: 'tbl_source',
  target_base_token: 'app_target',
  target_table_id: 'tbl_target'
});

// 带字段映射
const result2 = await useTemplate('data_migration', {
  source_base_token: 'app_source',
  source_table_id: 'tbl_source',
  target_base_token: 'app_target',
  target_table_id: 'tbl_target',
  field_mapping: {
    '姓名': '员工姓名',
    '部门': '所属部门',
    '月薪': '工资'
  }
});
```

#### 命令行

```bash
node index.js data_migration \
  --source-base-token app_source \
  --source-table-id tbl_source \
  --target-base-token app_target \
  --target-table-id tbl_target \
  --field-mapping '{"姓名":"员工姓名","部门":"所属部门"}'
```

### 返回值格式

同 base_write_batch 模板的返回值格式。

---

## 5. excel_import 模板

### 功能说明

导入 Excel 或 CSV 文件到多维表格，自动处理超时和状态轮询。

### 参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| file_path | string | 是 | - | Excel/CSV 文件路径 |
| base_name | string | 否 | "导入的数据表" | 目标多维表格名称 |

### 使用示例

#### Node.js

```javascript
const { useTemplate } = require('./index');

const result = await useTemplate('excel_import', {
  file_path: './data.xlsx',
  base_name: '员工数据表'
});

console.log('导入结果:', result);
```

#### 命令行

```bash
node index.js excel_import \
  --file-path ./data.xlsx \
  --base-name '员工数据表'
```

### 返回值格式

```javascript
{
  "data": {
    "ticket": "task_xxx",
    "status": "completed",
    "result": {
      "app_token": "app_xxx",
      "table_ids": ["tbl_xxx"]
    }
  }
}
```

---

## 通用功能

### 禁用进度显示

所有模板都支持禁用进度显示：

```javascript
// Node.js
const result = await useTemplate('base_read_batch', params, false);

// Python
result = use_template('base_read_batch', params, show_progress=False)
```

### 环境变量配置

```bash
# .env 文件
LARK_WORKFLOW_BATCH_DATA_ENABLED=true
LARK_WORKFLOW_BATCH_DATA_THRESHOLD=200
LARK_WORKFLOW_BATCH_DATA_RETRY_TIMES=3
```

## 错误处理

所有模板都有完善的错误处理机制：

```javascript
try {
  const result = await useTemplate('base_read_batch', params);
} catch (error) {
  console.error('操作失败:', error.message);
  
  // 如果是读取失败，可以从断点恢复
  if (error.message.includes('429')) {
    // 速率限制，等待后重试
    setTimeout(() => {
      // 从上次的 offset 继续
    }, 5000);
  }
}
```

## 最佳实践

1. **先测试小批量**：先用少量数据测试，确认无误后再处理大量数据
2. **使用服务端分析**：对于统计分析，优先使用 base_analysis 模板
3. **检查字段映射**：迁移前确认字段映射正确
4. **备份数据**：操作重要数据前先备份
5. **监控进度**：使用进度显示了解当前状态
