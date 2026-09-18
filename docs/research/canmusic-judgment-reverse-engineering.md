# CanMusic 原版判定逆向记录

本文记录 2004 年原版 `ref/CanMusic/CanMusic.dll` 的判定逻辑。实现以静态反汇编结果为准。

## 样本与时基

- 文件：`ref/CanMusic/CanMusic.dll`
- SHA-256：`e6cd61d82014987e733624c7195ff764b4926a6ebce703d2e993f4880e4c0682`
- 映像基址：`0x10000000`
- 核心对象：`CPlayArea`，全局地址为 `0x10068e88`
- 谱面时基：每四分音符 768 tick

原版直接比较 `MUSIC_TIME`。因此，判定窗口会随 BPM 改变，并非固定毫秒值。tick 与毫秒的换算公式如下：

$$
t_{ms}=\frac{\text{tick}}{768}\times\frac{60,000}{\text{BPM}}
$$

| BPM | 210 tick | 360 tick | 600 tick |
| ---: | ---: | ---: | ---: |
| 60 | 273.4 ms | 468.8 ms | 781.3 ms |
| 120 | 136.7 ms | 234.4 ms | 390.6 ms |
| 180 | 91.1 ms | 156.3 ms | 260.4 ms |

## 短音符判定

按键入口位于 `0x10022271`。程序先从当前轨道中选择与按键时刻距离最近的未处理音符，再计算绝对 tick 偏差。

```x86asm
0x1002235e  mov eax, [eax+4]        ; 音符起始 MUSIC_TIME
0x10022361  sub eax, [ebx+0x4188]   ; 减去按键 MUSIC_TIME
0x10022368  call abs
0x1002236d  cmp eax, 0x258          ; 600 tick，候选上限不包含边界
0x1002249b  cmp ecx, [0x10059354]   ; 该地址的值为 210
0x10022527  cmp ecx, 0x168          ; 360
```

Web 端使用以下映射：

| 绝对偏差 | 原版行为 | Web 端名称 | 连击 |
| --- | --- | --- | --- |
| `0～210 tick` | 有效命中 | `COOL` | 增加 1 |
| `211～360 tick` | 弱命中 | `BAD` | 归零 |
| `361～599 tick` | 按键导致失误 | `MISS` | 归零 |
| `≥600 tick` | 不捕获音符 | 无判定 | 不变 |

原版未发现独立的 `GOOD` 时间带。项目保留 `GOOD` 类型仅用于兼容既有渲染接口，新判定引擎不会产生该结果。

程序在分级前调用 `0x10020622` 分派 MIDI 音符。因此，被按键捕获的 BAD 和 MISS 也会发声；自然漏键不会发声。

## 长音符判定

音符的 `+0x29` 字段表示长音。只有偏差不超过 210 tick 的音符头会进入保持状态。BAD 或 MISS 的音符头不会建立保持状态。

抬键入口位于 `0x100220e7`。程序使用实际保持时值，而非单独比较谱面尾部与抬键的绝对时间：

```x86asm
0x10022173  mov eax, [ebx+0x418c]   ; 抬键 MUSIC_TIME
0x10022179  sub eax, [ebx+0x4188]   ; 实际保持 tick
0x1002217f  mov ecx, [ecx+0x10]     ; 谱面 duration tick
0x10022185  sub ecx, eax
0x10022188  call abs
0x1002218d  cmp eax, [0x10059358]   ; 210
0x100221bf  cmp eax, 0x168          ; 360
```

长音尾部沿用短音符的 210/360 tick 分级。尾部 COOL 再增加一次连击。原版没有每 100 ms 发放保持分的逻辑。

## 分数与连击

公共结算函数位于 `0x10022915`。

- COOL：基础增加 15 分，并增加连击。
- 长音尾部 COOL：增加 `15 + floor(durationTicks / 128)` 分。
- BAD：增加 0 分，连击归零。
- MISS：减少 4 分，连击归零；总分最低为 0。
- 每逢 25 的整数倍连击，额外增加 `floor(sqrt(combo))` 分。

上述加分参数可在各调用点看到。例如，普通 COOL 传入 `15`，MISS 传入 `-4`。`0x100229bf` 至 `0x100229e7` 实现 25 连击周期与平方根奖励。

## Web 复刻对应关系

- `web/src/parser/vos.ts` 保留 `startTick`、`durationTicks` 和 Tempo Map。
- `web/src/game/judgment.ts` 把 WebAudio 秒时钟反算为 768 PPQ tick，再执行原版分级。
- `web/src/main.ts` 把每首歌的 Tempo Map 传给判定引擎。

这套实现覆盖普通音符、长音头、长音尾、候选选择、连击和基础计分。网络对战道具对判定结果的二次修改不属于本文范围。
