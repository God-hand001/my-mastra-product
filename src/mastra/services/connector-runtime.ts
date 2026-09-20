import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { MCPClient } from '@mastra/mcp';
import { listConnectors, setConnectorError } from './extension-store';
import { workspaceRoot } from './project-root';
import { resolvePythonRuntime } from './python-runtime';
import { buildWrapperArgv } from './sandbox-runtime';

// workspace 根目录：connector.json 中 ${ROOT} 占位符替换目标
const WORKSPACE_ROOT = workspaceRoot();
// vendor/python 解释器：connector.json 中 ${PY} 占位符替换目标(官方 Python MCP 服务器用它跑)。
// buildClient 开始时解析一次;空串表示运行时缺失,占位符替换后命令必然失败,原因会落到 lastError。
let pythonExePath = '';

// MCPClient 单例；null 表示尚未初始化或已清理
let mcpClient: MCPClient | null = null;

/**
 * 解析连接器配置：把 command/args 里的 ${ROOT}/${PY} 占位符替换为绝对路径。
 * ${ROOT} → workspace 根;${PY} → vendor/python/python.exe。
 */
function resolvePlaceholder(value: string): string {
  return value
    .replace(/\$\{ROOT\}/g, WORKSPACE_ROOT)
    .replace(/\$\{PY\}/g, pythonExePath);
}

function resolveArgs(args: unknown[]): string[] {
  return (args ?? []).map(arg => {
    if (typeof arg !== 'string') return String(arg);
    return resolvePlaceholder(arg);
  });
}

/**
 * 解析 externalWrite 声明中的 ${NPMCACHE} 占位符。
 * Windows 下指向用户级 npm-cache(与 N4 实测一致);非 Windows 回退到 ~/.npm。
 */
function resolveExternalWritePath(value: string): string {
  return value.replace(/\$\{NPMCACHE\}/g, () => {
    if (process.platform === 'win32') {
      return path.join(os.homedir(), 'AppData', 'Local', 'npm-cache');
    }
    return path.join(os.homedir(), '.npm');
  });
}

/**
 * 构造当前启用且配置合法的连接器 MCPClient。
 * 每个连接器 60s 启动超时；单个失败被捕获，原因写入对应连接器的 lastError，不影响其他连接器。
 */
