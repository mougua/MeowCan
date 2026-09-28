# MeowCan 游玩微卡顿排查假设与优化探索方案（Antigravity / agy）

> 作者：Antigravity (agy)  
> 评审与实证校准：Codex  
> 日期：2026 年 9 月 28 日  
> 状态：待测假设与工程探索（尚未在目标设备上完成浏览器 Profile 实测）  
> 范围：桌面端与移动端/平板的音视频时钟同步、Pixi.js v8 渲染热路径、WebAudio 主线程调度

---

## 一、 核心结论与研究范围

针对用户反馈的“玩的时候音符下落感觉时不时卡一下”，本文从时钟同步、PixiJS 渲染循环与音频调度三方面梳理出可能的怀疑方向。

**严正声明（基于 Codex 审阅意见修正）**：
- 本文提出的所有分析均为**待测假设（Hypotheses to be verified）**，绝不作为已证实的“确定性根因”或“根治定论”。
- 撤回此前关于“解决 80%”、“致命缺陷”、“GC 10-30ms 停顿”、“WebGL 方差必然更低”等缺乏设备实测数据的量化判断。
- 所有方案的有效性必须遵循严格的实证原则：在固定硬件设备、固定谱面与浏览器环境下，通过 Chrome Performance Profiler 抓取 Trace，对比帧间隔（p95/p99）及丢帧率后方可得出结论。

---

## 二、 关键假设与技术核对

### 假设 1：`VisualClock` 4ms 钳位可能在特定时钟抖动下引入微顿挫

