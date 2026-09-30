# 前端流畅度与大音源性能排查记录（2026-09）

> 排查对象：`web/` 前端，重点是加载大体积 SF2 音源（TyrolandGS，893 MB）后的卡顿。
> 验证环境：本机 Chrome（RTX 4090，60 Hz）与 MuMu 安卓模拟器（Maxthon 浏览器，Android WebView / Chrome 110，DPR 2.25，4 核 x86）。
> 当前状态：第一批修复及代码复核已完成。`bun test`（146 项）和 `bun run build` 均通过。

本文记录这次排查的测量方法、结论、已做的修改和待跟进事项。每条结论都注明了依据是实测还是读代码。

---

## 一、结论摘要

1. **主线程不是瓶颈。** 对局期间主线程 CPU 约 95% 空闲，没有长任务（>50 ms）。在本机 Chrome 上把 CPU 降速 6 倍，JS 函数的占比依然很低。
2. **皮肤与性能无关。** 模拟器上经典和金属皮肤各跑 2 局（每局 10 秒），帧率都在 59 到 60 fps，偶发的单帧 33 ms 在两种皮肤下都会出现。“切到金属皮肤就卡”属于偶发现象，不是皮肤造成的。
3. **大音源的内存开销很高。** 旧的流式读取同时保留数据分块和完整拷贝。切换音源时，旧 worklet 与新文件缓冲区也会短暂共存。模拟器上 WebView 渲染进程约占 1.2 GB（总内存 4 GB）。内存压力可能引发停顿，但尚无测量数据能将一次掉帧归因于 GC。
4. **视觉时钟会因时间戳尖峰而抖动。** 实测发现 `getOutputTimestamp()` 偶尔有一帧超前 30 到 65 ms，下一帧又回落。旧的视觉时钟会硬对齐到这个值，音符看起来会前后跳一下，这就是“下落不均匀”的一个来源。
5. **模拟器本身会降频。** 第一次测到 20 fps 时，连一个空的 `requestAnimationFrame` 循环也只有 30 fps。重载页面后恢复 60 fps。所以在模拟器上测到的低帧率要先排除宿主的问题，不能直接归咎于游戏代码。

---

## 二、测量方法（可复用）

### 1. 连接模拟器 WebView

```bash
# 找到 WebView 的 devtools socket 并转发
adb -s emulator-5554 shell "cat /proc/net/unix" | grep -o 'webview_devtools_remote_[0-9]*'
adb -s emulator-5554 forward tcp:9333 localabstract:webview_devtools_remote_<pid>
curl --noproxy '*' http://127.0.0.1:9333/json        # 列出页面

# 让模拟器访问本机 dev 服务器，避免测生产环境
adb -s emulator-5554 reverse tcp:3000 tcp:3000
adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d http://localhost:3000/ com.mx.browser
```

之后用一个很小的 Node 脚本通过 CDP 发送 `Runtime.evaluate`（要设 `awaitPromise: true` 和 `userGesture: true`），在页面里执行测量代码。访问本机时需要设置 `NO_PROXY='*'`，绕过本地代理 1856 端口。

注意：一次 evaluate 如果要持续等待 rAF，可能挂起超时。开局和采样最好分成两次调用。

### 2. 本机 Chrome

用 Playwright 的 `launchPersistentContext` 启动真实 Chrome（有界面、有 GPU，并传入 `--autoplay-policy=no-user-gesture-required`）。持久化 profile 可以保留 IndexedDB 里已导入的本地音源。导入音源可以直接调用 `page.setInputFiles('#local-soundfont-file', 'D:\\Downloads\\TyrolandGS.sf2')`。

### 3. 常用指标

