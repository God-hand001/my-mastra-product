import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TaskInput } from '../components/TaskInput';
import type { Attachment } from '../components/AttachmentBar';
import { ProjectModal } from '../components/ProjectModal';
import { useTaskStore } from '../lib/taskStore';
import { SidebarIcon } from '../components/Sidebar';
import { loadSelectedModel, saveSelectedModel } from '../lib/models';
import { useWorkbenchStore } from '../lib/workbenchStore';
import type { RoleId } from '../lib/workbenchRoles';
import { isDesktop } from '../lib/desktop';
import type { Project } from '../lib/projectsClient';
import { PROMPT_CATEGORIES } from '../lib/promptTemplates';
import jlcLogoMark from '../assets/jlc-logo-mark.png';

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
  const [skill, setSkill] = useState<string | null>(null);
  // M15:首页创建任务时选择场景角色(随任务写入 store,首条消息后锁定)
  const [role, setRole] = useState<RoleId>('general');
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const selected = selectedProject ? projects.find(p => p.id === selectedProject) : undefined;
  // 展开的分类:点击分类 chip → 展开 5 个提示词模板;再点收起
  const [activeScene, setActiveScene] = useState<string | null>(null);
  // 点模板后注入输入框的提示词(nonce 保证相同模板重复点击也触发)
  const [injectText, setInjectText] = useState<{ text: string; nonce: number }>();

  const handleSubmit = (text: string, list: Attachment[]) => {
    const trimmed = text.trim();
    const id = createTask(trimmed || '文档分析任务');
    // M15:首页选定的角色随新 threadId 写入 store——首条消息自动发出时,
    // transport 的 roleOf(threadId) 即取到该角色(若不在此处写入,角色会按
    // 无记录回落 general,用户在首页的选择就被吞掉)
    useWorkbenchStore.getState().setRole(id, role);
    navigate(`/task/${id}`, {
      state: {
        initialMessage: trimmed,
        attachments: list,
        // M10:首页输入框手动指定的技能随首条消息进入 requestContext
        skill: skill ?? undefined,
        project: selected ? { id: selected.id, name: selected.name, dir: selected.dir } : undefined,
      },
    });
  };

  return (
    <div className="home-page">
      <div className="home-hero">
        {/* 品牌标志(替代原吉祥物 emoji) */}
        <div className="home-mascot">
          <div className="home-mascot-circle">
            <img src={jlcLogoMark} alt="嘉立创" />
          </div>
        </div>
        <h1 className="home-greeting">
          {greeting()}，god
          <br />
          有什么需要我搞定的？
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
          skill={skill}
          onSkillChange={setSkill}
          injectText={injectText}
          role={role}
          onRoleChange={setRole}
        />
        {/* H0:项目 chip(输入框下方,千问形态;仅桌面端) */}
        {isDesktop() && (
          <div className="home-project-chip-row">
            <button
              type="button"
              className={`home-project-chip${selected ? ' is-active' : ''}`}
              onClick={e => {
                e.stopPropagation();
                setProjectOpen(o => !o);
              }}
            >
              <span className="home-project-chip-folder"><SidebarIcon name="folder" /></span>
              {selected ? selected.name : '选择项目'}
              <span className="home-project-chev">▾</span>
              <span
                className="home-project-select-overlay"
                onClick={e => e.stopPropagation()}
              />
              {projectOpen && (
                <>
                  <div
                    className="model-menu-backdrop"
                    onClick={e => {
                      e.stopPropagation();
                      setProjectOpen(false);
                    }}
                  />
                  <div className="project-dropdown">
                    <div className="project-dropdown-search">
                      <span className="project-dropdown-search-icon">🔍</span>
                      <input
                        className="project-dropdown-search-input"
                        placeholder="搜索项目"
                        autoFocus
                      />
                    </div>
                    <div className="project-dropdown-list">
                      {projects.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className={`project-dropdown-item${selectedProject === p.id ? ' is-active' : ''}`}
                          onClick={() => {
                            setSelectedProject(p.id);
                            setProjectOpen(false);
                          }}
                        >
                          <span className="project-dropdown-folder"><SidebarIcon name="folder" /></span>
                          <span className="project-dropdown-name">{p.name}</span>
                          {selectedProject === p.id && (
                            <span className="project-dropdown-check">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="project-dropdown-divider" />
                    <button
                      type="button"
                      className="project-dropdown-item"
                      onClick={() => {
                        setProjectOpen(false);
                        setProjectModalOpen(true);
                      }}
                    >
                      <span className="project-dropdown-folder">＋</span>
                      <span className="project-dropdown-name">新建项目</span>
                    </button>
                    <button
                      type="button"
                      className="project-dropdown-item"
                      onClick={() => {
                        setSelectedProject(null);
                        setProjectOpen(false);
                      }}
                    >
                      <span className="project-dropdown-folder">✕</span>
                      <span className="project-dropdown-name">不在项目中工作</span>
                    </button>
                  </div>
                </>
              )}
            </button>
          </div>
        )}
        {/* 推荐场景 chips:点击展开该分类的提示词模板,点模板填入输入框 */}
        <div className="home-scenes">
          {PROMPT_CATEGORIES.map(scene => (
            <button
              key={scene.label}
              type="button"
              className={`home-scene-chip${activeScene === scene.label ? ' is-active' : ''}`}
              onClick={() => setActiveScene(cur => (cur === scene.label ? null : scene.label))}
            >
              <scene.icon className="home-scene-icon" />
              {scene.label}
            </button>
          ))}
        </div>
        {(() => {
          const active = PROMPT_CATEGORIES.find(c => c.label === activeScene);
          if (!active) return null;
          return (
            <div className="home-prompt-list">
              {active.templates.map(t => (
                <button
                  key={t.title}
                  type="button"
                  className="home-prompt-item"
                  onClick={() => setInjectText({ text: t.prompt, nonce: Date.now() })}
                >
                  <span className="home-prompt-item-title">{t.title}</span>
                  <span className="home-prompt-item-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          );
        })()}
      </div>
      {projectModalOpen && (
        <ProjectModal
          onClose={() => setProjectModalOpen(false)}
          onSaved={() => {
            setProjectModalOpen(false);
            window.dispatchEvent(new CustomEvent('h0-projects-changed'));
          }}
        />
      )}
    </div>
  );
}
