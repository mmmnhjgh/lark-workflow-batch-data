#!/usr/bin/env python3
"""
飞书批量数据操作工作流 Python 包装器

这个模块为 lark-cli 批量数据操作提供 Python 接口，方便 OpenClaw 集成使用。
"""

import subprocess
import json
import time
import os
import sys
from typing import List, Dict, Any, Optional, Iterator, Callable


class ProgressCallback:
    """进度回调处理器"""
    
    def __init__(self, show_progress: bool = True):
        self.show_progress = show_progress
        self.total_read = 0
        self.total_written = 0
        self.current_batch = 0
    
    def on_read_batch(self, batch_size: int, offset: int, has_more: bool):
        """读取一批数据时调用"""
        self.total_read += batch_size
        if self.show_progress:
            progress = f"已读取 {self.total_read} 条记录"
            if has_more:
                progress += " (继续读取中...)"
            print(f"📊 {progress}")
    
    def on_write_record(self, record_index: int, total_records: int, success: bool):
        """写入一条记录时调用"""
        if success:
            self.total_written += 1
        if self.show_progress and record_index % 50 == 0:
            progress = (record_index / total_records) * 100
            print(f"✏️ 写入进度: {progress:.1f}% ({record_index}/{total_records})")
    
    def on_complete(self, operation: str, result: Dict[str, Any]):
        """操作完成时调用"""
        if self.show_progress:
            print(f"\n✅ {operation} 完成！")
            if operation == "read":
                print(f"   总计读取: {result.get('total', 0)} 条记录")
            elif operation == "write":
                print(f"   成功写入: {result.get('total_written', 0)} 条")
                print(f"   失败: {len(result.get('failed_records', []))} 条")


class LarkWorkflowBatchData:
    """飞书批量数据操作基类"""
    
    def __init__(self, base_token: str, progress_callback: Optional[ProgressCallback] = None):
        self.base_token = base_token
        self.retry_times = int(os.environ.get('LARK_WORKFLOW_BATCH_DATA_RETRY_TIMES', 3))
        self.progress_callback = progress_callback or ProgressCallback()
    
    def _run_command(self, command: List[str]) -> Dict[str, Any]:
        """运行 lark-cli 命令并返回解析后的结果"""
        for attempt in range(self.retry_times):
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=True
                )
                return json.loads(result.stdout)
            except subprocess.CalledProcessError as e:
                error_msg = e.stderr or e.stdout
                print(f"⚠️  命令执行失败: {error_msg}")
                
                # 处理可重试的错误
                if "429" in error_msg:
                    # 速率限制，指数退避
                    wait_time = 2 ** attempt
                    print(f"⏳ 遇到速率限制，等待 {wait_time} 秒后重试...")
                    time.sleep(wait_time)
                elif "1254291" in error_msg:
                    # 并发冲突，固定间隔重试
                    print("⏳ 遇到并发冲突，等待 1 秒后重试...")
                    time.sleep(1)
                elif "1254104" in error_msg:
                    # 批量超限，需要调整批次大小
                    print("⚠️  遇到批量超限，需要调整批次大小")
                    raise
                else:
                    # 其他不可重试的错误
                    raise
        raise Exception(f"❌ 命令执行失败，已重试 {self.retry_times} 次")


class BaseReadBatch(LarkWorkflowBatchData):
    """批量读取多维表格数据"""
    
    def __init__(self, base_token: str, table_id: str, limit: int = 200, 
                 progress_callback: Optional[ProgressCallback] = None):
        super().__init__(base_token, progress_callback)
        self.table_id = table_id
        self.limit = limit
    
    def read_all(self, offset: int = 0) -> List[Dict[str, Any]]:
        """自动分页读取所有数据
        
        Args:
            offset: 起始偏移量（用于断点续传）
        
        Returns:
            所有记录的列表
        """
        all_records = []
        current_offset = offset
        has_more = True
        
        while has_more:
            command = [
                "lark-cli", "base", "+record-list",
                "--base-token", self.base_token,
                "--table-id", self.table_id,
                "--offset", str(current_offset),
                "--limit", str(self.limit)
            ]
            
            result = self._run_command(command)
            records = result.get("data", {}).get("items", [])
            
            if records:
                all_records.extend(records)
                self.progress_callback.on_read_batch(
                    len(records), current_offset, 
                    result.get("data", {}).get("has_more", False)
                )
            
            has_more = result.get("data", {}).get("has_more", False)
            current_offset += len(records)
            
            # 避免请求过快
            time.sleep(0.5)
        
        self.progress_callback.on_complete("read", {"total": len(all_records), "records": all_records})
        return all_records