| 指标 | 采集方式 | 用途 |
| :--- | :--- | :--- |
| 帧间隔 p50/p95/max、>20 ms 帧数 | 页面内 rAF 循环记录 `t - last` | 掉帧 |
| 长任务 | `PerformanceObserver({ entryTypes: ['longtask'] })` | 主线程阻塞 |
| CPU 分布 | CDP `Profiler.start/stop`，按 self time 聚合 | 定位热点函数 |
| 视觉时钟抖动 | 包装 `__canMusicGame.visualClock.sample`，比较 `dV - dFrame` | 音符下落是否均匀 |
| 音频时钟平滑度 | 每帧记录 `ctx.currentTime` 与 `getOutputTimestamp()` 减去 `performance.now()` 的偏移 | 时钟源噪声 |
| worklet 消息量 | 包装 `synth.post` 和 `worklet.port.onmessage` 并计数 | 音频线程通信负载 |
| 线程 CPU | `adb shell "top -H -b -n 2 -d 6"` | GPU、合成器、音频线程 |

`window.__canMusicGame` 是调试入口，可以直接调用 `playSong()`、`abortSong()`，并访问 `renderer`、`audio` 和 `visualClock`。

---

## 三、已完成的修改

| 文件 | 修改 | 依据 |
| :--- | :--- | :--- |
| `web/src/audio/soundfont.ts` `fetchSoundFont` | 命中缓存时直接调用 `arrayBuffer()`，不再逐块流式读取再拼接。首次下载按 `content-length` 预分配并直接写入；长度未知时按倍数扩容。 | 读代码：旧实现会同时保留所有分块和一份完整拷贝，893 MB 的文件峰值约 1.8 GB |
| `web/src/audio/synth.ts` `loadSoundFont` | 读取新音源前销毁旧 worklet；切回轻量合成时释放音源；串行处理快速切换请求；删除 `prefetchedSoundFont` 字段 | 读代码：旧实现切换时两份音色库同时驻留，并发加载可能让较早请求覆盖新选择。另外 `addSoundBank` 会转移缓冲区，旧字段实际指向已分离的缓冲区 |
| `web/src/audio/soundfont.ts` `applyChannelState` | 通道状态原地更新，避免每个音符创建临时对象；每次音符触发仍发送 CC11 | 复核发现，调度器先批量发送 MIDI 自动化，再批量发送音符。按消息发送顺序缓存 CC11，无法正确表示按播放时间执行的自动化，因此撤回了这项消息量优化 |
| `web/src/game/visual-clock.ts` | 误差超过 100 ms 或帧间隔超过 250 ms 时重新对齐；20～100 ms 的单次偏差先观察下一帧，持续偏差再平滑修正 | 实测：本机 Chrome 曾捕获 +65/-32 ms 的时间戳尖峰。新增模拟 ±50 ms 尖峰的测试 |
| `web/src/game/renderer.ts` | `noteLayer` 和 `hitEffectLayer` 设为独立 render group；打击和长按特效精灵只 `addChild` 一次，之后只切换 `visible`，并在 `prewarmNoteSprites` 中预创建 | 读 Pixi 8.20.1 源码：`visible` 翻转和对已有子节点调用 `addChild` 都会置 `structureDidChange`，导致整棵场景重建绘制指令 |
| `web/src/game/skin.ts` `getEffects` | 金属皮肤不再每次调用都展开一个新对象 | 读代码：每帧每个特效调用一次 |
| `web/src/game/judgment.ts` `findCandidate` | 任何音符超出候选窗口就停止扫描（谱面已按时间排序） | 读代码 + 新单测：在没有音符的轨道上按键，旧实现会扫到谱面末尾 |

新增的测试：

- `visual-clock.test.ts`：重复出现的单帧时间戳尖峰不影响视觉步长；非有限时钟读数可以恢复。
- `soundfont.test.ts`：自动化夹在两枚音符之间时恢复 CC11、零力度不改通道状态、流式下载三种 `content-length` 情况下都能正确拼接。
- `synth.test.ts`：快速切换音源时串行加载；加载中选择轻量合成时释放迟到的音源。
- `judgment.test.ts`：在空轨道上按键时读取的音符数有上限。

### 第一轮修复后的实测

- 模拟器（MagicSF 音源）：经典和金属皮肤各 2 局，均为 60 fps，没有超过 20 ms 的帧。视觉时钟相对帧时间的偏移在 ±3 ms 左右，最差一次 12 ms。
- 本机 Chrome（TyrolandGS）：连续 3 局，其中 2 局 p99 为 16.8 ms。第二局出现过一次 50 ms 的掉帧，测试环境里有其他浏览器进程在运行。

