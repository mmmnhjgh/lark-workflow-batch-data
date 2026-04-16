# OpenClaw 快速入门指南

本指南将帮助您在 OpenClaw 中快速集成和使用飞书批量数据操作工作流。

## 一、安装

### 1. 安装飞书 CLI

```bash
# 全局安装飞书 CLI
npm install -g @larksuite/cli

# 安装官方 Skills
npx skills add https://github.com/larksuite/cli -y -g
```

### 2. 安装本 Skill

```bash
npx skills add https://github.com/mmmnhjgh/lark-workflow-batch-data -y -g
```

### 3. 配置授权

```bash
# 初始化配置（首次使用）
lark-cli config init

# 授权登录（选择需要的域）
lark-cli auth login --domain base,sheets,drive
```

## 二、在 OpenClaw 中使用

### 方法 1: 使用 Node.js 模块（推荐）

在 OpenClaw 项目中直接引入模块：

```javascript
// 引入模块
const { useTemplate } = require('path/to/lark-workflow-batch-data/index');

// 批量读取数据
async function readData() {
  const result = await useTemplate('base_read_batch', {
    base_token: 'app_xxx',    // 您的 base_token
    table_id: 'tbl_xxx',       // 您的 table_id
    limit: 200
  });
  
  console.log(`读取了 ${result.total} 条记录`);
  return result.records;
}

// 批量写入数据
async function writeData(data) {
  const result = await useTemplate('base_write_batch', {
    base_token: 'app_xxx',
    table_id: 'tbl_xxx',
    data: data
  });
  
  console.log(`成功写入 ${result.total_written} 条`);
  return result;
}

// 数据分析
async function analyzeData() {
  const result = await useTemplate('base_analysis', {
    base_token: 'app_xxx',
    table_id: 'tbl_xxx',
    dimensions: ['部门'],
    measures: [
      { field_name: '姓名', aggregation: 'count', alias: '人数' }
    ]
  });
  
  return result;
}
```

### 方法 2: 使用命令行工具

```bash
# 批量读取
node index.js base_read_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --limit 200

# 批量写入（从 JSON 文件）
node index.js base_write_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --data ./data.json

# 输出 JSON 格式
node index.js base_read_batch \
  --base-token app_xxx \
  --table-id tbl_xxx \
  --json
```

### 方法 3: 使用 Python 包装器

```python
from lark_workflow_batch_data import use_template

# 批量读取
result = use_template('base_read_batch', {
    'base_token': 'app_xxx',
    'table_id': 'tbl_xxx',
    'limit': 200
})

print(f"读取了 {result['total']} 条记录")

# 命令行使用
python3 lark_workflow_batch_data.py base_read_batch \
  --base-token app_xxx \
  --table-id tbl_xxx
```

## 三、OpenClaw 集成代码示例

### 智能路由函数

在 OpenClaw 中添加以下代码，实现智能选择使用本 Skill 还是直接 API：

