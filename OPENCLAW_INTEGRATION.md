# OpenClaw 集成指南

本指南介绍如何将飞书批量数据操作工作流 (lark-workflow-batch-data) 与 OpenClaw 集成，实现智能路由和模板化操作。

## 问题分析

当使用 OpenClaw 操作飞书数据时，可能会遇到以下问题：

1. **API 调用限制**：OpenClaw 直接调用飞书 API 时，受限于 API 分页限制（200条/页），无法处理大量数据
2. **上下文溢出**：处理大量数据时，OpenClaw 可能因上下文长度限制而截断操作
3. **错误恢复困难**：遇到网络中断、并发冲突等错误时，需要手动处理断点续传
4. **操作不标准化**：每次操作都需要重新构造命令，缺乏标准化模板

## 解决方案

通过以下步骤，将本 Skill 与 OpenClaw 融合，实现智能批量数据操作：

### 1. 安装和配置

#### 安装飞书 CLI

```bash
# 全局安装飞书 CLI
npm install -g @larksuite/cli

# 安装官方 Skills
npx skills add https://github.com/larksuite/cli -y -g
```

#### 安装本 Skill

```bash
npx skills add https://github.com/mmmnhjgh/lark-workflow-batch-data -y -g
```

#### 配置环境变量

在 OpenClaw 的环境配置中添加以下环境变量：

```bash
# .env 文件
LARK_WORKFLOW_BATCH_DATA_ENABLED=true
LARK_WORKFLOW_BATCH_DATA_THRESHOLD=200  # 触发批量处理的阈值
LARK_WORKFLOW_BATCH_DATA_RETRY_TIMES=3  # 重试次数
```

### 2. OpenClaw 集成代码

在 OpenClaw 中添加以下集成代码，实现智能路由：

```python
# openclaw_lark_integration.py

import os
import json
from lark_workflow_batch_data import use_template

def detect_operation_type(user_input):
    """检测操作类型"""
    user_input = user_input.lower()
    if any(keyword in user_input for keyword in ["读取", "导出", "获取", "拉取"]):
        return "read"
    elif any(keyword in user_input for keyword in ["写入", "更新", "添加", "插入"]):
        return "write"
    elif any(keyword in user_input for keyword in ["统计", "分析", "汇总", "计算"]):
        return "analysis"
    elif any(keyword in user_input for keyword in ["迁移", "同步", "复制"]):
        return "migration"
    elif any(keyword in user_input for keyword in ["导入", "上传", "excel", "csv"]):
        return "import"
    else:
        return "unknown"

def estimate_data_size(user_input, context):
    """估算数据量"""
    # 简单的启发式方法，实际应用中可以根据上下文和用户输入更准确地估算
    if any(keyword in user_input for keyword in ["全部", "所有", "全量"]):
        return 1000  # 假设是大量数据
    elif any(keyword in user_input for keyword in ["批量", "很多", "上千"]):
        return 500
    elif any(keyword in user_input for keyword in ["几条", "少量", "示例"]):
        return 10
    else:
        # 尝试从用户输入中提取数字
        import re
        numbers = re.findall(r'\d+', user_input)
        if numbers:
            return int(numbers[-1])
        return 100  # 默认值

def use_direct_api(operation_type, user_input, context):
    """使用直接 API 调用"""
    # 这里实现直接 API 调用的逻辑
    # 例如：使用飞书 SDK 或 HTTP 请求
    pass

def handle_lark_operation(user_input, context):
    """处理飞书操作请求"""
    # 检查是否启用了批量数据操作
    if not os.environ.get('LARK_WORKFLOW_BATCH_DATA_ENABLED', 'false').lower() == 'true':
        # 未启用，使用直接 API 调用
        operation_type = detect_operation_type(user_input)
        return use_direct_api(operation_type, user_input, context)
    
    # 检测操作类型和数据量
    operation_type = detect_operation_type(user_input)
    data_size = estimate_data_size(user_input, context)
    threshold = int(os.environ.get('LARK_WORKFLOW_BATCH_DATA_THRESHOLD', 200))
    
    # 智能路由
    if operation_type == "read" and data_size > threshold:
        # 使用批量读取模板
        # 从上下文中提取 base_token 和 table_id
        base_token = context.get("base_token")
        table_id = context.get("table_id")
        if not base_token or not table_id:
            return "请提供多维表格的 token 和表 ID"
        
        params = {
            "base_token": base_token,
            "table_id": table_id,
            "limit": 200
        }
        return use_template("base_read_batch", params)
    
    elif operation_type == "write" and data_size > threshold / 4:
        # 使用批量写入模板
        base_token = context.get("base_token")
        table_id = context.get("table_id")
        data = context.get("data")
        if not base_token or not table_id or not data:
            return "请提供多维表格的 token、表 ID 和要写入的数据"
        
        params = {
            "base_token": base_token,
            "table_id": table_id,
            "data": data
        }
        return use_template("base_write_batch", params)
    
    elif operation_type == "analysis":
        # 使用服务端分析模板
        base_token = context.get("base_token")
        table_id = context.get("table_id")
        # 从用户输入中提取维度和度量
        # 这里需要更复杂的自然语言处理
        dimensions = context.get("dimensions", ["部门"])
        measures = context.get("measures", [{"field_name": "姓名", "aggregation": "count"}])
        
        if not base_token or not table_id:
            return "请提供多维表格的 token 和表 ID"
        
        params = {
            "base_token": base_token,
            "table_id": table_id,
            "dimensions": dimensions,
            "measures": measures
        }
        return use_template("base_analysis", params)
    
    elif operation_type == "migration":
        # 使用数据迁移模板
        source_base_token = context.get("source_base_token")
        source_table_id = context.get("source_table_id")
        target_base_token = context.get("target_base_token")
        target_table_id = context.get("target_table_id")
        field_mapping = context.get("field_mapping")
        
        if not all([source_base_token, source_table_id, target_base_token, target_table_id]):
            return "请提供源表和目标表的 token 和表 ID"
        
        params = {
            "source_base_token": source_base_token,
            "source_table_id": source_table_id,
            "target_base_token": target_base_token,
            "target_table_id": target_table_id,
            "field_mapping": field_mapping
        }
        return use_template("data_migration", params)
    
    elif operation_type == "import":
        # 使用文件导入模板
        file_path = context.get("file_path")
        base_name = context.get("base_name", "导入的数据表")
        
        if not file_path:
            return "请提供要导入的文件路径"
        
        params = {
            "file_path": file_path,
            "base_name": base_name
        }
        return use_template("excel_import", params)
    
    else:
        # 使用直接 API 调用
        return use_direct_api(operation_type, user_input, context)
```

