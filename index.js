#!/usr/bin/env node
/**
 * 飞书批量数据操作工作流 Node.js 包装器
 * 
 * 这个模块为 lark-cli 批量数据操作提供 Node.js 接口，方便 OpenClaw 集成使用。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ProgressCallback {
  constructor(showProgress = true) {
    this.showProgress = showProgress;
    this.totalRead = 0;
    this.totalWritten = 0;
  }

  onReadBatch(batchSize, offset, hasMore) {
    this.totalRead += batchSize;
    if (this.showProgress) {
      let progress = `已读取 ${this.totalRead} 条记录`;
      if (hasMore) {
        progress += ' (继续读取中...)';
      }
      console.log(`📊 ${progress}`);
    }
  }

  onWriteRecord(recordIndex, totalRecords, success) {
    if (success) {
      this.totalWritten += 1;
    }
    if (this.showProgress && recordIndex % 50 === 0) {
      const progress = (recordIndex / totalRecords) * 100;
      console.log(`✏️  写入进度: ${progress.toFixed(1)}% (${recordIndex}/${totalRecords})`);
    }
  }

  onComplete(operation, result) {
    if (this.showProgress) {
      console.log(`\n✅ ${operation} 完成！`);
      if (operation === 'read') {
        console.log(`   总计读取: ${result.total || 0} 条记录`);
      } else if (operation === 'write') {
        console.log(`   成功写入: ${result.total_written || 0} 条`);
        console.log(`   失败: ${(result.failed_records || []).length} 条`);
      }
    }
  }
}

class LarkWorkflowBatchData {
  constructor(baseToken, progressCallback = null) {
    this.baseToken = baseToken;
    this.retryTimes = parseInt(process.env.LARK_WORKFLOW_BATCH_DATA_RETRY_TIMES || '3');
    this.progressCallback = progressCallback || new ProgressCallback();
  }

  async _runCommand(command) {
    for (let attempt = 0; attempt < this.retryTimes; attempt++) {
      try {
        const result = await this._execCommand(command);
        return JSON.parse(result.stdout);
      } catch (error) {
        const errorMsg = error.stderr || error.stdout || error.message;
        console.log(`⚠️  命令执行失败: ${errorMsg}`);

        if (errorMsg.includes('429')) {
          const waitTime = Math.pow(2, attempt);
          console.log(`⏳ 遇到速率限制，等待 ${waitTime} 秒后重试...`);
          await this._sleep(waitTime * 1000);
        } else if (errorMsg.includes('1254291')) {
          console.log('⏳ 遇到并发冲突，等待 1 秒后重试...');
          await this._sleep(1000);
        } else if (errorMsg.includes('1254104')) {
          console.log('⚠️  遇到批量超限，需要调整批次大小');
          throw error;
        } else {
          throw error;
        }
      }
    }
    throw new Error(`❌ 命令执行失败，已重试 ${this.retryTimes} 次`);
  }

  _execCommand(command) {
    return new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1));
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject({ code, stdout, stderr, message: stderr || stdout });
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class BaseReadBatch extends LarkWorkflowBatchData {
  constructor(baseToken, tableId, limit = 200, progressCallback = null) {
    super(baseToken, progressCallback);
    this.tableId = tableId;
    this.limit = limit;
  }

  async readAll(offset = 0) {
    const allRecords = [];
    let currentOffset = offset;
    let hasMore = true;

    while (hasMore) {
      const command = [
        'lark-cli', 'base', '+record-list',
        '--base-token', this.baseToken,
        '--table-id', this.tableId,
        '--offset', String(currentOffset),
        '--limit', String(this.limit)
      ];

      const result = await this._runCommand(command);
      const records = result.data?.items || [];

      if (records.length > 0) {
        allRecords.push(...records);
        this.progressCallback.onReadBatch(
          records.length,
          currentOffset,
          result.data?.has_more || false
        );
      }

      hasMore = result.data?.has_more || false;
      currentOffset += records.length;

      await this._sleep(500);
    }

    this.progressCallback.onComplete('read', { total: allRecords.length, records: allRecords });
    return allRecords;
  }
}

class BaseWriteBatch extends LarkWorkflowBatchData {
  constructor(baseToken, tableId, progressCallback = null) {
    super(baseToken, progressCallback);
    this.tableId = tableId;
    this.batchSize = 500;
  }

  async writeBatch(data) {
    let totalWritten = 0;
    const failedRecords = [];

    const fields = await this._getFields();
    const writableFields = fields
      .filter(f => f.writable !== false)
      .map(f => f.name);

    const totalRecords = data.length;
    for (let idx = 0; idx < data.length; idx++) {
      const record = data[idx];
      const recordIndex = idx + 1;

      const filteredRecord = {};
      for (const [key, value] of Object.entries(record)) {
        if (writableFields.includes(key)) {
          filteredRecord[key] = value;
        }
      }

      const command = [
        'lark-cli', 'base', '+record-upsert',
        '--base-token', this.baseToken,
        '--table-id', this.tableId,
        '--json', JSON.stringify(filteredRecord)
      ];

      let success = false;
      try {
        await this._runCommand(command);
        totalWritten += 1;
        success = true;
      } catch (error) {
        failedRecords.push({
          index: recordIndex,
          record,
          error: error.message || String(error)
        });
      }

      this.progressCallback.onWriteRecord(recordIndex, totalRecords, success);
      await this._sleep(100);

      if (recordIndex % this.batchSize === 0 && recordIndex < totalRecords) {
        console.log('⏸️  批次间延迟 1 秒...');
        await this._sleep(1000);
      }
    }

    const result = {
      total_written: totalWritten,
      failed_records: failedRecords,
      total_records: totalRecords
    };
    this.progressCallback.onComplete('write', result);
    return result;
  }

  async _getFields() {
    const command = [
      'lark-cli', 'base', '+field-list',
      '--base-token', this.baseToken,
      '--table-id', this.tableId
    ];
    const result = await this._runCommand(command);
    return result.data?.items || [];
  }
}

class BaseAnalysis extends LarkWorkflowBatchData {
  constructor(baseToken, tableId, progressCallback = null) {
    super(baseToken, progressCallback);
    this.tableId = tableId;
  }

  async analyze(dimensions, measures) {
    console.log('📈 正在执行服务端聚合分析...');

    const query = {
      datasource: {
        type: 'table',
        table: { tableId: this.tableId }
      },
      dimensions: dimensions.map(dim => ({ field_name: dim, alias: dim })),
      measures: measures.map(m => ({
        field_name: m.field_name,
        aggregation: m.aggregation,
        alias: m.alias || `${m.field_name}_${m.aggregation}`
      })),
      shaper: { format: 'flat' }
    };

    const command = [
      'lark-cli', 'base', '+data-query',
      '--base-token', this.baseToken,
      '--json', JSON.stringify(query)
    ];

    const result = await this._runCommand(command);

    const items = result.data?.items || [];
    console.log(`\n📊 分析结果（共 ${items.length} 条）：`);
    console.log('-'.repeat(50));

    if (items.length > 0) {
      const headers = Object.keys(items[0]);
      console.log(headers.join('\t'));
      console.log('-'.repeat(50));

      for (const item of items) {
        const values = headers.map(h => String(item[h] || ''));
        console.log(values.join('\t'));
      }
    }

    return result;
  }
}

class DataMigration {
  constructor(sourceBaseToken, sourceTableId, targetBaseToken, targetTableId, progressCallback = null) {
    this.progressCallback = progressCallback || new ProgressCallback();
    this.sourceReader = new BaseReadBatch(sourceBaseToken, sourceTableId, 200, this.progressCallback);
    this.targetWriter = new BaseWriteBatch(targetBaseToken, targetTableId, this.progressCallback);
  }

  async migrate(fieldMapping = null) {
    console.log('🔄 开始数据迁移...');

    console.log('📥 步骤 1/3: 读取源表数据...');
    const allRecords = await this.sourceReader.readAll();

    console.log('🔄 步骤 2/3: 处理字段映射...');
    const mappedRecords = [];
    for (const record of allRecords) {
      const fields = record.fields || {};
      if (fieldMapping) {
        const mapped = {};
        for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
          if (sourceField in fields) {
            mapped[targetField] = fields[sourceField];
          }
        }
        mappedRecords.push(mapped);
      } else {
        mappedRecords.push(fields);
      }
    }

    console.log('📤 步骤 3/3: 写入目标表...');
    return await this.targetWriter.writeBatch(mappedRecords);
  }
}

class ExcelImport {
  constructor(filePath, baseName = '导入的数据表') {
    this.filePath = filePath;
    this.baseName = baseName;
  }

  async importFile() {
    console.log(`📁 开始导入文件: ${this.filePath}`);

    const command = [
      'lark-cli', 'drive', '+import',
      '--file', this.filePath,
      '--type', 'bitable',
      '--name', this.baseName
    ];

    const result = await this._execCommand(command);
    const output = JSON.parse(result.stdout);
    const ticket = output.data?.ticket;

    if (ticket) {
      console.log(`🎫 已获取导入任务 ticket: ${ticket}`);
      return await this._checkImportStatus(ticket);
    }

    return output;
  }

  async _checkImportStatus(ticket) {
    const command = [
      'lark-cli', 'drive', '+task_result',
      '--scenario', 'import',
      '--ticket', ticket
    ];

    console.log('⏳ 正在等待导入完成...');
    while (true) {
      const result = await this._execCommand(command);
      const output = JSON.parse(result.stdout);
      const status = output.data?.status;

      if (status === 'completed') {
        console.log('✅ 导入完成！');
        return output;
      } else if (status === 'failed') {
        throw new Error(`❌ 导入失败: ${output.data?.error || 'Unknown error'}`);
      } else if (status === 'processing') {
        console.log('⏳ 导入中...');
      }

      await this._sleep(5000);
    }
  }

  _execCommand(command) {
    return new Promise((resolve, reject) => {
      const child = spawn(command[0], command.slice(1));
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject({ code, stdout, stderr, message: stderr || stdout });
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function useTemplate(templateName, params, showProgress = true) {
  const progressCallback = new ProgressCallback(showProgress);

  if (templateName === 'base_read_batch') {
    const reader = new BaseReadBatch(
      params.base_token,
      params.table_id,
      params.limit || 200,
      progressCallback
    );
    const records = await reader.readAll(params.offset || 0);
    return { records, total: records.length };
  }

  if (templateName === 'base_write_batch') {
    const writer = new BaseWriteBatch(
      params.base_token,
      params.table_id,
      progressCallback
    );
    return await writer.writeBatch(params.data);
  }

  if (templateName === 'base_analysis') {
    const analyzer = new BaseAnalysis(
      params.base_token,
      params.table_id,
      progressCallback
    );
    return await analyzer.analyze(params.dimensions, params.measures);
  }

  if (templateName === 'data_migration') {
    const migration = new DataMigration(
      params.source_base_token,
      params.source_table_id,
      params.target_base_token,
      params.target_table_id,
      progressCallback
    );
    return await migration.migrate(params.field_mapping);
  }

  if (templateName === 'excel_import') {
    const importer = new ExcelImport(
      params.file_path,
      params.base_name || '导入的数据表'
    );
    return await importer.importFile();
  }

  throw new Error(`❌ 未知的模板名称: ${templateName}`);
}

function main() {
  const args = process.argv.slice(2);
  const templateIndex = args.findIndex(arg => !arg.startsWith('--'));
  
  if (templateIndex === -1) {
    console.log('使用方法: node index.js <template> [options]');
    console.log('模板列表: base_read_batch, base_write_batch, base_analysis, data_migration, excel_import');
    return;
  }

  const templateName = args[templateIndex];
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace('--', '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  if (options.data) {
    try {
      if (fs.existsSync(options.data)) {
        options.data = JSON.parse(fs.readFileSync(options.data, 'utf8'));
      } else {
        options.data = JSON.parse(options.data);
      }
    } catch (e) {
      console.error('解析 data 参数失败:', e.message);
      process.exit(1);
    }
  }

  if (options.dimensions) {
    options.dimensions = JSON.parse(options.dimensions);
  }
  if (options.measures) {
    options.measures = JSON.parse(options.measures);
  }
  if (options.fieldMapping) {
    options.field_mapping = JSON.parse(options.fieldMapping);
  }

  useTemplate(templateName, options, !options.json)
    .then(result => {
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      }
    })
    .catch(error => {
      console.error('❌ 执行失败:', error.message);
      process.exit(1);
    });
}

module.exports = {
  ProgressCallback,
  LarkWorkflowBatchData,
  BaseReadBatch,
  BaseWriteBatch,
  BaseAnalysis,
  DataMigration,
  ExcelImport,
  useTemplate
};

if (require.main === module) {
  main();
}