```javascript
// openclaw_lark_integration.js

const { useTemplate } = require('./lark-workflow-batch-data/index');

function shouldUseBatchSkill(userInput, dataSize = 0) {
  // 检查关键词
  const keywords = [
    '批量', '全部', '所有数据', '上千条', '几百条',
    '读取所有', '导出', '导入', 'Excel', 'CSV',
    '统计', '分析', '汇总', '迁移', '同步',
    '只处理了十几条', '数据量大', '翻页', '分页', '断点续传'
  ];
  
  const hasKeyword = keywords.some(kw => userInput.includes(kw));
  
  // 检查数据量
  const hasLargeData = dataSize > 20;
  
  return hasKeyword || hasLargeData;
}

async function handleLarkOperation(userInput, context) {
  const dataSize = context.dataSize || 0;
  
  // 检查是否应该使用本 Skill
  if (shouldUseBatchSkill(userInput, dataSize)) {
    console.log('🤖 使用 lark-workflow-batch-data Skill');
    
    // 根据操作类型选择模板
    const operation = detectOperationType(userInput);
    
    switch (operation) {
      case 'read':
        return await useTemplate('base_read_batch', {
          base_token: context.baseToken,
          table_id: context.tableId,
          limit: 200
        });
      
      case 'write':
        return await useTemplate('base_write_batch', {
          base_token: context.baseToken,
          table_id: context.tableId,
          data: context.data
        });
      
      case 'analysis':
        return await useTemplate('base_analysis', {
          base_token: context.baseToken,
          table_id: context.tableId,
          dimensions: context.dimensions || ['部门'],
          measures: context.measures || [{ field_name: '姓名', aggregation: 'count' }]
        });
      
      // 其他操作...
    }
  } else {
    console.log('📡 使用直接 API 调用');
    // 使用直接 API 调用...
  }
}

function detectOperationType(userInput) {
  const input = userInput.toLowerCase();
  
  if (input.includes('读取') || input.includes('导出') || input.includes('拉取')) {
    return 'read';
  } else if (input.includes('写入') || input.includes('添加') || input.includes('更新')) {
    return 'write';
  } else if (input.includes('统计') || input.includes('分析') || input.includes('汇总')) {
    return 'analysis';
  } else if (input.includes('迁移') || input.includes('同步')) {
    return 'migration';
  } else if (input.includes('导入') || input.includes('excel') || input.includes('csv')) {
    return 'import';
  }
  
  return 'unknown';
}

module.exports = {
  shouldUseBatchSkill,
  handleLarkOperation,
  detectOperationType
};
```

## 四、常见问题

### Q: OpenClaw 仍然不使用这个 Skill 怎么办？

A: 请检查以下几点：

1. 确保在用户输入中包含触发关键词（如"批量"、"全部"、"Excel"等）
2. 检查 SKILL.md 中的 metadata.triggers 是否包含足够的关键词
3. 在 OpenClaw 中显式指定使用本 Skill
4. 使用 `npx skills list` 确认 Skill 已正确安装

### Q: 如何配置环境变量？

```bash
# .env 文件
LARK_WORKFLOW_BATCH_DATA_ENABLED=true
LARK_WORKFLOW_BATCH_DATA_THRESHOLD=200
LARK_WORKFLOW_BATCH_DATA_RETRY_TIMES=3
```

### Q: 如何从断点恢复？

```javascript
// 从 offset=200 继续读取
const result = await useTemplate('base_read_batch', {
  base_token: 'app_xxx',
  table_id: 'tbl_xxx',
  limit: 200,
  offset: 200  // 从第 200 条继续
});
```

### Q: 如何禁用进度显示？

```javascript
const result = await useTemplate('base_read_batch', {
  base_token: 'app_xxx',
  table_id: 'tbl_xxx'
}, false);  // 第二个参数设为 false 禁用进度
```

## 五、快速测试

### 1. 测试读取功能

```bash
# 创建测试数据文件
echo '[{"姓名":"测试","部门":"测试"}]' > test_data.json

# 使用 Node.js 测试
cat > test_read.js << 'EOF'
const { useTemplate } = require('./index');

async function test() {
  console.log('测试读取功能...');
  // 替换为您的测试 token
  // const result = await useTemplate('base_read_batch', { ... });
  console.log('请替换 token 后运行');
}

test();
EOF

node test_read.js
```

### 2. 查看帮助

```bash
# Node.js 版本
node index.js

# Python 版本
python3 lark_workflow_batch_data.py --help
```

## 六、最佳实践

1. **总是先测试**：先用少量数据测试，确认无误后再处理大量数据
2. **使用服务端分析**：对于统计分析，优先使用 `base_analysis` 模板
3. **检查权限**：确保已授权对应域（base/sheets/drive）
4. **监控进度**：使用进度显示了解当前状态
5. **备份数据**：操作重要数据前先备份

## 下一步

- 查看 [TEMPLATE_GUIDE.md](./TEMPLATE_GUIDE.md) 了解每个模板的详细用法
- 查看 [examples/usage_example.js](./examples/usage_example.js) 查看完整示例
- 参考原项目的 [README.md](./README.md) 了解更多技术细节
