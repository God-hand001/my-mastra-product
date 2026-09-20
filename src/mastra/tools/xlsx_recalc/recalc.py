"""xlsx 公式重算引擎封装。

职责:
- 用 formulas 库对 xlsx 中的公式重新求值;
- 保留公式字符串,仅把计算结果回填为缓存值(<v>);
- 输出单行 JSON,调用方必须读取 status/totalErrors,不能依赖退出码。
"""
from __future__ import annotations

import json
import os
import re
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from xml.etree import ElementTree as ET

# formulas/openpyxl 在 vendor/python 中预装;若缺失则 engine=none 并给出中文说明
try:
    import numpy as np
    import openpyxl
    import formulas
    from openpyxl.worksheet.formula import ArrayFormula

    FORMULAS_AVAILABLE = True
except Exception:  # pragma: no cover - 运行时不应缺失,但防御
    FORMULAS_AVAILABLE = False
    ArrayFormula = None

# Excel 单元格 XML 命名空间
SHEET_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS = "{%s}" % SHEET_MAIN_NS

# 错误类型映射(供 errorSummary.kind)
ERROR_KINDS = {
    "#DIV/0!": "div0",
    "#N/A": "na",
    "#NAME?": "name",
    "#NULL!": "null",
    "#NUM!": "num",
    "#REF!": "ref",
    "#VALUE!": "value",
}

# 动态数组/新版函数:formulas 不支持或溢出语义不可信,直接报 engine error
_DYNAMIC_FUNCTIONS = (
    "UNIQUE", "SORT", "SORTBY", "FILTER", "SEQUENCE", "RANDARRAY",
    "XLOOKUP", "XMATCH", "LET", "LAMBDA", "TOROW", "TOCOL",
    "WRAPROWS", "WRAPCOLS", "TAKE", "DROP", "CHOOSECOLS", "CHOOSEROWS",
    "EXPAND", "HSTACK", "VSTACK",
)
_DYNAMIC_FUNC_RE = re.compile(
    r"\b(?:" + "|".join(_DYNAMIC_FUNCTIONS) + r")\s*\(", re.IGNORECASE
)

# 两个区域直接做四则运算,属于动态数组/溢出语义,不支持(如 =A1:A3*B1:B3)
_RANGE_OP_RE = re.compile(
    r"(?<![\w\(])[A-Z]+\d+:[A-Z]+\d+\s*[-+*/]\s*[A-Z]+\d+:[A-Z]+\d+",
    re.IGNORECASE,
)

# 外部引用:=[book.xlsx]Sheet!A1
_EXTERNAL_RE = re.compile(r"\=[^\[]*\[[^\]]+\][^!]*![A-Z]+\d+", re.IGNORECASE)

DEFAULT_TIMEOUT = 60


class RecalcError(Exception):
    """recalc 内部异常,会映射为 status=error。"""


class UnsupportedFormulaError(RecalcError):
    """公式包含外部引用、动态数组或不受支持函数。"""


def _force_utf8_stdio() -> None:
    """Windows 子进程默认 GBK,强制 UTF-8 避免中文乱码。"""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")


def _normalize_value(val):
    """把 formulas 的返回值转成 Python 原生类型,方便 JSON/缓存写入。"""
    if val is None:
        return None
    # numpy 标量
    if "numpy" in str(type(val)) and hasattr(val, "item"):
        return val.item()
    # formulas 错误对象 str 为 #DIV/0! 等
    s = str(val)
    if s.startswith("#") and s in ERROR_KINDS:
        return s
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float, str)):
        return val
    # 其余保持原样(理论上不应出现)
    return val


def _parse_solution(sol: dict) -> dict:
    """把 formulas.calculate() 返回的坐标字典展开为 {(sheet, cell): value}。"""
    values: dict[tuple[str, str], object] = {}
    ref_re = re.compile(r"(?:'\[.+\](.+)'|\[.+\](.+))!([A-Z]+\d+)(?::([A-Z]+\d+))?")

    for key, rng in sol.items():
        m = ref_re.match(str(key))
        if not m:
            continue
        sheet = m.group(1) or m.group(2)
        start = m.group(3)
        end = m.group(4)
        try:
            arr = np.asarray(rng.value)
        except Exception as exc:
            raise RecalcError(
                f"无法读取 {sheet}!{start} 的计算结果: {exc}"
            ) from exc
        if arr.ndim == 0:
            arr = arr.reshape(1, 1)
        if end is None:
            values[(sheet, start)] = _normalize_value(arr[0, 0])
        else:
            from openpyxl.utils import get_column_letter, column_index_from_string

            def col_row(addr: str):
                cm = re.match(r"([A-Z]+)(\d+)", addr)
                if not cm:
                    raise RecalcError(f"无法解析坐标: {addr}")
                return cm.group(1), int(cm.group(2))

            sc, sr = col_row(start)
            ec, er = col_row(end)
            si = column_index_from_string(sc)
            ei = column_index_from_string(ec)
            for ri in range(sr, er + 1):
                for ci in range(si, ei + 1):
                    rr = ri - sr
                    cc = ci - si
                    val = arr[rr, cc] if rr < arr.shape[0] and cc < arr.shape[1] else None
                    values[(sheet, f"{get_column_letter(ci)}{ri}")] = _normalize_value(val)
    return values


