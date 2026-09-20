import { useState } from 'react';
import { createProject, selectDirectory, updateProject, type Project } from '../lib/projectsClient';

// 新建/编辑项目弹窗(H0,对齐千问:项目名称 + 工作目录选填)
export function ProjectModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Project | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [dir, setDir] = useState(initial?.dir ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const pickDir = async () => {
    const selected = await selectDirectory();
    if (selected) setDir(selected);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError('请输入项目名称');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (editing && initial) {
        await updateProject(initial.id, { name: name.trim(), dir: dir.trim() || undefined });
      } else {
        await createProject({ name: name.trim(), dir: dir.trim() || undefined });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="picker-mask" onClick={onClose}>
      <div className="project-modal" onClick={e => e.stopPropagation()}>
        <div className="project-modal-title-row">
          <span className="project-modal-title">{editing ? '编辑项目' : '新建个人项目'}</span>
          <button className="picker-close" onClick={onClose}>
            ×
          </button>
        </div>

        <label className="project-field">
          <span className="project-field-label">项目名称</span>
          <input
            className="sched-input"
            placeholder="请输入"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
        </label>

        <div className="project-field">
          <span className="project-field-label">工作目录(选填)</span>
          <button type="button" className="project-dir-btn" onClick={() => void pickDir()}>
            {dir ? <span className="project-dir-value">📁 {dir}</span> : '+ 选择文件夹'}
          </button>
          <div className="project-dir-hint">嘉立创Work 可读取并处理其中的文件</div>
        </div>

        {error && <div className="sched-error">{error}</div>}

        <div className="project-modal-actions">
          <button type="button" className="sched-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="sched-btn-primary"
            disabled={submitting || !name.trim()}
            onClick={() => void submit()}
          >
            {submitting ? '保存中…' : editing ? '保存' : '新建项目'}
          </button>
        </div>
      </div>
    </div>
  );
}