async function buildClient(): Promise<MCPClient> {
  // 解析 ${PY} 占位符用的 Python 解释器路径;失败置空串(对应连接器启动失败,原因进 lastError)
  try {
    pythonExePath = (await resolvePythonRuntime()).pythonExe;
  } catch {
    pythonExePath = '';
  }

  // 清理旧实例，避免配置变更后仍保留旧连接
  if (mcpClient) {
    try {
      await mcpClient.disconnect();
    } catch {
      // 清理失败不影响重新构造
    }
    mcpClient = null;
  }

  const connectors = listConnectors().filter(c => c.enabled && !c.invalid);
  const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  // 被门控拦下的连接器集合,避免末尾清错把「需要授权」清掉
  const gated = new Set<string>();

  for (const c of connectors) {
    const cfg = c.config as {
      command?: string;
      args?: unknown[];
      env?: Record<string, string>;
      capabilities?: { network?: boolean; externalWrite?: string[] };
    };
    if (!cfg.command || typeof cfg.command !== 'string') {
      setConnectorError(c.name, 'connector.json 缺少合法 command 字段');
      continue;
    }

    // 占位符替换必须在沙箱包裹**之前**完成 —— 包裹后 argv 里混入了策略 JSON,
    // 再做字符串替换会破坏它。
    let command = resolvePlaceholder(cfg.command);
    let args = resolveArgs(cfg.args ?? []);

    const declared = cfg.capabilities ?? {};
    const granted = new Set(c.grantedCapabilities ?? []);

    // 门控(fail-closed):声明了 network 但未授予
    if (declared.network === true && !granted.has('network')) {
      setConnectorError(c.name, '需要授权:联网');
      gated.add(c.name);
      continue;
    }

    // 解析 externalWrite 路径并检查授权
    const extraWriteRoots: string[] = [];
    let externalWriteMissing = false;
    const declaredExternalWrite = declared.externalWrite;
    if (Array.isArray(declaredExternalWrite) && declaredExternalWrite.length > 0) {
      if (!granted.has('externalWrite')) {
        externalWriteMissing = true;
      } else {
        for (const raw of declaredExternalWrite) {
          if (typeof raw === 'string') {
            extraWriteRoots.push(resolveExternalWritePath(raw));
          }
        }
      }
    }
    if (externalWriteMissing) {
      const displayRoots = (declaredExternalWrite ?? [])
        .map(raw => (typeof raw === 'string' ? resolveExternalWritePath(raw) : String(raw)))
        .join('、');
      setConnectorError(c.name, `需要授权:写外部目录:${displayRoots}`);
      gated.add(c.name);
      continue;
    }

    // 已授予则按实际声明放行
    const allowNetwork = declared.network === true && granted.has('network');

    let extraEnv = cfg.env;

    // npx 启动修正：npx 在 Windows 沙箱内需要显式经 cmd.exe 调用,并补齐用户目录环境变量(N4 最小化实测)
    const commandBase = path.basename(command);
    if (commandBase === 'npx' || commandBase === 'npx.cmd') {
      const npxCmdPath = path.join(path.dirname(process.execPath), 'npx.cmd');
      if (!fs.existsSync(npxCmdPath)) {
        setConnectorError(c.name, '找不到 npx.cmd(Node.js 安装异常)');
        gated.add(c.name);
        continue;
      }
      command = 'cmd.exe';
      args = ['/c', npxCmdPath, ...args];
      extraEnv = {
        ...extraEnv,
        USERPROFILE: process.env.USERPROFILE ?? '',
        APPDATA: process.env.APPDATA ?? '',
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
      };
    }

    try {
      const { exe, argv } = buildWrapperArgv({
        command,
        args,
        policy: 'workspace-write',
        policyOptions: { allowNetwork, extraWriteRoots },
        // ⚠️ cfg.env 必须走 extraEnv 进入 --env-json:MCPClient 的 env 只到外层的
        // 沙箱启动器,内层连接器进程的环境由 --env-json 决定,不透传就会丢。
        extraEnv,
      });
      servers[c.name] = { command: exe, args: argv };
    } catch (err) {
      // 沙箱不可用(二进制缺失/未完成初始化):fail-closed —— 该连接器不启动,
      // 原因进面板;不退回无防护的裸跑,也不影响其他连接器与整体启动。
      setConnectorError(
        c.name,
        `连接器未启动(沙箱不可用): ${summarize(err instanceof Error ? err.message : err)}`,
      );
    }
  }

  // id 固定:本模块是 MCPClient 的唯一归属者。没有 id 时,框架的静态注册表会把
  // "同配置重复初始化"视为内存泄漏直接抛错 —— 一旦某次 buildClient 在创建之后
  // 抛出(泄漏了一个未 disconnect 的实例),后续所有重建都会被这个错误卡死。
  const client = new MCPClient({ id: 'connector-runtime', servers, timeout: 60000 });

  try {
    // 预先连接并列出工具，把失败原因按服务器写入 lastError(统一加中文前缀,面板直接可读)
    const { errors } = await client.listToolsWithErrors();
    for (const [name, reason] of Object.entries(errors)) {
      setConnectorError(name, `连接器启动失败(命令不存在、进程退出或连接超时): ${summarize(reason)}`);
    }
    // 成功连接的服务器清空旧错误,但被门控拦下的连接器不能清错
    const failed = new Set(Object.keys(errors));
    for (const c of connectors) {
      if (!failed.has(c.name) && !gated.has(c.name)) {
        setConnectorError(c.name, null);
      }
    }
  } catch (err) {
    // listToolsWithErrors 抛出时必须丢弃并清理本实例,否则静态注册表里的泄漏
    // 会让下一次 buildClient 直接抛"重复初始化"。
    try {
      await client.disconnect();
    } catch {
      // 清理失败不影响抛出原错误
    }
    throw err;
  }

  return client;
}

/**
 * 把 SDK 的长堆栈错误压缩成一行可读原因(首行,截断到 200 字符)。
 */
function summarize(reason: unknown): string {
  const text = String(reason ?? '').split('\n')[0].trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * 初始化连接器运行时。幂等：可重复调用，会重新构建客户端。
 */
export async function refresh(): Promise<void> {
  mcpClient = await buildClient();
}

/**
 * 获取所有成功连接的 MCP 工具，以 serverName_toolName 命名空间扁平返回。
 * 失败的连接器工具缺失，但不抛异常。
 */
export async function getMcpTools(): Promise<Record<string, any>> {
  if (!mcpClient) {
    mcpClient = await buildClient();
  }
  const { tools, errors } = await mcpClient.listToolsWithErrors();
  // 实时把错误同步回注册表
  for (const [name, reason] of Object.entries(errors)) {
    setConnectorError(name, `连接器启动失败(命令不存在、进程退出或连接超时): ${summarize(reason)}`);
  }
  return tools;
}

/**
 * 进程退出时清理所有 MCP 子进程。
 */
export async function disconnect(): Promise<void> {
  if (!mcpClient) return;
  try {
    await mcpClient.disconnect();
  } catch {
    // 退出阶段忽略清理错误
  } finally {
    mcpClient = null;
  }
}

// 后端进程退出时自动清理子进程
function bindExitHandlers(): void {
  const cleanup = () => {
    void disconnect();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
bindExitHandlers();
