# CLI 入口(M8):python -m html_to_pptx --input <task.json>
# task.json: { "html": "...", "outputPath": "..." }
# 结果契约(stdout 永远只有一行 JSON,过程日志一律走 stderr):
#   成功: { "ok": true,  "outputPath": "...", "warnings": [ { "kind": "...", ... } ] }
#   失败: { "ok": false, "error": { "kind": "...", "message": "...", "detail": "..." } }
import argparse
import json
import sys
import traceback

from .converter import convert
from .errors import ConvertError

_KINDS = ('html_parse', 'unsupported_style', 'write_failed', 'internal')


def _force_utf8_stdio() -> None:
    """强制 stdout/stderr 为 UTF-8。

    Windows 下子进程默认按系统 ANSI 代码页(中文系统是 cp936/GBK)编码,
    而结果契约是 UTF-8 JSON:错误信息含中文时,TS 侧按 UTF-8 解析会得到
    乱码甚至解码失败。必须在任何输出前重配置。
    """
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')


def _emit(payload: dict) -> None:
    """单行 JSON 输出,中文不转义,便于 TS 侧直接解析。"""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def main() -> int:
    _force_utf8_stdio()
    parser = argparse.ArgumentParser(prog='html_to_pptx', description='HTML 转 .pptx 转换器(M8)')
    parser.add_argument('--input', required=True, help='任务 JSON 文件路径')
    args = parser.parse_args()

    try:
        with open(args.input, 'r', encoding='utf-8') as f:
            task = json.load(f)
    except Exception as e:  # 任务文件本身读不了:TS 侧保证传入合法 JSON,这里归为 internal
        _emit({'ok': False, 'error': {'kind': 'internal', 'message': f'任务文件读取失败: {e}'}})
        return 1

    html = task.get('html')
    output_path = task.get('outputPath')
    if not isinstance(html, str) or not html.strip() or not isinstance(output_path, str) or not output_path.strip():
        _emit({'ok': False, 'error': {
            'kind': 'html_parse',
            'message': '任务缺少 html 或 outputPath(或为空白),无法转换',
        }})
        return 1

    try:
        result = convert(html, output_path)
        _emit(result)
        return 0
    except ConvertError as e:
        error: dict = {'kind': e.kind if e.kind in _KINDS else 'internal', 'message': e.message}
        if e.detail:
            error['detail'] = e.detail
        _emit({'ok': False, 'error': error})
        return 1
    except Exception as e:  # 未预期异常:兜底成契约形态,并把堆栈放进 detail 便于诊断
        _emit({'ok': False, 'error': {
            'kind': 'internal',
            'message': f'转换器内部错误: {e}',
            'detail': traceback.format_exc(),
        }})
        return 1


if __name__ == '__main__':
    sys.exit(main())
