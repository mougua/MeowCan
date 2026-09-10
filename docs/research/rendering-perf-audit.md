# MeowCan Web 渲染技术栈与优化空间审计

> 审计对象：`web/` 前端工程
> 审计方式：静态代码分析（阅读项目源码与 `pixi.js` 8.20.1 自带实现）
> 审计范围：渲染管线、逐帧绘制开销、时钟与主循环
> 当前状态：仅结论存档，未修改任何源码

本文回答两个问题：项目现在用什么渲染技术；这些路径上还剩多少优化空间。所有结论附 `文件:行` 出处，便于后续按条实施。

---

## 一、结论摘要

渲染层由 **Pixi.js v8.20.1** 负责，实际跑在 **WebGL2** 后端，尚未启用 WebGPU。

代码结构是健康的：分层容器清晰、音符对象池齐备、时间基准取自音频硬件时钟。可优化点集中在三处。

1. **主循环存在双 `requestAnimationFrame` 竞态**，导致画面固定滞后一帧，这是最有价值的一条。
2. **若干 `Graphics` 每帧 `clear()` 重绘**，以及静态层未缓存，属于纯浪费。
3. **资产与文本管线**缺少图集与位图字体，另有 5 个未使用或加载后未启用的资源。

其中第一项影响输入延迟，属于音游最敏感的指标，建议优先处理。

---

## 二、渲染技术栈现状

### 2.1 渲染后端与构建

- 渲染库：`pixi.js` 8.20.1（`web/package.json`）。
- 实际后端：**WebGL2**。`Application.init()` 未传 `preference`，而 Pixi 默认优先级为 `["webgl", "webgpu", "canvas"]`，见 `node_modules/pixi.js/lib/rendering/renderers/autoDetectRenderer.mjs:7`。因此 **WebGPU 路径当前不会生效**。
- 构建：Vite 8.2.2，`build.target: es2022`（`web/vite.config.ts`）。
- 初始化参数：`width: 800`、`height: 600`、`resolution: devicePixelRatio`、`autoDensity: true`、`antialias: true`（`web/src/game/renderer.ts:112`～`:119`）。

### 2.2 场景组织

场景按**原版 716×516 坐标空间**布局，再整体缩放到 800×600 视口（`web/src/game/renderer.ts:125`）。

场景图分 8 层容器：`bgLayer`、`playAreaContainer`（内含 `laneLayer`、`noteLayer`、`hitEffectLayer`）、`canFrameLayer`、`pdaLayer`、`uiLayer`。

播放区使用 `Container.mask` 裁剪（`web/src/game/renderer.ts:194`～`:196`），Pixi v8 下走 stencil 实现。

### 2.3 资源与复用

- 资源经 `Assets.load` 加载 PNG（`web/src/game/renderer.ts:140`～`:175`）。
- 精灵表在运行时手工切片：`note_skin0.png`（416×24）切 16 帧、`hitani0_0.png`（800×118）切 10 帧、`combo.png`（520×70）切 10 帧，均通过 `new Texture({ source, frame })` 构造子纹理。
- 对象池三套：`noteSpritePool`、`longNoteTailPool`、`longNoteBodyPool`（`web/src/game/renderer.ts:45`～`:47`），池内实例跨帧复用，未使用项置 `visible = false`。
- 长按躯干用 `Graphics` 逐帧绘制，尾部用音符皮肤精灵。

### 2.4 主循环与时钟

- 音符位置由 `AudioContext.currentTime` 驱动（`web/src/main.ts:398`），符合音游对时钟权威性的要求，这一设计正确。
- 渲染循环由 `web/src/main.ts` 自建 `requestAnimationFrame` 驱动（`web/src/main.ts:83`、`:446`），该回调只更新场景属性，不触发渲染。
- 同时，Pixi 的 `TickerPlugin` 默认 `autoStart: true`，在 `app.init()` 期间把 `app.render` 注册进 `Ticker`（`node_modules/pixi.js/lib/app/TickerPlugin.mjs:14`、`:28`），由另一条 `requestAnimationFrame` 负责实际绘制。

---

