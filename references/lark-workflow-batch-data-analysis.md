# 大数据分析

> **前置条件：** 先阅读 [`../SKILL.md`](../SKILL.md) 和 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)。

服务端聚合分析工作流，避免拉全量数据到客户端导致上下文溢出。

## 核心原则

**不要拉全量数据到客户端做计算。** 使用 `+data-query` 让服务端完成聚合，只返回统计结果。

| 场景 | 错误做法 | 正确做法 |
|------|---------|---------|
| 统计部门人数 | +record-list 拉全量 → 手动计数 | +data-query aggregation: count |
| 计算平均工资 | +record-list 拉全量 → 手动算平均 | +data-query aggregation: avg |
| 找最高销售额 | +record-list 拉全量 → 排序取最大 | +data-query aggregation: max |
| 按月分组统计 | +record-list 拉全量 → 手动分组 | +data-query dimensions + measures |
| 导出全量明细 | +data-query | +record-list 分页导出（见 base-read.md） |

## +data-query 语法

### 基本结构

```json
{
  "datasource": {
    "type": "table",
    "table": {
      "tableId": "tbl_xxx",
      "tableName": "表名"
    }
  },
  "dimensions": [],
  "measures": [],
  "filters": {},
  "sort": {},
  "pagination": {"limit": 5000},
  "shaper": {"format": "flat"}
}
```

> ⚠️ **重要**：`field_name` 必须与 `+field-list` 返回的真实字段名完全一致，禁止凭猜测填写。

### 查询前必须先获取字段结构

```bash
lark-cli base +field-list --base-token <TOKEN> --table-id <ID>
```

### dimensions（分组维度）

```json
"dimensions": [
  {"field_name": "部门", "alias": "dept"},
  {"field_name": "状态", "alias": "status"}
]
```

**规则：**
- `alias` 必须是纯英文，不能包含中文
- `alias` 在 dimensions 和 measures 之间必须唯一

### measures（聚合指标）

```json
"measures": [
  {"field_name": "销售额", "aggregation": "sum", "alias": "total_sales"},
  {"field_name": "姓名", "aggregation": "count", "alias": "headcount"},
  {"field_name": "工时", "aggregation": "avg", "alias": "avg_hours"}
]
```

**支持的聚合函数：**

| 函数 | 说明 |
|------|------|
| `sum` | 求和 |
| `avg` | 平均值 |
| `min` | 最小值 |
| `max` | 最大值 |
| `count` | 计数 |
| `count_all` | 计数（含空值） |
| `distinct_count` | 去重计数 |

**支持的字段类型（白名单）：**

text, email, barcode, number, progress, currency, rating, single_select, multi_select, date, checkbox, person, hyperlink

**不支持的字段类型：** formula, lookup, attachment, duration, stage, created/modified_time, created/modified_by, group, phone, auto_number, location, relation, two_way_relation

### filters（筛选条件）

```json
"filters": {
  "type": 1,
  "conjunction": "and",
  "conditions": [
    {"field_name": "状态", "operator": "is", "value": ["已完成"]},
    {"field_name": "销售额", "operator": "isGreater", "value": ["10000"]}
  ]
}
```

**常用运算符：**

| 运算符 | 说明 | 适用类型 |
|--------|------|---------|
| `is` | 等于 | 所有 |
| `isNot` | 不等于 | 所有 |
| `contains` | 包含 | text |
| `doesNotContain` | 不包含 | text |
| `isEmpty` | 为空 | 所有 |
| `isNotEmpty` | 不为空 | 所有 |
| `isGreater` | 大于 | number, date |
| `isLess` | 小于 | number, date |
| `isGreaterEqual` | 大于等于 | number, date |
| `isLessEqual` | 小于等于 | number, date |

**日期快捷值（区分大小写）：**

| 关键词 | 说明 |
|--------|------|
| `Today` | 今天 |
| `Yesterday` | 昨天 |
| `Tomorrow` | 明天 |
| `CurrentWeek` | 本周 |
| `LastWeek` | 上周 |
| `CurrentMonth` | 本月 |
| `LastMonth` | 上月 |

