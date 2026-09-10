import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TaskInput } from '../components/TaskInput';
import type { Attachment } from '../components/AttachmentBar';
import { useTaskStore } from '../lib/taskStore';
import { loadSelectedModel, saveSelectedModel } from '../lib/models';
import { isDesktop } from '../lib/desktop';
import type { Project } from '../lib/projectsClient';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function HomePage({ projects }: { projects: Project[] }) {
  const navigate = useNavigate();
  const { createTask, selectedProject, setSelectedProject } = useTaskStore();
  const [model, setModel] = useState(loadSelectedModel());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const selected = selectedProject ? projects.find(p => p.id === selectedProject) : undefined;

  const handleSubmit = (text: string, list: Attachment[]) => {
    // M2 F2:附件全文已由后端提取;首条消息保持用户原文干净,
    // 附件全文由 transport 在发送时合并(渲染层显示文档卡片)
    const trimmed = text.trim();
    const id = createTask(trimmed || '文档分析任务');
    navigate(`/task/${id}`, {
      state: {
        initialMessage: trimmed,
        attachments: list,
        // H0:任务归入当前所选项目( TaskPage 首条消息后绑定 )
        project: selected ? { id: selected.id, name: selected.name, dir: selected.dir } : undefined,
      },
    });
  };

  return (
    <div className="home-page">
      <div className="home-hero">
        <h1 className="home-greeting">
          {greeting()},god
          <br />
          准备好创建点什么了吗?
        </h1>
        <TaskInput
          onSubmit={handleSubmit}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          model={model}
          onModelChange={id => {
            setModel(id);
            saveSelectedModel(id);
          }}
        />
        {/* H0:当前项目 chip(输入框下方,千问形态;仅桌面端且有项目时显示) */}
        {isDesktop() && projects.length > 0 && (
          <div className="home-project-chip-row">
            <span className={`home-project-chip${selected ? ' is-active' : ''}`}>
              📁 {selected ? selected.name : '选择项目'}
              <span className="home-project-chev">▾</span>
              <select
                className="home-project-select"
                value={selectedProject ?? ''}
                onChange={e => setSelectedProject(e.target.value || null)}
              >
                <option value="">无项目</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
