# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-31
- Primary product surfaces: Stem Studio 桌面端首页、任务历史、分离工作台、设置与许可。
- Evidence reviewed: `src/index.html`, `src/styles.css`, `src/renderer.js`, `assets/screenshot.png`, `README.md`；用户反馈当前深色简约方案不符合预期。

## Brand
- Personality: 有人味的录音室工具，可靠而不冷漠；帮助非技术用户完成本地音频分离。
- Trust signals: 本地处理、清晰的引擎状态、明确的下载/组件说明、可恢复的任务状态。
- Avoid: 霓虹赛博、通用 AI 仪表盘感、过量深色卡片、重复的口号与主按钮、将高级设置暴露在首次路径中。

## Product goals
- Goals: 让首次用户在一个屏幕内完成“选文件 → 采用推荐设置 → 开始分离”；让专业用户仍能发现模式、格式、性能和导出位置。
- Non-goals: 不将桌面工具伪装成复杂的 DAW，不增加账户、云端或社交功能。
- Success signals: 首屏只有一个明显的下一步；默认配置可被理解；复杂选项不干扰首次操作。

## Personas and jobs
- Primary personas: 零基础的音频处理用户，以及需要批量分离/导出格式控制的创作者。
- User jobs: 从本地音频中分离声部；查看进度与结果；在工作台试听并导出混音。
- Key contexts of use: macOS/Windows 桌面窗口、深色环境、文件拖入与键盘操作。

## Information architecture
- Primary navigation: 首页分离流程 → 完成后的工作台；任务历史、设置、许可作为折叠的辅助区域。
- Core routes/screens: 选择文件与分离、进度/任务队列、工作台混音、设置。
- Content hierarchy: 文件选择优先；推荐四轨为默认；高级选项按需展开；状态和帮助紧邻相关操作。

## Design principles
- 一个主操作: 每个状态只突出最合适的下一步，其他操作降级为次级按钮或折叠内容。
- 默认即答案: 用“标准四轨、均衡、WAV、源文件同目录”作为清晰默认值。
- 有材质感但不装饰: 以纸张般的浅底、细分隔线、录音室蓝色控制点与留白建立层级，不使用大面积阴影或霓虹色。
- Tradeoffs: 保留现有功能和文本说明；不会为极简而隐藏错误、许可或高级控制。

## Visual language
- Color: 温暖的浅灰纸张底色；墨黑文字；钴蓝作为唯一操作色；鼠尾草绿与砖红仅表示成功与错误。
- Typography: 系统字体；大标题偏编辑排版，正文清晰紧凑；数字/状态采用等宽数字特征。
- Spacing/layout rhythm: 8px 基础节奏，主内容宽度约 960px；首屏采用标题区与工作区的明确分区。
- Shape/radius/elevation: 6–12px 圆角；卡片如控制台面板，使用细线和轻微阴影，避免悬浮胶囊泛滥。
- Motion: 仅短促的 hover/focus 反馈；尊重系统减少动态设置。
- Imagery/iconography: 复用现有应用图标；以编号、控制点和文本建立录音室秩序，不新增装饰插图。

## Components
- Existing components to reuse: 文件列表、模式 radio、折叠高级选项、任务行、进度条、设置 disclosure、工作台音轨行。
- New/changed components: 编号化的分离任务面板、纸张式文件投放区、录音室控制条、紧凑的模式选择组、低噪声设置折叠区。
- Variants and states: 主按钮为钴蓝；次按钮为纸面灰；禁用、运行、完成和错误状态保持明确的语义色。
- Token/component ownership: 颜色、圆角、间距集中在 `src/styles.css` 的根变量和现有类中。

## Accessibility
- Target standard: WCAG 2.1 AA 的可读性与键盘可操作性。
- Keyboard/focus behavior: 保留原有按钮、radio、summary 语义与明显的 focus-visible 轮廓。
- Contrast/readability: 辅助文字不低于可读灰阶；主操作与背景保持高对比。
- Screen-reader semantics: 不替换原生按钮、label、radio 与 details/summary。
- Reduced motion and sensory considerations: hover 动效短且可在 `prefers-reduced-motion` 下关闭。

## Responsive behavior
- Supported breakpoints/devices: 桌面优先；窄窗口（≤620px）堆叠模式与选项。
- Layout adaptations: 模式双列变单列；操作按钮换行；长文件名截断不溢出。
- Touch/hover differences: 触控环境不依赖 hover 才能发现操作。

## Interaction states
- Loading: 引擎检测、模型下载和工作台加载用简短状态文本与现有进度条。
- Empty: 文件区本身是投放区，明确“拖入或选择文件”。
- Error: 沿用现有中文错误文案和红色状态。
- Success: 沿用完成 chip、打开文件夹和进入工作台入口。
- Disabled: 主操作在无文件或运行中不可用，并保持语义状态。
- Offline/slow network: 模型/媒体组件继续显示下载与可恢复错误信息。

## Content voice
- Tone: 直接、克制、解释必要原因，不使用营销式夸张表达。
- Terminology: 统一使用“分离”“音轨”“媒体组件”“工作台”。
- Microcopy rules: 操作按钮用动词；说明文本只说当前决策所需的信息。

## Implementation constraints
- Framework/styling system: 原生 HTML/CSS/JS Electron；不新增前端依赖。
- Design-token constraints: 扩展现有 CSS 变量；新界面以钴蓝为操作强调色，不再使用黄绿色作为常规主操作色。
- Performance constraints: 不增加外部字体、图片或运行时网络请求。
- Compatibility constraints: 保持 macOS/Windows 和当前 CSP；不改动 renderer 依赖的元素 ID/语义。
- Test/screenshot expectations: `npm run lint && npm test`；打包后进行桌面界面冒烟检查。

## Open questions
- [ ] 后续是否需要为 Windows 窄窗口单独调整默认高度与缩放？owner: 产品；impact: 中。