class BaseWriteBatch(LarkWorkflowBatchData):
    """批量写入数据到多维表格"""
    
    def __init__(self, base_token: str, table_id: str, 
                 progress_callback: Optional[ProgressCallback] = None):
        super().__init__(base_token, progress_callback)
        self.table_id = table_id
        self.batch_size = 500
    
    def write_batch(self, data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """批量写入数据，自动分批处理
        
        Args:
            data: 要写入的数据列表
        
        Returns:
            包含写入结果的字典
        """
        total_written = 0
        failed_records = []
        
        # 先获取字段结构，过滤只读字段
        fields = self._get_fields()
        writable_fields = [f["name"] for f in fields if f.get("writable", True)]
        
        # 分批处理
        total_records = len(data)
        for idx, record in enumerate(data, 1):
            # 过滤只读字段
            filtered_record = {k: v for k, v in record.items() if k in writable_fields}
            
            command = [
                "lark-cli", "base", "+record-upsert",
                "--base-token", self.base_token,
                "--table-id", self.table_id,
                "--json", json.dumps(filtered_record)
            ]
            
            success = False
            try:
                self._run_command(command)
                total_written += 1
                success = True
            except Exception as e:
                failed_records.append({
                    "index": idx,
                    "record": record,
                    "error": str(e)
                })
            
            self.progress_callback.on_write_record(idx, total_records, success)
            
            # 避免写入过快
            time.sleep(0.1)
            
            # 批次间延迟
            if idx % self.batch_size == 0 and idx < total_records:
                print("⏸️  批次间延迟 1 秒...")
                time.sleep(1)
        
        result = {
            "total_written": total_written,
            "failed_records": failed_records,
            "total_records": total_records
        }
        self.progress_callback.on_complete("write", result)
        return result
    
    def _get_fields(self) -> List[Dict[str, Any]]:
        """获取表字段结构"""
        command = [
            "lark-cli", "base", "+field-list",
            "--base-token", self.base_token,
            "--table-id", self.table_id
        ]
        result = self._run_command(command)
        return result.get("data", {}).get("items", [])


class BaseAnalysis(LarkWorkflowBatchData):
    """使用服务端聚合分析数据"""
    
    def __init__(self, base_token: str, table_id: str, 
                 progress_callback: Optional[ProgressCallback] = None):
        super().__init__(base_token, progress_callback)
        self.table_id = table_id
    
    def analyze(self, dimensions: List[str], measures: List[Dict[str, str]]) -> Dict[str, Any]:
        """分析数据
        
        Args:
            dimensions: 维度字段列表
            measures: 度量字段列表，每个元素包含 field_name 和 aggregation
        
        Returns:
            分析结果
        """
        print("📈 正在执行服务端聚合分析...")
        
        query = {
            "datasource": {
                "type": "table",
                "table": {
                    "tableId": self.table_id
                }
            },
            "dimensions": [
                {"field_name": dim, "alias": dim}
                for dim in dimensions
            ],
            "measures": [
                {
                    "field_name": m["field_name"],
                    "aggregation": m["aggregation"],
                    "alias": m.get("alias", f"{m['field_name']}_{m['aggregation']}")
                }
                for m in measures
            ],
            "shaper": {
                "format": "flat"
            }
        }
        
        command = [
            "lark-cli", "base", "+data-query",
            "--base-token", self.base_token,
            "--json", json.dumps(query)
        ]
        
        result = self._run_command(command)
        
        # 格式化输出结果
        items = result.get("data", {}).get("items", [])
        print(f"\n📊 分析结果（共 {len(items)} 条）：")
        print("-" * 50)
        
        if items:
            # 打印表头
            headers = list(items[0].keys())
            print("\t".join(headers))
            print("-" * 50)
            
            # 打印数据
            for item in items:
                values = [str(item.get(h, "")) for h in headers]
                print("\t".join(values))
        
        return result


class DataMigration:
    """跨表数据迁移"""
    
    def __init__(self, source_base_token: str, source_table_id: str, 
                 target_base_token: str, target_table_id: str,
                 progress_callback: Optional[ProgressCallback] = None):
        self.progress_callback = progress_callback or ProgressCallback()
        self.source_reader = BaseReadBatch(source_base_token, source_table_id, 
                                            progress_callback=progress_callback)
        self.target_writer = BaseWriteBatch(target_base_token, target_table_id, 
                                            progress_callback=progress_callback)
    
    def migrate(self, field_mapping: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """执行数据迁移
        
        Args:
            field_mapping: 字段映射，源字段名到目标字段名的映射
        
        Returns:
            迁移结果
        """
        print("🔄 开始数据迁移...")
        
        # 读取源表数据
        print("📥 步骤 1/3: 读取源表数据...")
        all_records = self.source_reader.read_all()
        
        # 字段映射
        print("🔄 步骤 2/3: 处理字段映射...")
        mapped_records = []
        for record in all_records:
            fields = record.get("fields", {})
            if field_mapping:
                mapped = {}
                for source_field, target_field in field_mapping.items():
                    if source_field in fields:
                        mapped[target_field] = fields[source_field]
                mapped_records.append(mapped)
            else:
                # 直接使用相同字段名
                mapped_records.append(fields)
        
        # 写入目标表
        print("📤 步骤 3/3: 写入目标表...")
        return self.target_writer.write_batch(mapped_records)


class ExcelImport:
    """导入 Excel 到多维表格"""
    
    def __init__(self, file_path: str, base_name: str = "导入的数据表"):
        self.file_path = file_path
        self.base_name = base_name
    
    def import_file(self) -> Dict[str, Any]:
        """执行导入操作
        
        Returns:
            导入结果
        """
        print(f"📁 开始导入文件: {self.file_path}")
        
        command = [
            "lark-cli", "drive", "+import",
            "--file", self.file_path,
            "--type", "bitable",
            "--name", self.base_name
        ]
        
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=True
        )
        
        output = json.loads(result.stdout)
        ticket = output.get("data", {}).get("ticket")
        
        if ticket:
            print(f"🎫 已获取导入任务 ticket: {ticket}")
            # 检查导入状态
            return self._check_import_status(ticket)
        
        return output
    
    def _check_import_status(self, ticket: str) -> Dict[str, Any]:
        """检查导入状态"""
        command = [
            "lark-cli", "drive", "+task_result",
            "--scenario", "import",
            "--ticket", ticket
        ]
        
        # 轮询直到导入完成
        print("⏳ 正在等待导入完成...")
        while True:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=True
            )
            
            output = json.loads(result.stdout)
            status = output.get("data", {}).get("status")
            
            if status == "completed":
                print("✅ 导入完成！")
                return output
            elif status == "failed":
                raise Exception(f"❌ 导入失败: {output.get('data', {}).get('error', 'Unknown error')}")
            elif status == "processing":
                print("⏳ 导入中...")
            
            # 等待 5 秒后再次检查
            time.sleep(5)


