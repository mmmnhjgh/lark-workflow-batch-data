/**
 * 飞书批量数据操作工作流使用示例
 * 
 * 本文件展示如何在 OpenClaw 中使用 lark-workflow-batch-data
 */

const { useTemplate } = require('../index');

// 示例 1: 批量读取多维表格数据
async function exampleReadBatch() {
  console.log('=== 示例 1: 批量读取多维表格数据 ===\n');
  
  try {
    const result = await useTemplate('base_read_batch', {
      base_token: 'app_xxx',  // 替换为实际的 base_token
      table_id: 'tbl_xxx',     // 替换为实际的 table_id
      limit: 200,
      offset: 0
    });
    
    console.log(`\n读取完成！共 ${result.total} 条记录`);
    console.log('前 3 条记录:', JSON.stringify(result.records.slice(0, 3), null, 2));
  } catch (error) {
    console.error('读取失败:', error.message);
  }
}

// 示例 2: 批量写入数据到多维表格
async function exampleWriteBatch() {
  console.log('\n=== 示例 2: 批量写入数据到多维表格 ===\n');
  
  try {
    const sampleData = [
      { 姓名: '张三', 部门: '技术部', 月薪: 15000 },
      { 姓名: '李四', 部门: '产品部', 月薪: 18000 },
      { 姓名: '王五', 部门: '设计部', 月薪: 16000 },
      { 姓名: '赵六', 部门: '技术部', 月薪: 17000 },
      { 姓名: '钱七', 部门: '产品部', 月薪: 19000 }
    ];
    
    const result = await useTemplate('base_write_batch', {
      base_token: 'app_xxx',  // 替换为实际的 base_token
      table_id: 'tbl_xxx',     // 替换为实际的 table_id
      data: sampleData
    });
    
    console.log(`\n写入完成！成功: ${result.total_written} 条, 失败: ${result.failed_records.length} 条`);
  } catch (error) {
    console.error('写入失败:', error.message);
  }
}

// 示例 3: 使用服务端聚合分析数据
async function exampleAnalysis() {
  console.log('\n=== 示例 3: 使用服务端聚合分析数据 ===\n');
  
  try {
    const result = await useTemplate('base_analysis', {
      base_token: 'app_xxx',  // 替换为实际的 base_token
      table_id: 'tbl_xxx',     // 替换为实际的 table_id
      dimensions: ['部门'],
      measures: [
        { field_name: '姓名', aggregation: 'count', alias: '人数' },
        { field_name: '月薪', aggregation: 'avg', alias: '平均月薪' }
      ]
    });
    
    console.log('\n分析结果:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('分析失败:', error.message);
  }
}

// 示例 4: 跨表数据迁移
async function exampleMigration() {
  console.log('\n=== 示例 4: 跨表数据迁移 ===\n');
  
  try {
    const result = await useTemplate('data_migration', {
      source_base_token: 'app_source',    // 替换为源表的 base_token
      source_table_id: 'tbl_source',       // 替换为源表的 table_id
      target_base_token: 'app_target',    // 替换为目标表的 base_token
      target_table_id: 'tbl_target',       // 替换为目标表的 table_id
      field_mapping: {
        '姓名': '员工姓名',
        '部门': '所属部门',
        '月薪': '工资'
      }
    });
    
    console.log('\n迁移完成:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('迁移失败:', error.message);
  }
}

// 示例 5: 导入 Excel 到多维表格
async function exampleExcelImport() {
  console.log('\n=== 示例 5: 导入 Excel 到多维表格 ===\n');
  
  try {
    const result = await useTemplate('excel_import', {
      file_path: './data.xlsx',        // 替换为实际的文件路径
      base_name: '员工数据表'
    });
    
    console.log('\n导入完成:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('导入失败:', error.message);
  }
}

// 运行所有示例
async function runAllExamples() {
  console.log('飞书批量数据操作工作流 - 使用示例\n');
  console.log('⚠️  注意：请先替换示例中的 token 和 table_id 为实际值\n');
  console.log('='.repeat(60));
  
  // 取消注释下面的示例来运行
  // await exampleReadBatch();
  // await exampleWriteBatch();
  // await exampleAnalysis();
  // await exampleMigration();
  // await exampleExcelImport();
  
  console.log('\n' + '='.repeat(60));
  console.log('\n示例说明：');
  console.log('1. 取消注释对应的函数来运行示例');
  console.log('2. 替换示例中的 token 和 table_id 为实际值');
  console.log('3. 确保已安装 lark-cli 并完成授权');
}

// 如果直接运行此文件
if (require.main === module) {
  runAllExamples().catch(console.error);
}

module.exports = {
  exampleReadBatch,
  exampleWriteBatch,
  exampleAnalysis,
  exampleMigration,
  exampleExcelImport
};