#### 源码现状
[`web/src/game/visual-clock.ts`](file:///C:/Program%20Files%20%28x86%29/HanseulSoft/MeowCan/web/src/game/visual-clock.ts#L9-L39)：
```typescript
private static readonly MAX_AUDIO_ERROR_SEC = 0.004; // 4 毫秒
...
this.time += elapsed;
const error = audioTime - this.time;
const alpha = 1 - Math.exp(-elapsed / VisualClock.CORRECTION_TIME_CONSTANT_SEC);
this.time += error * alpha;
this.time = Math.max(audioTime - VisualClock.MAX_AUDIO_ERROR_SEC,
  Math.min(audioTime + VisualClock.MAX_AUDIO_ERROR_SEC, this.time));
```

#### 概念澄清与仿真核对（关键纠正与数据边界）
1. **音频时钟步长规范**：
   - 依据 W3C 与 MDN 规范，`AudioContext.currentTime` 的更新基于 Web Audio 的 **render quantum**，通常固定为 128 采样点（在 48kHz 下约为 $2.67\text{ms}$）。
   - **不能将底层声卡驱动的输出缓冲（如 Windows WASAPI 常见的 512 采样点/10.7ms）直接等同于 `currentTime` 的更新步进**。
2. **反事实时钟模拟测试与数据适用边界（Codex 仿真）**：
   - 在 128/48000s（2.67ms）标准步进下，现有 `VisualClock` 在 60/120/144Hz 下连续运行 1000 帧，**均未触发 4ms 钳位**。这表明在规范理想步进下，4ms 限制并不必然导致卡顿。
   - 在 Codex 进行的反事实压力测试中（**特定条件：144Hz 刷新率、512/48000s 步长**），1000 帧内记录到 255 次 4ms 钳位。**此项数据仅代表该特定反事实步长与 144Hz 条件下的模拟结果，不能泛化到所有刷新率（如 60Hz、120Hz 下行为不同），更不代表目标设备的真实表现**。
3. **排查与实测基线（见第五节样本 001）**：
   - 现已接入首个设备实测样本（本机安卓模拟器 `com.mx.browser` WebView CDP 采样），实测显示在 512 采样点步长特征下确实存在高达 63.7% 的 4ms 钳位触碰率，并产生了非均匀视觉位移；
   - **严格约束**：该数据仅代表该模拟器特定环境样本，不得泛化至物理真机或桌面浏览器（详见第五节实测记录）。

---

### 假设 2：Pixi.js v8 渲染循环中 Sprite 属性更新与池复用开销

#### 源码现状
[`web/src/game/renderer.ts`](file:///C:/Program%20Files%20%28x86%29/HanseulSoft/MeowCan/web/src/game/renderer.ts#L1437-L1482)：
```typescript
body.fill.position.set(laneCenterX - 12, bodyTopY);
body.fill.width = 24;
body.fill.height = bodyHeight;

spr.visible = true;
spr.alpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : 1;
spr.texture = note.isLong ? ... : ...;
spr.anchor.set(note.isLong ? 0.5 : noteMeta.contactX / noteW, note.isLong ? 1 : noteMeta.contactY / noteH);
spr.width = note.isLong ? 24 : noteW;
spr.height = note.isLong ? 12 : noteH;
spr.position.set(laneCenterX, yPos);
```

#### 本地 Pixi.js 8.20.1 源码核对与更正
1. **撤回“每帧必破坏 Transform 缓存”的过强表述**：
   - 经核对源码，`ObservablePoint.set()`（控制 position、scale、anchor）在传入新旧值相同时会直接 `return`，不会通知 dirty；
   - `Sprite.texture` setter 在纹理引用不变时也会直接 `return`。
   - 只有在短音符与长音符头部交替复用同一 Sprite 实例时，才会触发真实的属性变化。
2. **Width/Height Setter 的除法开销**：
   - `Sprite.prototype.width` 的 setter 会调用 `_setWidth(val, texture.orig.width)`，内部包含除法和对 `scale.x` 的计算。
3. **代码边界严谨性修正（纠正前版漏洞）**：
   - **长音符身体缩放**：不能直接假定源纹理高为 1px 写死 `scale.set(1, bodyHeight)`。必须基于实际纹理高度进行计算，或保持像素尺寸赋值：
     ```typescript
     const texH = body.fill.texture.orig?.height || 1;
     body.fill.scale.set(1, bodyHeight / texH);
     ```
   - **复用时的尺寸恢复**：短音符与长音符在同一个池混用时，必须确保从长音符复用回短音符时完整重设了宽、高与锚点，否则会出现材质拉伸变形。

---

### 假设 3：主线程 WebAudio 频繁对象创建带来的 GC 压力

#### 源码现状
[`web/src/audio/synth.ts`](file:///C:/Program%20Files%20%28x86%29/HanseulSoft/MeowCan/web/src/audio/synth.ts#L301-L417)：
- 默认音源偏好为 `procedural`（模拟合成）。
- `scheduleBgm()` 由 `setInterval` 每 30ms 触发一次，前瞻扫描未来 120ms。
- 密集段落中会持续创建短期 `OscillatorNode`、`GainNode` 及 `onended` 闭包。

#### 排查边界
- 垃圾回收（GC）是否恰好覆盖卡顿发生的帧，必须依赖 Chrome DevTools Performance 面板中的 GC 活动条与 Long Tasks 进行对照。
- 在获得 Trace 证明 GC 确实导致了丢帧之前，将 GC 停顿直接断定为“10~30ms”是不严谨的。
- 架构上使用基于 `AudioWorklet` 的 SoundFont（工作线程合成）理论上能减少主线程对象创建，但是否能改善卡顿，需做同设备 A/B 测试。

---

### 假设 4：图形后端（WebGPU vs WebGL）在具体设备上的差异

- PixiJS v8 支持 WebGPU 与 WebGL 双后端，本项目默认配置为 `webgpu`。
- 不能直接定论“WebGL 方差必然优于 WebGPU”。由于不同操作系统与 GPU 驱动（如 Intel 核显、Nvidia 独显、节能策略）存在显著差异，两者的性能表现必须以同台设备同谱面的录制数据为准。

---

## 三、 审慎的探索性代码改进（待验证原型及风险提示）

### 1. VisualClock 速率微调试验（若实测证实 4ms 发生频繁截断）

如果在基线数据中观测到 4ms 钳位频繁触发且视觉推进呈现锯齿，可进行如下平滑试验：

```typescript
// web/src/game/visual-clock.ts
export class VisualClock {
  private time = 0;
  private lastFrameMs: number | null = null;
  // 以下常数仅为试验初始值，需由实际 trace 数据校准
  private static readonly HARD_RESYNC_THRESHOLD_SEC = 0.080;
  private static readonly MAX_STEER_RATE = 0.02;

  public reset(): void {
    this.lastFrameMs = null;
  }

  public sample(audioTime: number, frameMs: number): number {
    if (this.lastFrameMs === null || !Number.isFinite(audioTime)) {
      this.time = audioTime;
      this.lastFrameMs = frameMs;
      return this.time;
    }

    const elapsed = Math.max(0, Math.min(0.1, (frameMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = frameMs;

    this.time += elapsed;
    const error = audioTime - this.time;

    if (Math.abs(error) > VisualClock.HARD_RESYNC_THRESHOLD_SEC || elapsed >= 0.1) {
      this.time = audioTime;
    } else {
      const steerFactor = Math.max(-VisualClock.MAX_STEER_RATE, Math.min(VisualClock.MAX_STEER_RATE, error * 0.5));
      this.time += elapsed * steerFactor;
    }

    return this.time;
  }
}
```

> [!WARNING] **原型关键风险与参数约束提示（来自 Codex 评审的重要提醒）**
> 1. **与判定窗口的冲突风险**：
>    判定引擎严格以音频时间为基准，现代音游及本项目模式中 `COOL` 判定窗口典型为 $\pm 45\text{ms}$。如果视觉时钟允许达到 **80ms 的硬重同步阈值**，当视觉时间漂移超过 45ms 时，音符在屏幕上尚未触碰或已完全穿过判定线，但玩家按键却在音频时间上被判定为 COOL 或 MISS，造成严重的**视觉击打点与物理判定线脱节**！硬同步阈值必须严格受控（建议在实测中限制在 $\le 20\text{ms} \sim 30\text{ms}$ 内）。
> 2. **追赶耗时与音画位移误差**：
>    在 `MAX_STEER_RATE = 0.02`（最大 2% 速率追赶）下，每秒仅能纠正约 20ms 的时钟偏差。若由于主线程轻微卡顿积累了 **40ms 偏差，需要长达约 2 秒钟才能完全对齐**！在高速滚动下（如 1000 px/s），这 2 秒内音符与实际判定线会持续存在数十像素的肉眼可见物理偏差。必须在目标设备上实测并权衡追赶速率与可见音符偏差。

---

### 2. 渲染热循环守卫改造（兼顾尺寸严谨性）

```typescript
// 针对长音符身体：严谨考虑源纹理高度
body.fill.visible = true;
const targetBodyTex = this.texLongBodies[laneColors[note.lane]] ?? Texture.WHITE;
if (body.fill.texture !== targetBodyTex) body.fill.texture = targetBodyTex;
body.fill.alpha = stateAlpha;
body.fill.position.set(laneCenterX - 12, bodyTopY);

const origH = body.fill.texture.orig?.height || 1;
body.fill.scale.set(1, bodyHeight / origH);

// 针对音符头部：区分长短音符并确保尺寸在切换时正确还原
spr.visible = true;
spr.alpha = note.holdBroken || note.hitScore === 'MISS' ? .3 : 1;
const isLongHead = note.isLong;
const targetHeadTex = isLongHead
  ? (this.texLongHeads[laneColors[note.lane]] ?? this.texNoteSkins[laneColors[note.lane]])
  : this.texNoteSkins[laneColors[note.lane]];
if (spr.texture !== targetHeadTex) spr.texture = targetHeadTex;

const expectedAnchorX = isLongHead ? 0.5 : noteMeta.contactX / noteW;
const expectedAnchorY = isLongHead ? 1.0 : noteMeta.contactY / noteH;
if (spr.anchor.x !== expectedAnchorX || spr.anchor.y !== expectedAnchorY) {
  spr.anchor.set(expectedAnchorX, expectedAnchorY);
}
// 始终确保目标像素尺寸准确，避免池复用时尺寸脏污
spr.width = isLongHead ? 24 : noteW;
spr.height = isLongHead ? 12 : noteH;
spr.position.set(laneCenterX, yPos);
```

---

## 四、 跨方案对照与后续排查原则

| 关注维度 | Codex 方案视角 (`pixijs-stutter-plan-codex.md`) | Antigravity 探索方案 (`pixijs-stutter-plan-agy.md`) | 协同执行原则 |
| :--- | :--- | :--- | :--- |
| **时钟机制** | 强调 128 量子下不易触发钳位，需先采集真实步长与钳位计数 | 提出速率微调模型，并明确标注与判定窗口（$\pm 45\text{ms}$）及追赶耗时的潜在风险 | **先测后改**：先在诊断探针中统计钳位触发频次，确认有影响再上算法，且硬同步阈值需 $\le 20\text{ms}$ |
| **渲染开销** | 重点关注密集谱面对象池扩容与纹理上传 | 分析 Setter 内部计算与复用时的边界保护 | **严防失真**：确保池扩容充分，且任何尺寸重构必须核对多皮肤下的尺寸等价性 |
| **音频调度** | 关注调度前瞻窗口内突发事件数 | 关注主线程 AudioNode 生命周期对 GC 的潜在压力 | **Trace 对照**：录制 DevTools 查看卡顿帧是否与 `scheduleBgm` 或 GC 条重合 |
| **总体态度** | 坚持基线对照与实测数据，不轻下定论 | 深入算法与底层逻辑推导可能故障点 | **共同坚持数据负责制**：没有实测 Trace 数据前，所有方案均标为待验证 |