# 便捷函数
def use_template(template_name: str, params: Dict[str, Any], 
                 show_progress: bool = True) -> Dict[str, Any]:
    """使用模板执行操作
    
    Args:
        template_name: 模板名称
        params: 模板参数
        show_progress: 是否显示进度
    
    Returns:
        执行结果
    """
    progress_callback = ProgressCallback(show_progress=show_progress)
    
    if template_name == "base_read_batch":
        reader = BaseReadBatch(
            base_token=params["base_token"],
            table_id=params["table_id"],
            limit=params.get("limit", 200),
            progress_callback=progress_callback
        )
        records = reader.read_all(offset=params.get("offset", 0))
        return {"records": records, "total": len(records)}
    
    elif template_name == "base_write_batch":
        writer = BaseWriteBatch(
            base_token=params["base_token"],
            table_id=params["table_id"],
            progress_callback=progress_callback
        )
        return writer.write_batch(params["data"])
    
    elif template_name == "base_analysis":
        analyzer = BaseAnalysis(
            base_token=params["base_token"],
            table_id=params["table_id"],
            progress_callback=progress_callback
        )
        return analyzer.analyze(params["dimensions"], params["measures"])
    
    elif template_name == "data_migration":
        migration = DataMigration(
            source_base_token=params["source_base_token"],
            source_table_id=params["source_table_id"],
            target_base_token=params["target_base_token"],
            target_table_id=params["target_table_id"],
            progress_callback=progress_callback
        )
        return migration.migrate(params.get("field_mapping"))
    
    elif template_name == "excel_import":
        importer = ExcelImport(
            file_path=params["file_path"],
            base_name=params.get("base_name", "导入的数据表")
        )
        return importer.import_file()
    
    else:
        raise Exception(f"❌ 未知的模板名称: {template_name}")