def _collect_formula_cells(wb: openpyxl.Workbook) -> list[tuple[str, str, object]]:
    """收集所有公式单元格:(sheet_name, coordinate, formula_or_ArrayFormula)。"""
    cells: list[tuple[str, str, object]] = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        for row in ws.iter_rows():
            for cell in row:
                if cell.data_type == "f" and cell.value is not None:
                    cells.append((sheet_name, cell.coordinate, cell.value))
    return cells


def _check_unsupported_formulas(formula_cells: list[tuple[str, str, object]]) -> list[dict]:
    """扫描外部引用、CSE 数组公式、动态数组函数/区域运算。"""
    bad: list[dict] = []
    for sheet, coord, formula in formula_cells:
        # CSE 数组公式
        if ArrayFormula is not None and isinstance(formula, ArrayFormula):
            bad.append({"cell": f"{sheet}!{coord}", "reason": "CSE/数组公式(动态数组)不被支持"})
            continue
        text = str(formula).upper()
        if _EXTERNAL_RE.search(str(formula)):
            bad.append({"cell": f"{sheet}!{coord}", "reason": "包含外部工作簿引用"})
            continue
        if _DYNAMIC_FUNC_RE.search(str(formula)):
            bad.append({"cell": f"{sheet}!{coord}", "reason": "包含动态数组/新函数"})
            continue
        if _RANGE_OP_RE.search(str(formula)):
            bad.append({"cell": f"{sheet}!{coord}", "reason": "区域间直接运算(动态数组语义)"})
            continue
    return bad