## 三、优化空间

### 3.1 架构级问题

**（1）双 rAF 循环导致画面固定滞后一帧**

两条 `requestAnimationFrame` 循环并存：Pixi `Ticker` 负责渲染，`main.ts` 的 `gameLoop` 负责更新状态。Pixi 的循环先注册，因此稳定顺序为「Ticker 先渲染 → `gameLoop` 后更新」。结果屏幕上显示的是上一帧的状态，凭空增加约 8 ms～16 ms 显示延迟。

音游对输入延迟最敏感，这条应优先修复。两种方向。

- 统一到 Pixi：`app.init({ autoStart: false })`，把 `gameLoop` 挂到 `app.ticker.add()`，由 `Ticker` 同时驱动更新与渲染。代价是逻辑帧率受 `Ticker` 上限约束。
- 保留自建循环：`app.init({ autoStart: false })`，在 `gameLoop` 末尾显式调用 `app.render()`。控制更直接。

**（2）音符遍历并非注释所称的 O(1)**

`renderer.ts:591` 从 `playableNotes[0]` 开始遍历，靠 `yPos < -80` 时 `break` 提前退出。但已判定或已过期的音符只走 `continue`（`web/src/game/renderer.ts:595`），循环游标仍从数组头重新开始。

因此每帧实际扫描的是「已播放音符数 + 屏幕内音符数」，随曲目推进单调增长。一首上千音符的曲子，后半段每帧会白扫上千次。

修法是维护一个「首个未过期索引」游标，随时间单调推进，把循环起点挪到该游标。

**（3）非等比缩放导致画面纵向拉伸**

`rootContainer.scale` 取值为 `800/716 = 1.117` 与 `600/516 = 1.163`（`web/src/game/renderer.ts:125`）。纵向比横向多拉伸约 4%，圆形会变成椭圆，文字被拉高。

等比缩放（取值 `1.117`，另配 letterbox 黑边或补边）才能保住所引资源与场景坐标的原始比例。此项会改变观感，属取舍项。

**（4）`antialias: true` 对点阵美术资源是负收益**

美术资源源自原版 16 位 `vimg` 图片。开启抗锯齿会让像素边缘糊化，丢失原版的硬边锐利感。同时 `resolution: devicePixelRatio` 已把像素量放大 4 倍～9 倍，叠上 MSAA 会进一步抬高填充率成本。

此项同样会改变观感，属取舍项。

### 3.2 逐帧绘制开销

**（1）长按躯干每帧重建 `Graphics`**

`web/src/game/renderer.ts:632`～`:640` 对每个可见长音符执行 `clear()` 后重新 `rect`、`fill`、`stroke`。躯干本质是纯色矩形，却每帧重跑几何构建与描边三角剖分，而 `stroke` 在 Pixi v8 中相对昂贵。

改用精灵方案即可把成本降到近零：用 1×1 白纹理做 `Sprite`，通过 `width` / `height` / `tint` 表现矩形与颜色；描边用两层精灵模拟。

**（2）生命槽每帧重绘**

`renderLifeBar` 每帧 `clear()` 后重画一次填充与描边（`web/src/game/renderer.ts:504`～`:525`），调用点 `web/src/game/renderer.ts:539` 无条件下发。

只有 `life` 数值变化时才需要重绘，加一个脏标记即可省掉绝大部分重绘。

**（3）静态层未缓存**

背景、`can` 边框、判定条、轨道分割线全部静止，却每帧参与遍历与批处理。可用 Pixi v8 的 `cacheAsTexture()` 把 `bgLayer` 等静态层烘焙为单张纹理。

**（4）缺少纹理图集，draw call 偏多**

`bg`、`play_area`、`can`、`hitbar`、3 张精灵表各自是独立纹理源。Pixi 逐帧批处理时，切换纹理源会打断当前批次并新增一次绘制调用。打包为一张图集（atlas）可显著减少调用数。

**（5）`mask` 走 stencil**

播放区遮罩用 `Container.mask` 实现（`web/src/game/renderer.ts:194`～`:196`），会打断批处理并引入模板缓冲操作。此处遮罩是静态矩形，存在更廉价的替代方案。