### 3. 模板使用示例

#### 批量读取数据

**用户输入**：
```
帮我读取这个多维表格的所有数据，有 3000 条
```

**OpenClaw 处理**：
```python
# 检测到是读取操作，数据量 > 200，使用批量读取模板
result = use_template("base_read_batch", {
    "base_token": "app_xxx",
    "table_id": "tbl_xxx",
    "limit": 200
})
print(f"读取了 {result['total']} 条记录")
```

#### 批量写入数据

**用户输入**：
```
帮我把这 2000 条数据写入多维表格
```

**OpenClaw 处理**：
```python
# 检测到是写入操作，数据量 > 50，使用批量写入模板
result = use_template("base_write_batch", {
    "base_token": "app_xxx",
    "table_id": "tbl_xxx",
    "data": [
        {"姓名": "张三", "部门": "技术"},
        {"姓名": "李四", "部门": "产品"},
        # ... 更多数据
    ]
})
print(f"成功写入 {result['total_written']} 条，失败 {len(result['failed_records'])} 条")
```

#### 数据分析

**用户输入**：
```
帮我统计各部门的人数
```

**OpenClaw 处理**：
```python
# 检测到是分析操作，使用服务端分析模板
result = use_template("base_analysis", {
    "base_token": "app_xxx",
    "table_id": "tbl_xxx",
    "dimensions": ["部门"],
    "measures": [{"field_name": "姓名", "aggregation": "count"}]
})
print("各部门人数统计:")
for item in result.get("data", {}).get("items", []):
    print(f"{item['部门']}: {item['姓名_count']} 人")
```

### 4. 错误处理与恢复

当遇到以下情况时，OpenClaw 会自动从直接 API 调用降级到本 Skill：

1. **API 调用失败**：当直接 API 调用返回 429（速率限制）、1254291（并发冲突）等错误时
2. **上下文溢出**：当 OpenClaw 处理数据时出现上下文长度限制警告
3. **操作中断**：当批量操作中途停止，需要断点续传时

### 5. 进度反馈

为了让用户了解批量操作的进度，OpenClaw 可以集成以下进度反馈机制：

```python
def monitor_progress(operation_type, params):
    """监控操作进度"""
    if operation_type == "read":
        # 监控读取进度
        reader = BaseReadBatch(params["base_token"], params["table_id"])
        total = 0
        for batch in reader.read_all():
            total += len(batch)
            print(f"已读取 {total} 条记录...")
    elif operation_type == "write":
        # 监控写入进度
        writer = BaseWriteBatch(params["base_token"], params["table_id"])
        result = writer.write_batch(params["data"])
        print(f"写入完成：成功 {result['total_written']} 条，失败 {len(result['failed_records'])} 条")
    # 其他操作类型的进度监控...
```

## 总结

通过以上集成方案，OpenClaw 可以：

1. **智能选择**：根据操作类型和数据量，自动选择使用本 Skill 还是直接 API 调用
2. **模板化操作**：使用标准化模板，避免每次重新构造命令
3. **错误恢复**：自动处理各种错误情况，实现断点续传
4. **进度反馈**：向用户提供清晰的操作进度反馈

这样，即使是处理上千条数据，OpenClaw 也能稳定完成操作，不再出现处理十几条就卡住的情况。