def main():
    """命令行接口"""
    import argparse
    
    parser = argparse.ArgumentParser(description="飞书批量数据操作工具")
    subparsers = parser.add_subparsers(title="模板", dest="template")
    
    # base_read_batch 模板
    read_parser = subparsers.add_parser("base_read_batch", help="批量读取多维表格数据")
    read_parser.add_argument("--base-token", required=True, help="多维表格的 token")
    read_parser.add_argument("--table-id", required=True, help="表 ID 或表名")
    read_parser.add_argument("--limit", type=int, default=200, help="每页条数，默认 200")
    read_parser.add_argument("--offset", type=int, default=0, help="起始偏移量，默认 0")
    read_parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    
    # base_write_batch 模板
    write_parser = subparsers.add_parser("base_write_batch", help="批量写入数据到多维表格")
    write_parser.add_argument("--base-token", required=True, help="多维表格的 token")
    write_parser.add_argument("--table-id", required=True, help="表 ID 或表名")
    write_parser.add_argument("--data", required=True, help="要写入的数据（JSON 格式或文件路径）")
    write_parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    
    # base_analysis 模板
    analysis_parser = subparsers.add_parser("base_analysis", help="使用服务端聚合分析数据")
    analysis_parser.add_argument("--base-token", required=True, help="多维表格的 token")
    analysis_parser.add_argument("--table-id", required=True, help="表 ID 或表名")
    analysis_parser.add_argument("--dimensions", required=True, help="维度字段列表（JSON 格式）")
    analysis_parser.add_argument("--measures", required=True, help="度量字段列表（JSON 格式）")
    analysis_parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    
    # data_migration 模板
    migration_parser = subparsers.add_parser("data_migration", help="跨表数据迁移")
    migration_parser.add_argument("--source-base-token", required=True, help="源多维表格的 token")
    migration_parser.add_argument("--source-table-id", required=True, help="源表 ID 或表名")
    migration_parser.add_argument("--target-base-token", required=True, help="目标多维表格的 token")
    migration_parser.add_argument("--target-table-id", required=True, help="目标表 ID 或表名")
    migration_parser.add_argument("--field-mapping", help="字段映射（JSON 格式）")
    migration_parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    
    # excel_import 模板
    import_parser = subparsers.add_parser("excel_import", help="导入 Excel 到多维表格")
    import_parser.add_argument("--file-path", required=True, help="Excel/CSV 文件路径")
    import_parser.add_argument("--base-name", default="导入的数据表", help="目标多维表格名称")
    import_parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    
    args = parser.parse_args()
    
    if not args.template:
        parser.print_help()
        return
    
    # 准备参数
    params = vars(args).copy()
    params.pop("template", None)
    params.pop("json", None)
    
    # 解析 JSON 参数
    if args.template == "base_write_batch" and args.data:
        if os.path.isfile(args.data):
            with open(args.data, "r") as f:
                params["data"] = json.load(f)
        else:
            params["data"] = json.loads(args.data)
    
    if args.template == "base_analysis":
        params["dimensions"] = json.loads(args.dimensions)
        params["measures"] = json.loads(args.measures)
    
    if args.template == "data_migration" and args.field_mapping:
        params["field_mapping"] = json.loads(args.field_mapping)
    
    # 执行模板
    result = use_template(args.template, params, show_progress=not args.json)
    
    # 输出结果
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