### 3.3 文本渲染

- PDA 面板、判定文字、COMBO 标签全部使用系统字体 `Text`，字体族为 `system-ui`、`Impact`、`Courier New`。`Impact` 在 Linux 与部分 Windows 上缺失会静默回退，导致跨机器 UI 不一致。
- Pixi v8 的 `AbstractText` 带脏检查（`node_modules/pixi.js/lib/scene/text/AbstractText.mjs:97`）：文本内容不变时不会重绘。因此 `renderFrame` 每帧赋值文本（`web/src/game/renderer.ts:537`～`:545`）的实际损失有限，仅在内容真正变化时才付出 canvas 2D 测量与纹理上传成本。
- 结论：此项的收益主要来自**排版一致性**，性能收益属次要。改用 `BitmapText` 可一并解决，项目内已有未被引用的 `number.png` 资源可作数字图集基础。

### 3.4 其他

- **未设帧率上限**：音符位置由音频时钟驱动，物理上正确，但 144 Hz 屏幕会每秒重绘 144 次。可按需设置 `Ticker.maxFPS`。
- **未启用 `CullerPlugin`**：Pixi v8 自带视锥裁剪插件，当前依赖手写裁剪逻辑。
- **死资源与加载后未启用的资源**：`number.png`、`hitbar1.png`、`key_normal.png`、`clock.png` 在 `src/` 与 `index.html` 中均无引用；`longnote.png` 被加载进 `texLongNote`（`web/src/game/renderer.ts:35`、`:145`）但此后从未使用，属于每局固定多出的一次网络请求与纹理上传。

---

## 四、优化项优先级清单

| 编号 | 优化项 | 影响 | 是否改变观感 | 优先级 |
| :--- | :--- | :--- | :--- | :--- |
| 3.1-1 | 统一帧循环，消除一帧延迟 | 输入延迟 | 否 | 高 |
| 3.1-2 | 音符遍历改用游标 | 每帧 CPU | 否 | 高 |
| 3.2-1 | 长按躯干改精灵 | 每帧 GPU 几何 | 否 | 高 |
| 3.2-2 | 生命槽加脏标记 | 每帧 GPU 几何 | 否 | 中 |
| 3.2-3 | 静态层 `cacheAsTexture` | 每帧批处理 | 否 | 中 |
| 3.4 | 清理死资源与未启用资源 | 首屏与每局请求 | 否 | 中 |
| 3.2-4 | 引入纹理图集 | draw call | 否 | 中 |
| 3.3 | 文本改 `BitmapText` | 排版一致性 | 是（字体） | 低 |
| 3.2-5 | 替换 stencil 遮罩 | 批处理 | 谨慎评估 | 低 |
| 3.1-3 | 等比缩放 | 画面比例 | 是（比例） | 待定 |
| 3.1-4 | 关闭 `antialias` | 边缘锐利度 | 是（锐利度） | 待定 |
| 3.4 | 帧率上限 / `CullerPlugin` | 高刷屏功耗 | 否 | 低 |

「是否改变观感」为「否」的条目可安全批量实施；标注为「是」的条目需先确认取舍。

---

## 五、尚未验证的事项

以下内容本次**未做验证**，需实测补充。

1. **未做运行时性能剖析**。本文所有开销判断来自代码路径与 Pixi 内部行为分析，未采集 `Performance` 面板火焰图或 GPU 计时数据。哪些条目真正构成瓶颈，应以实测为准。
2. **未做端到端延迟测量**。3.1-1 的一帧延迟为时序推理结论，建议用高速摄影对照 `AudioContext.currentTime` 实测确认。
3. **未在目标设备上验证后端**。建议运行时打印 `app.renderer.type`，确认实际落在 WebGL2，再决定是否评估 WebGPU 路径。

推荐的测量入口：浏览器 `Performance` 面板录制 10 秒对局，观察 `Scripting` 与 `Rendering` 占比；用 `app.renderer.name` 与 `renderer.gl.getParameter` 侧信道确认后端与批量次数。