### sort（排序）

```json
"sort": {"field_name": "销售额", "order": "desc"}
```

### pagination（分页）

```json
"pagination": {"limit": 5000}
```

- `limit` 最大 5000
- `+data-query` 不支持 offset，只返回结果集

## 常见分析场景

### 场景 1：按部门统计人数和平均工资

```bash
lark-cli base +data-query --base-token <TOKEN> --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [{"field_name": "部门", "alias": "dept"}],
  "measures": [
    {"field_name": "姓名", "aggregation": "count", "alias": "headcount"},
    {"field_name": "工资", "aggregation": "avg", "alias": "avg_salary"}
  ],
  "shaper": {"format": "flat"}
}'
```

### 场景 2：找出本月高优先级任务

```bash
lark-cli base +data-query --base-token <TOKEN> --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [{"field_name": "优先级", "alias": "priority"}],
  "measures": [{"field_name": "任务名", "aggregation": "count", "alias": "task_count"}],
  "filters": {
    "type": 1,
    "conjunction": "and",
    "conditions": [
      {"field_name": "优先级", "operator": "is", "value": ["高"]},
      {"field_name": "创建时间", "operator": "isGreater", "value": ["2026-04-01 00:00:00"]}
    ]
  },
  "shaper": {"format": "flat"}
}'
```

### 场景 3：销售排行榜（按金额降序）

```bash
lark-cli base +data-query --base-token <TOKEN> --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [{"field_name": "销售员", "alias": "salesperson"}],
  "measures": [{"field_name": "金额", "aggregation": "sum", "alias": "total_amount"}],
  "sort": {"field_name": "金额", "order": "desc"},
  "shaper": {"format": "flat"}
}'
```

### 场景 4：唯一值计数

```bash
lark-cli base +data-query --base-token <TOKEN> --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [],
  "measures": [{"field_name": "客户名", "aggregation": "distinct_count", "alias": "unique_clients"}],
  "shaper": {"format": "flat"}
}'
```

### 场景 5：按月分组统计趋势

```bash
lark-cli base +data-query --base-token <TOKEN> --json '{
  "datasource": {"type": "table", "table": {"tableId": "tbl_xxx"}},
  "dimensions": [{"field_name": "日期", "alias": "month"}],
  "measures": [{"field_name": "销售额", "aggregation": "sum", "alias": "monthly_sales"}],
  "sort": {"field_name": "日期", "order": "asc"},
  "shaper": {"format": "flat"}
}'
```

## data-query vs record-list 选择指南

| 需求 | 用 data-query | 用 record-list |
|------|-------------|---------------|
| 统计总人数 | ✅ | ❌ |
| 计算平均值 | ✅ | ❌ |
| 分组聚合 | ✅ | ❌ |
| 排行榜 | ✅ | ❌ |
| 导出全量明细 | ❌ | ✅ |
| 逐条处理记录 | ❌ | ✅ |
| 更新记录（需先读） | ❌ | ✅ |
| 唯一值计数 | ✅ | ❌ |

**原则**：需要"算"的用 `+data-query`，需要"看每条"的用 `+record-list`。

## 公式字段 vs 一次性查询

| 场景 | 用 data-query | 用 formula 字段 |
|------|-------------|----------------|
| 临时一次性统计 | ✅ | ❌ |
| 结果需要长期显示在表里 | ❌ | ✅ |
| 结果需按筛选动态变化 | ✅ | ❌ |
| 跨表聚合 | ✅ 一次性 | 考虑 lookup 字段 |

## 权限要求

- 调用者必须是 Base 的**管理员（FA 权限）**
- 非管理员调用 `+data-query` 会返回权限错误

## 与其他模块配合

- data-query 结果需要导出 → 参考 [`import-export.md`](lark-workflow-batch-data-import-export.md)
- 需要读取明细记录 → 参考 [`base-read.md`](lark-workflow-batch-data-base-read.md)
- 需要写入统计结果 → 参考 [`base-write.md`](lark-workflow-batch-data-base-write.md)
- 遇到错误 → 参考 [`error-recovery.md`](lark-workflow-batch-data-error-recovery.md)