# 一次性修补:把已有 docx 里的 w:pageBreakBefore 段前分页属性转换为显式分页符 run
# 背景:docx-preview 不响应 pageBreakBefore(解析后未使用),只认 w:br type="page"。
# 本脚本只处理"含 pageBreakBefore 且无显式分页符"的文件,老流程生成的文档(本来就
# 用显式分页符)自动跳过。用法:vendor/python/python.exe scripts/patch_docx_explicit_breaks.py
import sys
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / 'src' / 'mastra' / 'public' / 'workspace'


def patch_file(path: Path) -> int:
    """把段落级 pageBreakBefore 属性替换为段首显式分页符 run,返回替换数。"""
    doc = Document(str(path))
    changed = 0
    for p in doc.paragraphs:
        p_pr = p._p.pPr
        if p_pr is None:
            continue
        pbb = p_pr.find(qn('w:pageBreakBefore'))
        if pbb is None:
            continue
        p_pr.remove(pbb)
        # 构造 <w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:br w:type="page"/></w:r>,紧随 pPr
        r = OxmlElement('w:r')
        r_pr = OxmlElement('w:rPr')
        sz = OxmlElement('w:sz')
        sz.set(qn('w:val'), '2')  # 1pt,上一页末尾不留可见空行
        r_pr.append(sz)
        r.append(r_pr)
        br = OxmlElement('w:br')
        br.set(qn('w:type'), 'page')
        r.append(br)
        p_pr.addnext(r)
        changed += 1
    if changed:
        doc.save(str(path))
    return changed


def main() -> int:
    files = sorted(WORKSPACE.rglob('*.docx'))
    print(f'扫描 {len(files)} 个 docx:')
    for f in files:
        try:
            n = patch_file(f)
        except Exception as e:  # 损坏的旧文件跳过,不中断
            print(f'  跳过 {f.name}: {e}')
            continue
        mark = f'✅ 替换 {n} 处' if n else '— 无需处理'
        print(f'  {f.relative_to(WORKSPACE)}: {mark}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