def _backfill(xlsx_path: Path, values: dict[tuple[str, str], object]) -> None:
    """直接修改 xlsx zip 内的 sheet XML,在公式节点后写入缓存值。"""
    tmp = xlsx_path.with_suffix(".xlsx.tmp")
    # 用只读打开获取 sheet 顺序,避免破坏原文件
    rwb = openpyxl.load_workbook(str(xlsx_path), read_only=True, data_only=False)
    sheet_names = rwb.sheetnames
    rwb.close()

    with zipfile.ZipFile(xlsx_path, "r") as zin, zipfile.ZipFile(
        tmp, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("xl/worksheets/sheet") and item.filename.endswith(".xml"):
                stem = Path(item.filename).stem  # sheet1
                try:
                    idx = int(stem.replace("sheet", "")) - 1
                except ValueError:
                    idx = -1
                sheet_name = sheet_names[idx] if 0 <= idx < len(sheet_names) else ""
                root = ET.fromstring(data)
                for cell in root.iter(NS + "c"):
                    addr = cell.get("r")
                    f_node = cell.find(NS + "f")
                    if not addr or f_node is None:
                        continue
                    val = values.get((sheet_name, addr))
                    if val is None:
                        continue
                    # 确定缓存值类型并写入 <v>
                    if isinstance(val, str) and val.startswith("#"):
                        cell.set("t", "e")
                        text = val
                    elif isinstance(val, bool):
                        cell.set("t", "b")
                        text = "1" if val else "0"
                    elif isinstance(val, str):
                        cell.set("t", "str")
                        text = val
                    elif isinstance(val, (int, float)):
                        cell.set("t", "n")
                        text = str(val)
                    else:
                        cell.set("t", "str")
                        text = str(val)
                    v_node = cell.find(NS + "v")
                    if v_node is None:
                        v_node = ET.Element(NS + "v")
                        idx_node = list(cell).index(f_node)
                        cell.insert(idx_node + 1, v_node)
                    v_node.text = text
                data = ET.tostring(root, encoding="UTF-8", xml_declaration=True)
            zout.writestr(item, data)
    # 原子替换
    tmp.replace(xlsx_path)


def _evaluate(xlsx_path: Path) -> dict:
    """实际执行重算与回填,返回结果字典。"""
    if not FORMULAS_AVAILABLE:
        return {
            "engine": "none",
            "status": "error",
            "totalErrors": 0,
            "errorSummary": [],
            "backfilled": False,
            "message": "未找到 formulas/openpyxl 引擎,请运行 node scripts/setup-python-runtime.mjs 重建运行时",
        }

    # 1) 用 openpyxl 预扫描,提前发现外部引用/动态数组
    wb = openpyxl.load_workbook(str(xlsx_path), data_only=False)
    formula_cells = _collect_formula_cells(wb)
    wb.close()
    unsupported = _check_unsupported_formulas(formula_cells)
    if unsupported:
        details = "; ".join(f"{u['cell']}({u['reason']})" for u in unsupported)
        raise UnsupportedFormulaError(
            f"检测到不支持的公式(外部引用/动态数组/新函数): {details}"
        )

    # 2) formulas 加载与计算
    try:
        model = formulas.ExcelModel().loads(str(xlsx_path)).finish()
        sol = model.calculate()
    except UnsupportedFormulaError:
        raise
    except RecalcError:
        raise
    except Exception as exc:
        raise RecalcError(f"formulas 重算失败: {exc}") from exc

    # 3) 解析计算结果
    try:
        values = _parse_solution(sol)
    except Exception as exc:
        raise RecalcError(f"解析计算结果失败: {exc}") from exc

    # 4) 收集错误单元格
    error_summary = []
    for sheet, coord, _formula in formula_cells:
        val = values.get((sheet, coord))
        if isinstance(val, str) and val.startswith("#"):
            kind = ERROR_KINDS.get(val, "error")
            error_summary.append({"cell": f"{sheet}!{coord}", "kind": kind})

    # 5) 回填(即使含错误也回填,让调用方看到全部结果)
    try:
        _backfill(xlsx_path, values)
        backfilled = True
    except Exception as exc:
        raise RecalcError(f"回填缓存值失败: {exc}") from exc

    if error_summary:
        return {
            "engine": "formulas",
            "status": "errors_found",
            "totalErrors": len(error_summary),
            "errorSummary": error_summary,
            "backfilled": backfilled,
        }
    return {
        "engine": "formulas",
        "status": "success",
        "totalErrors": 0,
        "errorSummary": [],
        "backfilled": backfilled,
    }


def _worker(xlsx_path: str) -> dict:
    """子进程工作函数,隔离重算任务以便实现超时控制。"""
    return _evaluate(Path(xlsx_path))


def run_recalc(xlsx_path: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """对外入口:在独立进程中执行重算,超时返回 error。"""
    path = Path(xlsx_path)
    if not path.exists():
        return {
            "engine": "none",
            "status": "error",
            "totalErrors": 0,
            "errorSummary": [],
            "backfilled": False,
            "message": f"文件不存在: {xlsx_path}",
        }
    try:
        with ProcessPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_worker, str(path.resolve()))
            result = future.result(timeout=timeout)
            return result
    except FutureTimeoutError:
        return {
            "engine": "formulas",
            "status": "error",
            "totalErrors": 0,
            "errorSummary": [],
            "backfilled": False,
            "message": f"formulas 重算超时(>{timeout}秒):请简化公式或检查循环引用",
        }
    except Exception as exc:
        return {
            "engine": "formulas",
            "status": "error",
            "totalErrors": 0,
            "errorSummary": [],
            "backfilled": False,
            "message": f"重算异常: {exc}",
        }


def main() -> int:
    """CLI 入口:python -m xlsx_recalc <xlsx> [timeout]。"""
    _force_utf8_stdio()
    args = sys.argv[1:]
    if len(args) < 1:
        result = {
            "engine": "none",
            "status": "error",
            "totalErrors": 0,
            "errorSummary": [],
            "backfilled": False,
            "message": "用法: python -m xlsx_recalc <xlsx路径> [超时秒数]",
        }
        print(json.dumps(result, ensure_ascii=False))
        return 1

    xlsx_path = args[0]
    timeout = DEFAULT_TIMEOUT
    if len(args) >= 2:
        try:
            timeout = int(args[1])
            if timeout < 1:
                timeout = DEFAULT_TIMEOUT
        except ValueError:
            timeout = DEFAULT_TIMEOUT

    result = run_recalc(xlsx_path, timeout)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("status") in ("success", "errors_found") else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