代码复核又调整了 CC11、音源释放顺序和视觉时钟。新增的音源切换测试也已通过。设备数据仍来自第一轮修复，尚未重新测量这些后续调整。

---

## 四、试过但撤回的方案

- **`new WorkletSynthesizer(context, { eventsEnabled: false })`**：在 spessasynth_lib 4.3.14 中不生效。worklet 侧 `onEventCall` 会无条件回传 `eventCall`，另外还有 `voiceCountChange`。模拟器上实测回传约 350 条/秒（noteOn、noteOff 各约 100 条，voiceCountChange 约 127 条），所以已经撤回。
- **移除或替换音符层的 Graphics 遮罩**：Pixi v8 中任何 `Container` 作为 mask 都会走 `StencilMask`，而 `ScissorMask` 不会被自动选用，没有简单的替代方案。保持原样。

---

## 五、待跟进（按优先级）

1. **worklet 回传消息**（约 350 条/秒，主线程都要反序列化）
   - 方案 A：用 `WorkerSynthesizer` 加一个自定义 Worker，完全绕开主线程。改动较大，需要重新验证时钟同步。
   - 方案 B：给 spessasynth_lib 提 issue 或打补丁，让 worklet 侧在 `eventsEnabled=false` 时不再 post。可以先用 `patch-package` 验证收益。
2. **音频线程事件队列**：spessasynth_core 的 `processMessage` 在每次插入未来事件时都会对整个 `eventQueue` 重新 `sort`，出队用 `shift()`。当前 noteOff 在 noteOn 时就入队，长音会让队列变长。可以在主线程维护一个待发 noteOff 队列，在 `scheduleBgm` 的 lookahead 窗口内再发送。
3. **MIDI 自动化与音符调度顺序**：当前调度器分两轮批量发送。若继续减少控制器消息，应先按播放时间统一调度，并验证玩家即时触发与未来自动化的交错情况。
4. **每帧精灵属性写入**：`renderFrame` 对每个可见音符都会重设 texture、anchor、width、height 和 alpha。可以缓存池内每个精灵上一次的车道、长按状态和判定状态，只在变化时才写。
5. **本地音源读取**：`readLocalSoundFont` 调用 `Blob.arrayBuffer()` 会一次性拷贝 893 MB。worklet 需要完整缓冲区，这一次拷贝避免不了，但建议在 UI 上提示大音源对内存的要求，比如在 2 GB 以下的设备上给出警告。
6. **模拟器上的 GPU**：`Chrome_InProcGpu` 线程在对局中约占 14% 到 36% CPU。如果要进一步降低开销，可以评估是否把 `resolution` 上限从 1.5 降到 1.25，或者只在移动端降低。
7. **判定按车道建索引**：`findCandidate` 和 `update()` 每次都要跨车道扫描。可以在 `setNotes` 时构建每条车道的索引数组，彻底去掉跨车道扫描。

---

## 六、经验

- **先排除测试环境**：模拟器宿主降频、代理设置、页面是否在前台，都可能让帧率掉到 20 到 30 fps。先测一个空 rAF 循环作为基线。
- **帧率正常不等于画面流畅**：60 fps 下音符也可能前后跳。要单独测“视觉时间增量”和“帧时间增量”之间的差。
- **偶发现象要重复测**：单局测试容易误判，比如一开始以为是金属皮肤导致的卡顿。每个对比条件至少跑两轮，交替执行。
- **第三方库的配置项要验证**：`eventsEnabled` 这类选项的文档语义与实际行为可能不一致，改完要用计数器实测。
- **大缓冲区是 transferable 的**：`addSoundBank` 会转移 ArrayBuffer，调用后主线程上的引用变成 0 字节，不能再复用。
- **设备验证使用本地服务**：上述设备测试均访问 `localhost:3000`。模拟器通过 `adb reverse` 连接本机 dev 服务器。
