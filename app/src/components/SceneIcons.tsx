// 首页快捷场景 chip 的手绘风格图标(替代原生 emoji 📄📊👥🎨🔍💬)。
// 风格:手绘线稿感——描边不用规整的几何图元(perfect circle/rect),
// 改用带轻微不对称的贝塞尔路径模拟笔触;圆头线帽(round cap/join)、
// 统一描边宽度,配色沿用每个分类原有的浅色徽章底 + 深色墨线。
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

/** 文档创作:一张带折角的纸 + 几笔手写波浪线代表文字 */
export function DocIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...props}>
      <path {...STROKE} d="M5.8 2.6c-.3 0-.6.3-.6.7v13.3c0 .4.3.7.6.7h8.3c.4 0 .7-.3.7-.7V7.1c0-.2-.1-.4-.2-.5L11.2 2.8a.9.9 0 0 0-.6-.2z" />
      <path {...STROKE} d="M11 2.7v3.8c0 .3.3.6.6.6h3.7" />
      <path {...STROKE} d="M7.3 10.4c1.6-.3 3.6-.3 5.2 0" />
      <path {...STROKE} d="M7.3 12.9c1.3-.2 2.7-.2 4 0" />
      <path {...STROKE} d="M7.3 15.3c.9-.1 1.9-.1 2.7 0" />
    </svg>
  );
}

/** 数据分析:三根高低不齐的手绘柱子 + 一段趋势弧线 */
export function ChartIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...props}>
      <path {...STROKE} d="M2.8 17.2c4.6.3 9.9.3 14.4 0" />
      <path {...STROKE} d="M5.4 17V11c0-.3.3-.6.6-.5l1.7.1c.3 0 .5.3.5.6v5.7" />
      <path {...STROKE} d="M9.6 17V6.4c0-.3.3-.6.6-.5l1.7.1c.3 0 .5.3.5.6V17" />
      <path {...STROKE} d="M13.8 17v-8c0-.3.3-.6.6-.5l1.6.1c.3 0 .5.3.5.6V17" />
      <path {...STROKE} d="M4.7 8.3c2.8-2.6 6-4.3 10.6-4.8" strokeDasharray="0.2 2.6" />
      <path {...STROKE} d="M12.4 3.2l2.9.2.3 2.8" />
    </svg>
  );
}

/** 多人工作台:两个略微交叠的手绘人头轮廓,像随手画的两个圈 */
export function TeamIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...props}>
      <path {...STROKE} d="M7.2 9.3c-1.9 0-3.1-1.5-3-3.4.1-1.7 1.4-2.9 3-2.9 1.7 0 3 1.3 3 3.1 0 1.9-1.2 3.2-3 3.2z" />
      <path {...STROKE} d="M2.6 16.8c0-3 1.7-5.1 4.6-5.1 2.8 0 4.5 2.1 4.6 5.1" />
      <path {...STROKE} d="M12.9 4.3c1.4.1 2.4 1.3 2.4 2.8 0 1.5-1 2.7-2.3 2.8" />
      <path {...STROKE} d="M13.4 11.9c2.4.2 3.9 2.1 4 4.8" />
    </svg>
  );
}

/** 创意设计:一枝手绘小花(花瓣不完全对称)+ 一颗点缀星 */
export function PaletteIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...props}>
      <path {...STROKE} d="M10 9.8c0-1.4 1-2.4 2.3-2.3 1.2.1 1.9 1.1 1.7 2.3-.2 1.3-1.4 2-2.6 1.8" />
      <path {...STROKE} d="M10 9.8c0-1.4-1-2.4-2.3-2.2-1.2.1-1.9 1.1-1.7 2.3.2 1.3 1.4 2 2.6 1.8" />
      <path {...STROKE} d="M10 9.6c1-.9 2.4-1 3.3-.1.9.9.9 2.3-.1 3.2-1.1 1-2.5.8-3.2-.2" />
      <path {...STROKE} d="M10 9.6c-1-.9-2.4-1-3.3-.1-.9.9-.9 2.3.1 3.2 1.1 1 2.5.8 3.2-.2" />
      <path {...STROKE} d="M10.1 9.8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
      <path {...STROKE} d="M9.9 12.9c-.2 1.9-.5 3.3-1.1 4.4" />
      <path {...STROKE} d="M15.6 3.6l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3z" />
    </svg>
  );
}

/** 深度调研:放大镜(镜圈不完全圆) + 镜下几道被放大的波浪线 */
export function SearchIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...props}>
      <path {...STROKE} d="M9.1 3.4c3.2 0 5.6 2.5 5.5 5.6-.1 3-2.5 5.3-5.6 5.2-3-.1-5.3-2.5-5.2-5.6.1-2.9 2.3-5.2 5.3-5.2z" />
      <path {...STROKE} d="M13.4 13.1l3.6 3.5" />
      <path {...STROKE} d="M6.6 7.7c1.7-.9 3.5-.9 4.9.1" />
      <path {...STROKE} d="M6.4 10.4c1.6.6 3.1.6 4.6 0" />
    </svg>
  );
}

/** 日常助手:一个手绘对话气泡 + 三个跳动的小点 */
export function ChatIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" {...props}>
      <path
        {...STROKE}
        d="M10 3.2c4 0 6.8 2.5 6.8 5.9 0 3.3-2.9 5.8-6.7 5.9-.9 0-1.8-.1-2.6-.4l-3 1.3.7-2.8c-1.6-1.1-2.6-2.7-2.6-4.5C2.6 6 5.7 3.2 10 3.2z"
      />
      <path {...STROKE} d="M6.9 9c.1-.4.6-.4.7 0" />
      <path {...STROKE} d="M9.7 9c.1-.4.6-.4.7 0" />
      <path {...STROKE} d="M12.5 9c.1-.4.6-.4.7 0" />
    </svg>
  );
}
