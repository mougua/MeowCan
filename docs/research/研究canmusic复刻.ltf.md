---
localthink: "1.0"
title: "研究CanMusic复刻"
created: 2026-09-09T10:17:42.333Z
updated: 2026-09-09T10:17:42.337Z
platform: chatgpt
language: zh-CN
kind: conversation
status: active
source: builder
x_builder: "browser-extension"
x_capture_adapter: "browser-extension-chatgpt-v2.2"
x_capture_turns: 2
x_capture_human_turns: 1
x_capture_ai_turns: 1
x_capture_code_blocks: 137
x_capture_strategy: "chatgpt-viewport-turn-sweep"
x_capture_turn_min: 1
x_capture_turn_max: 2
x_capture_message_id_count: 2
x_capture_turn_id_count: 2
x_capture_scroll_complete: true
x_capture_scroll_steps: 61
x_capture_scroll_top: 38586
x_capture_scroll_height: 39495
tags: []
visibility: private
summary: "這份 LTF 文件保存了「研究CanMusic复刻」，共 2 個回合。主題從「[@Deep Research](plugin://deep-research-work@openai-curated-remote) 搜索并研究关于2002年左右的老游戏： canmusic以及后来lemonball代理的newcanmu」開始，完整內容由 LTF Builder 擷取並轉換為 LTF。"
insights: []
open_questions: []
participants:
  - role: human
  - role: ai
    platform: chatgpt
---

# 研究CanMusic复刻

## Conversation

### Session: 2026-09-09T10:17:42.333Z

**Human:** [@Deep Research](plugin://deep-research-work@openai-curated-remote) 搜索并研究关于2002年左右的老游戏： canmusic以及后来lemonball代理的newcanmusic的所有技术细节。我的目标是利用现代浏览器技术复刻一个网页版的canmusic。

**AI:**
### CanMusic / NewCanMusic 技术考古与网页版复刻研究

先给结论：**这个项目完全可以用现代浏览器技术复刻，而且 CanMusic 反而比很多同时代音游更适合 Web 化。** 它的核心不是 MP3/WAV + 固定谱面，而是一个相当有意思的 **MIDI/VOS 实时演奏系统**：曲目体积极小，谱面保存了“哪些 MIDI 音符由玩家负责、落在哪个 7 键、何时开始/结束”，其余音轨自动作为伴奏；玩家正确按键时，对应的 MIDI 音符实时发声。

因此，真正需要复刻的是：

> **VOS/CAN 文件解析器 + MIDI 合成器 + 7 键判定引擎 + 音频主时钟 + CanMusic UI/皮肤 + 在线曲库/对战。**

而不是去模拟 Windows、DirectDraw 或原客户端本身。

上面这张保存下来的 MyCanMusic/CanMusic 画面很有价值：左侧是典型 7 键下落谱面和 Can 皮肤，右侧 PDA 区显示时间、速度、音量、曲目列表等。这和 2004 年 Lemonball 的新闻资料描述高度吻合。

### 一、先把 CanMusic 的身世理清

CanMusic 的根实际上不是 2002 年才出现。

HanseulSoft（한슬소프트）在 1999–2000 年左右已经开发了 **VOS — Virtual Orchestra System**。它的原始技术目标不是传统“音游”，而是把 MIDI 转换成一种普通人可以通过少量按键“演奏乐器”的电子乐谱。

HanseulSoft 在 1999 年申请、2001 年公开的专利里已经完整描述了这个思想：

- 解析 MIDI message；
- 把 MIDI delta time 转换为绝对时间；
- 按乐器/轨道拆分音符；
- 把完整音域简化到一个 octave；
- 可以删除、移动音符以调整难度；
- 把电子乐谱滚动显示；
- 用户负责指定乐器，其余乐器自动作为伴奏；
- 用户输入之后，实时输出该音符对应的 MIDI message；
- 输出可以走软件 MIDI、硬件 MIDI module、FM synthesizer；
- 输入设备可以是键盘、joypad 或 MIDI 乐器。

这实际上已经把后来 CanMusic 的技术骨架写完了。

### CanMusic 服务演变

2002 年 1 月，NHN/Hangame 宣布与 HanseulSoft 合作，当时 CanMusic 已经在 Hangame 试运行，计划从 **2002 年 2 月 6 日正式服务**。新闻直接描述玩法为“配合伴奏按指定键，根据演奏准确度获得分数”。

2002–2003 年经历 Hangame → HanseulSoft 自营 Music&Play 后，2004 年由 SunnyYNK 的 **Lemonball** 重新整合服务。保存资料通常把这一时期称为：

**New CanMusic / NewCan / 뉴 캔뮤직**

而韩国当年的正式新闻稿又经常继续直接叫“캔뮤직”。ZDNet 在 2004 年的报道中确实使用过“뉴 캔뮤직”这个名称，因此它并不是后来玩家完全杜撰的称呼。

二手史料还指出，Music&Play 之前的 CanMusic 偏 Web 启动/承载，而 Lemonball 时代换成了专用 Windows 客户端。这个说法与现存客户端、DirectDraw 兼容性资料基本相符，但我暂时没有找到 HanseulSoft 当年的技术文档直接确认这一点。

### 二、CanMusic 最重要的技术：VOS

这是整个网页版复刻中价值最高的一部分。

幸运的是，VOS 并不是完全未知格式。

2006 年出现过一个 GPL 开源 Linux 克隆 **PMG**。作者对 VOS/CanMusic 文件进行了相当深入的逆向，留下了 `format.txt`、`dump_vos.c` 和完整播放器实现。

PMG 自己明确说明：

- VOS / CanMusic 原版是 Windows 闭源程序；
- 曲目使用基于 MIDI 的 `.vos`；
- PMG 能读取“几乎所有” VOS / CanMusic `.vos`；
- 音乐由玩家音符 + background music 一起组成；
- PMG 使用了**自己全新的计分算法**。

最后一点非常重要：

> **PMG 可以作为格式解析和播放机制的参考，但不能把它的评分代码当成 CanMusic 原版评分算法。**

### 三、`.vos` 实际上至少存在两代格式

逆向文档明确说明所有多字节整数都是：

**Little Endian**

浏览器里直接用：

```ts
DataView.getUint16(offset, true)
DataView.getUint32(offset, true)
```

就能处理。

最外层第一个 `uint32` 基本就能判断格式：

```ts
const magic = view.getUint32(0, true);

if (magic === 3) {
parseClassicVOS();
} else if (magic === 2) {
parseCanMusicVOS();
}
```

这会是网页版解析器非常合适的入口。

### 3.1 老 VOS：magic = 3

文件开头：

```
03 00 00 00
```

接着是一张 segment table。

已知 segment 名：

```
inf
mid
EOF
```

每个表项近似为：

```
uint32 offset
char name[16]
```

`inf` 前面可能还存在：

```
"VOS1"
uint16 version
64 bytes reserved
length-prefixed string
```

随后是歌曲信息。

逆向确认至少包括：

| 字段 | 内容 |
| --- | --- |
| title | 曲名 |
| artist | 原作者/艺人 |
| comment | 注释 |
| vos_author | 谱面作者 |
| song_type | 曲目类别 |
| extended_type | 扩展类别 |
| length | 曲长 |
| level | 难度 |
| padding | 大块保留区 |

难度保存值似乎是：

```
displayLevel = storedLevel + 1
```

随后就是若干 `note_array`。

### 四、单个 VOS note 保存的东西非常关键

老格式每个 note 包含的核心字段大约是：

```
time
length

MIDI command
MIDI note number
velocity

mode
```

`mode` 位字段逆向出来至少包括：

- 低 4 bit：color；
- bit 4–6：对应 7 个演奏键；
- bit 7：这是玩家负责的 note；
- bit 8：long note。

这说明一个非常重要的事情：

### CanMusic 谱面不是“单纯的下落方块时间表”

一个玩家 note 本身还保留了：

```
MIDI channel / command
MIDI note number
velocity
duration
lane
是否玩家音符
是否长音符
```

所以正确的 Web 数据模型应该保留音乐语义，而不是一导入就粗暴转换成：

```json
{
"lane": 3,
"time": 10.52
}
```

最好是：

```ts
interface PlayableNote {
lane: 0 | 1 | 2 | 3 | 4 | 5 | 6;

startSec: number;
endSec: number;

midiCommand: number;
midiNote: number;
velocity: number;

instrument: number;

long: boolean;
color: number;
}
```

这样才能真正重现 CanMusic 的“**按哪个 note，就演奏哪个声音**”。

### 五、CanMusic/NewCan 使用的新版 VOS 容器

这个更有意思。

CanMusic 时代的 `.vos` 开头通常是：

```
02 00 00 00
```

它实际上变成了一个**迷你文件容器**。

里面通常有两个 embedded file：

```
Vosctemp.trk
VOSCTEMP.mid
```

容器布局是：

```
uint32 filenameLength
filename

uint32 fileLength
fileData
```

然后继续下一个文件。

因此：

> `.vos` 虽然扩展名没变，但 Lemonball/CanMusic 谱面已经不是简单旧 VOS 结构了。

### 六、`Vosctemp.trk` 才是真正的谱面核心

逆向工具实际识别到了至少两个版本：

```
VOS022
VOS006
```

对应代码：

```
if (memcmp(magic, "VOS022", 6) == 0)
version = 22;
else if (memcmp(magic, "VOS006", 6) == 0)
version = 6;
```

其结构大致是：

```
VOS022

title
artist
comment
vos_author
extra string

unknown/reserved

tempo-time length
real-time length

1024 bytes reserved

number of note arrays

instrument descriptors

difficulty

note arrays

player-note mapping

lyrics
```

这里的字符串长度已经从老 VOS 的 `uint8` 长度变成 `uint16`。

### 七、CanMusic note 的真实内部结构

逆向文档显示，每个 CAN note 是 **16 bytes 左右的固定记录**。

包含：

```
time
midi note number
track
velocity

is_user
is_long

length
可能的 BGM 标志
```

随后文件还有一张独立的：

**user note mapping table**

记录：

```
note-array index
note index
key
```

其中：

```
key < 7
```

PMG 的解析器甚至对此直接 `assert(key < 7)`。

因此可以相当确定：

### 7 键不是 UI 偶然设计，而是 VOS 数据模型本身的一部分。

### 八、为什么 CanMusic 是七键

HanseulSoft 的专利给出了非常漂亮的解释。

原始 MIDI 的音域可以很宽。

VOS 的“简化”步骤可以：

> 去掉 octave 信息，把所有音符压缩到一个 octave。

同时甚至可以：

> 把半音映射到全音。

于是：

```
Do Re Mi Fa Sol La Ti
```

正好就是：

```
7 keys
```

CanMusic 的 7-key UI 并非模仿后来某个音游，而是直接来自 VOS 的“让普通电脑键盘模拟乐器”的设计思想。

2004 年的游戏介绍也明确说玩家使用七个键表示“도레미파솔라시”，而且可以自由修改按键。

保存下来的客户端配置也印证了这一点：

```
Do=
Re=
Mi=
Fa=
Sol=
Ra=
Si=
```

配置值保存的是键盘 ASCII/virtual-key 数值。

后来的保存版本中最常见的布局是：

```
S D F Space J K L
```

但键位本身是可配置的。

### 九、音频系统：这是复刻时最容易做错的地方

传统 Web 音游常采用：

```
播放 MP3
+
显示谱面
+
根据 timing 判定
```

如果这么做，你得到的是“长得像 CanMusic 的音游”，而不是 CanMusic。

VOS 原始设计明确规定：

> 玩家选择一个乐器；其他乐器作为 background；出现用户输入时，系统根据电子谱找到对应音符，并实时发送相应 MIDI output message。

输出端可以是：

- Software MIDI；
- FM synthesizer；
- hardware MIDI module / Sound Canvas 类设备。

这与 VOS 文件里的：

```
note_num
velocity
command
is_user
```

完全吻合。

### 十、浏览器版正确的音频架构

我建议不要依赖 Web MIDI API 来“播放 MIDI”。

Web MIDI API 主要是跟外部 MIDI 设备通信，不是一个浏览器内建 General MIDI synthesizer。

应当使用：

```
VOS Parser
↓
Normalized Song Model
↓
Tempo Map
↓
MIDI Event Scheduler
↓
WebAudio MIDI Synth
↓
AudioContext.destination
```

其中合成器可以选：

```
SoundFont SF2 + WASM synth
```

或者：

```
TinySoundFont 风格 WASM
FluidSynth WASM
自研 GM-compatible sampler
```

真正需要的是 **GM/GS 风格的 MIDI 合成**。

### 十一、最重要的播放规则

我建议把 note 分成两类。

### BGM note

```ts
isUser === false
```

在到达正确时间时：

```
自动 NoteOn
自动 NoteOff
```

### User note

```ts
isUser === true
```

不要自动发声。

而是：

```
玩家 keydown
↓
判定匹配 note
↓
命中
↓
发送该 note 的 MIDI NoteOn
```

长音符则在：

```
keydown → NoteOn
keyup   → NoteOff
```

这才真正体现：

**“我在演奏这首 MIDI，而不只是跟着音乐敲按钮。”**

专利明确支持这种体系；但某些具体 CanMusic 版本对 Miss、自动补声、长音释放等细节是否做过调整，还需要直接测试旧客户端。

### 十二、不要用 JavaScript timer 做时钟

网页版音游最关键的一条：

```js
setInterval()
setTimeout()
Date.now()
```

都不能当游戏主时间轴。

应该：

```
Audio
Context.current
Time
```

成为唯一 master clock。

架构：

```
┌─ MIDI scheduler
AudioContext.currentTime ├─ judgement
├─ note position
├─ lyric
└─ replay
```

画面：

```
requestAnimationFrame
```

只是“把当前时间对应的状态画出来”。

也就是：

```ts
const songTime =
audioContext.currentTime -
songAudioStartTime +
userOffset;
```

每个 note 的 Y：

```ts
y =
judgementLineY -
(note.startSec - songTime) * scrollPxPerSec;
```

这样即便浏览器突然掉一帧：

```
音频不会掉拍
谱面下一帧直接跳到正确位置
```

而不是游戏越来越漂。

### 十三、PMG 给我们留下了更好的内部数据模型

PMG 的源码值得重点借鉴的是数据模型，而不是它的 scoring。

它内部已经区分：

```
rt_start
tt_start

rt_end
tt_end
```

也就是同时保存：

```
real time
tempo time / MIDI musical time
```

还专门有：

```
TempoChange {
rt0
tt0
qn_time
}
```

以及：

```
NKEY 7
```

用户 note 保存：

```
MIDI command
note_num
velocity
key
color
is_long
```

所以网页版内部模型最好也同时保留：

```ts
musicalTick
seconds
```

而不是解析时只留下秒数。

例如：

```ts
interface TempoEvent {
tick: number;
sec: number;
bpm: number;
usPerQuarter: number;
}

interface Note {
startTick: number;
endTick: number;

startSec: number;
endSec: number;
}
```

以后做：

- 变速；
- 编辑器；
- MIDI 导出；
- 谱面生成；

都会方便很多。

### 十四、原版玩法已经可以重建得相当完整

2004 年的同期报道明确记录 CanMusic 有：

```
Solo
Audition
Battle
```

曲目难度：

```
Level 1 ～ 12
```

并且有六种玩法修饰：

| 原模式含义 | Web 中应该怎么做 |
| --- | --- |
| Normal | 原谱 |
| Mirror | lane → 6-lane |
| Line-change Random | 重新排列 lane |
| 渐渐消失 | 只改变 note alpha |
| Wobble | 改变视觉坐标 |
| Up & Down | 改变视觉运动方式 |

这些模式在 2004 年 5 月的同期报道中就已经存在。

这里有个重要的架构原则：

> **modifier 尽量不要修改原始 Song 数据。**

设计成：

```
Raw Chart
↓
Gameplay Transform
↓
Rendered Chart
```

例如 Mirror：

```ts
renderLane = 6 - originalLane;
```

Random 则应该产生一个：

```ts
seed
```

比如：

```ts
seed = hash(songId, roomId, roundId)
```

这样：

- replay 可重复；
- 对战双方能保证同谱；
- 排名可以验证。

### 十五、Audition 模式也已经有可靠资料

Lemonball 在 2004 年 6 月推出新的 Audition：

```
12 个名声等级
11 次 audition
```

每一级：

```
指定 3 首曲
准确率 >= 70%
```

才通过。

最终玩家进入：

```
Hall of Fame
```

这对于网页版来说很好实现。

它实际上就是：

```
License / progression system
```

数据库：

```
audition_level
required_song_ids[]
accuracy_threshold
```

### 十六、Battle 不是 5 人同时互殴

这是一个很容易误解的点。

2004 Lemonball 新版本把原本：

```
1 vs 1
```

改成一个最多：

```
5 人房
```

但实际比赛仍然是：

```
2 人比赛
+
3 人观战
```

赢家留场，下一位挑战者依次上场。

所以复刻 NewCanMusic Battle 时，room state 可以非常简单：

```ts
interface BattleRoom {
champion: Player;
challenger: Player;
waiting: Player[]; // <= 3
}
```

一局结束：

```
winner → champion

waiting.shift()
↓
new challenger
```

这个模式很有 CanMusic 味道，建议保留，而不是改造成现代普通 8 人同步排名房。

### 十七、后来甚至支持最多 30 人

2005 年新增了：

**와글와글 콘서트홀**

报道声称最大：

```
30 players
```

可以：

- 多人一起演奏；
- 某一个人独奏，其余人观看；
- 自动演奏音乐，大家聊天；
- 房主接收点歌。

这跟 HanseulSoft 几年前申请的网络 VOS 专利非常有意思地对应起来。

专利里的服务器设计包含：

```
program store
music file store
user DB
evaluation DB
service controller
multiplex concert
```

客户端上传自己的 playing data，服务器可汇总成 total playing data 再发送给其他客户端。

不过要注意：

> **专利能证明 HanseulSoft 的设计思想，但不能证明 Lemonball 2004/2005 客户端实际采用了完全相同的 packet protocol。**

我们目前还没有原 NewCanMusic 网络包格式。

### 十八、现代 Web 对战不要复制 2001 年网络协议

也没有必要。

浏览器版推荐：

```
HTTPS REST
+
WebSocket
```

其中对战不要把每次按键 round-trip 到服务器再决定能不能发声。

否则：

```
30ms ping
80ms ping
150ms ping
```

玩家手感完全不同。

推荐：

```
客户端本地判定
↓
立即发 MIDI sound
↓
发送 InputEvent 给服务器
↓
服务器复算 / 校验
```

event：

```ts
interface InputEvent {
lane: number;
down: boolean;
localTime: number;
songTime: number;
seq: number;
}
```

服务器已经有同一份 chart，因此可以进行：

```
re-simulation
```

来验证：

```
hit
miss
combo
score
```

### 十九、NewCanMusic UI 其实也有大量可靠资料

Lemonball 在 2004 年 9 月重做 UI，核心概念就是：

### 自动售货机 / vending machine

主画面的：

```
Solo
Battle
...
```

被设计成自动售货机里排列的不同饮料罐。

演奏界面：

> 一个插着大号绿色吸管的 Can。

结算时：

> 伴随“咔哒”声，罐盖打开，显示结果。

右侧：

> PDA 形状功能面板。

保存下来的截图也基本就是这个设计。

### 二十、PDA 不是装饰，而是功能中心

2004 年同期资料明确记录 PDA 位于每个页面右侧，并根据当前界面提供不同功能。

例如：

主界面：

```
options / explanation
```

演奏页：

```
album
song search
```

“소리받아”曲库：

```
preview
```

甚至还有：

```
game ON/OFF
```

所以如果目标是复刻 NewCanMusic，我建议不要重新设计成现代“漂亮卡片 UI”。

**PDA + 自动售货机是辨识度最高的两部分。**

### 二十一、皮肤系统也能基本复原

2004 年 10 月 Lemonball 增加了非常先进的颜色自定义。

可以单独修改：

```
Hue
Saturation
Brightness
```

并且能对：

```
整个 Can
外壳
内部
输入区
```

分别设置。

这完全适合现代 shader。

例如：

```
vec3 rgb2hsv(...)
vec3 hsv2rgb(...)

hsv.x += hueOffset;
hsv.y *= saturation;
hsv.z *= brightness;
```

如果第一版用 Canvas2D，也可以先用：

```
OffscreenCanvas
+
pixel transform
```

但长期来看，皮肤 H/S/V 这一层用 WebGL shader 会很干净。

### 二十二、更厉害的是：老客户端的 Skin 本来就是数据驱动的

现存保存版显示资源目录类似：

```
HanseulSoft/
CanMusic/
image/
skin/
*/
left/
skin.ini
```

保存社区发现：

```
skin.ini
```

可以移动包括 combo 在内的一些 UI 元素、关闭 laser 等效果。

而：

```
CanMusic.dat
```

甚至可以直接文本编辑。

这意味着网页版复刻非常适合把皮肤定义成：

```json
{
"playfield": {
"x": 38,
"y": 72,
"width": 314
},
"combo": {
"x": 160,
"y": 190
},
"judgement": {
"x": 160,
"y": 420
}
}
```

资源：

```
PNG/WebP sprite atlas
+
skin.json
+
shader parameters
```

而不是写死 DOM 坐标。

### 二十三、原客户端图形技术可以推断到什么程度

保存社区在现代 Windows 上运行 CanMusic，需要处理：

```
16-bit / 65536 color
```

黑屏问题也经常通过：

```
16-bit color compatibility
```

解决。

闪屏/卡顿有专门：

```
ddraw_fix
```

同时还有教程要求通过 `directx.cpl` 开关：

```
DirectDraw hardware acceleration
Direct3D hardware acceleration
```

所以可以比较有把握地说：

> **CanMusic 客户端属于典型的 DirectDraw/早期 DirectX 时代 Windows 2D 渲染体系，并明显依赖旧式 16-bit surface 行为。**

但在没有直接分析 `CanMusic.exe` import table 之前，我不会进一步断言：

```
它具体调用了 DirectDraw7 哪些接口
```

或者：

```
是否部分场景实际走 Direct3D
```

这需要二进制静态分析确认。

网页版完全没有必要模拟这些兼容性 bug。

### 二十四、曲库为什么能大到几千首

原因就是 MIDI/VOS。

2004 年报道说 Lemonball 当时已有约：

```
5000 首
```

而且宣传为无需传统大文件下载即可在线直接游玩。

到 2005 年，玩家上传的自制曲已经超过：

```
7000
```

其中约：

```
1062
```

经过筛选正式成为 CanMusic 内容。

后来的 MyCanMusic 保存包包含：

```
8542 charts
```

整个包仍然不到 1 GB。

这个数据量对今天 Web 来说几乎微不足道。

### 二十五、用户制谱系统非常值得复刻

这其实是 CanMusic 最超前的一点。

Lemonball 时代有：

```
곡 만들기 / 曲制作
```

玩家制作并上传歌曲后，需要经过：

```
普通资料库
→ Good 资料库
→ 用户 + 专业评审
→ >= 50% 推荐
→ 正式进入 CanMusic 曲库
```

2004 年新版发布时，官方就把“用户直接制作歌曲、接受玩家和评委评价”作为核心功能之一。

现代版完全可以做：

```
上传 MIDI
↓
Browser MIDI parser
↓
自动生成 VOS-like candidate
↓
Web chart editor
↓
Preview
↓
Upload
↓
Community review
↓
Approved catalog
```

这会比单纯复刻一个古董客户端有生命力得多。

### 二十六、搜索/收藏等系统也有确切记录

Lemonball 已经有：

```
曲名
艺人
分类
曲库
album
preview
wishlist
```

2004 年 8 月甚至加入：

```
游戏进行中按 F8
```

把当前曲目加入“찜 리스트”，之后到“소리받아”中查看。

所以网页版可以保留一个很有年代感的：

```
F8 收藏
```

而不是只放一个现代 ❤️ 按钮。

### 二十七、判定 / EQ 是目前最大的黑箱之一

我们目前能确定：

2002 年的官方报道明确说：

> 得分取决于演奏准确度。

开源 PMG 也明显按：

```
keypress timing delta
```

计算 score。

但是 PMG README 明说它采用：

> brand-new scoring algorithm。

所以：

### 我现在不建议“猜”原 CanMusic judgement window。

更不能把 PMG 默认类似：

```
±xxx ms
```

直接当成 CanMusic。

现存客户端还有：

```
0_EQ.ift
```

之类资源文件，这意味着原版 EQ/评分很可能还值得继续逆向。

这个部分最好最终通过：

```
旧客户端
+
固定测试谱
+
自动输入
+
逐毫秒 sweep
```

反推出：

```
hit window
score curve
long-note release window
combo rule
EQ formula
```

这样才能做到真正 1:1。

### 二十八、网页版内部模块我建议这样拆

```
┌─────────────────────────────┐
│          Web App            │
├─────────────────────────────┤
│ UI / Vending Machine / PDA  │
├─────────────────────────────┤
│ Skin Engine                 │
├─────────────────────────────┤
│ Renderer                    │
│ Canvas2D / WebGL2           │
├─────────────────────────────┤
│ Rhythm Engine               │
│ judgement / combo / mods    │
├─────────────────────────────┤
│ Song Timeline               │
│ AudioContext master clock   │
├─────────────────────────────┤
│ MIDI Synth                  │
│ WebAudio + WASM + SF2       │
├─────────────────────────────┤
│ Song Model                  │
├─────────────────────────────┤
│ VOS / CAN Parser            │
│ ArrayBuffer + DataView      │
└─────────────────────────────┘
│
│ HTTPS / WS
▼
┌─────────────────────────────┐
│ Server                      │
│ auth                        │
│ catalog                     │
│ ranking                     │
│ battle rooms                │
│ replay verification         │
│ UGC / moderation            │
└─────────────────────────────┘
```

### 二十九、我会优先选 Canvas2D，而不是一开始 WebGPU

CanMusic 本质上就是：

```
sprite
lane
note
text
simple effect
```

第一版 Canvas2D 足够，而且更容易做到像素级复刻。

建议：

```
Canvas2D
+
OffscreenCanvas
+
Web Worker
```

谱面密度再夸张也不是现代 GPU/CPU 的问题。

之后以下部分再迁移 WebGL2：

```bash
HSL skin shader
laser
distortion/wobble
glow
particle
```

WebGPU 对这个项目第一阶段属于过度设计。

### 三十、输入系统

默认可以支持：

```
S D F Space J K L
```

同时允许完全重映射。

监听：

```js
keydown
keyup
```

务必：

```js
if (event.repeat)
return;
```

并且游戏时：

```js
preventDefault()
```

特别是 Space。

最好保存：

```
event.code
```

而不是 `event.key`：

```ts
KeyS
KeyD
KeyF
Space
KeyJ
KeyK
KeyL
```

这样不受输入法和键盘布局影响。

### 三十一、浏览器延迟校准必须做

老 CanMusic 是本机程序。

浏览器版需要考虑：

```
keyboard latency
audio output latency
Bluetooth headphones
display latency
```

所以设置里至少做两项：

```
Input Offset
Visual Offset
```

甚至可以增加自动校准：

```
click sound
↓
玩家随节拍敲键
↓
统计平均误差
```

最终：

```ts
judgementTime =
keyboardTimestamp +
calibratedInputOffset;
```

### 三十二、网络对战应该以 Chart Hash 为中心

为了以后排名、防作弊、replay，曲子不要只使用：

```
songId
```

还要有：

```bash
chartHash
```

例如：

```bash
SHA-256(normalized chart)
```

Battle start：

```json
{
"songId": 2381,
"chartHash": "...",
"modifierSeed": 928374,
"startAtServerTime": 123456789
}
```

这样服务器知道大家打的是：

**完全相同的谱。**

PMG 自己的 `VosSong` 数据结构里也已经维护了 song hash，说明这个思路在老 VOS 工具生态里已经有人使用。

### 三十三、数据库其实不复杂

例如 PostgreSQL：

```
songs
charts
chart_versions
artists
albums
users

scores
replays

rooms
room_players

user_favorites

uploads
reviews
review_votes

skins
user_skin_settings
```

原始 `.vos` 不应该扔掉。

应该同时保存：

```
original.vos
+
normalized binary/json
+
hash
```

这样以后解析器修 bug 后，可以重新导入全部曲库。

### 三十四、建议浏览器使用自己的 Normalized Format

不要让游戏引擎到处知道 `VOS022`。

解析过程：

```
VOS1 / VOS006 / VOS022
↓
vos-parser
↓
Canonical Song
```

例如：

```ts
interface CanSong {
metadata: {
title: string;
artist: string;
author: string;
level: number;
};

tempoMap: TempoEvent[];

tracks: MidiTrack[];
notes: MidiNote[];
playable: PlayableNote[];

lyrics: LyricEvent[];

duration: number;
}
```

以后甚至可以加入：

```
BMS
SM
osu!mania
MIDI
```

但 Rhythm Engine 完全不用变。

### 三十五、真正的第一版 MVP 不应该做服务器

如果由我来安排这个项目，我会按下面顺序做：

1. **浏览器直接拖入 `.vos` → 成功解析 metadata。**
2. 能列出全部 `user note`、lane、MIDI note、时间。
3. WebAudio + SoundFont 能完整自动演奏一首 VOS。
4. 把 user note 从自动伴奏中拿掉，改为按键命中后才发声。
5. 完成长音、判定、combo、speed。
6. 加 Mirror/Random 等原版 modifier。
7. 复刻 NewCanMusic Can + PDA 演奏界面。
8. 导入 MyCanMusic 曲库做兼容测试。
9. 再实现曲库、账户、排名。
10. 最后实现 Battle / spectator / 30 人 Concert。

这条路线最大的好处是：

> **做到第 4 步，你已经拥有真正的 CanMusic 核心，而不是一个 UI mockup。**

### 三十六、我现在能确认 vs 还不能确认的技术细节

| 领域 | 当前状态 |
| --- | --- |
| VOS 基于 MIDI | 确定 |
| 7-key 数据模型 | 确定 |
| 玩家音符与 BGM 音符分开 | 确定 |
| MIDI note / velocity / duration | 确定 |
| Long note | 确定 |
| VOS1 文件结构 | 高度确定，逆向源码可验证 |
| VOS006 / VOS022 | 确定存在 |
| Vosctemp.trk / VOSCTEMP.mid | 确定 |
| lyrics timing | 确定 |
| Solo/Audition/Battle | 确定 |
| 5 人房、2 战 3 看 | 确定 |
| 30 人 Concert Hall | 确定 |
| 6 种 modifier | 确定 |
| 1–12 难度 | 确定 |
| PDA UI | 确定 |
| vending-machine UI | 确定 |
| H/S/V 分区换色 | 确定 |
| skin.ini 数据驱动 | 保存版强证据 |
| DirectDraw/旧 DirectX | 强证据，但还需 exe import 验证 |
| 16-bit color dependency | 保存版明确证据 |
| 原版具体 judgement window | 未知 |
| 原版 EQ 精确公式 | 未知 |
| NewCanMusic packet format | 未知 |
| login/auth packet | 未知 |
| patcher/update protocol | 未知 |
| Lemonball 服务端 DB schema | 未知 |
| 官方使用的具体 MIDI synth/GM bank | 尚未确定 |
| 原 client 的 DirectX API 调用细节 | 尚未做二进制分析 |

这张表实际上也指出了下一阶段研究的目标。

### 三十七、一个重要的版权现实

技术复刻和曲库复刻最好分开。

CanMusic 当年能拥有数千曲，是因为很多内容来自 MIDI 化的：

```
流行歌曲
动漫歌曲
游戏 OST
```

后来韩国 MIDI 社区也明确提到 CanMusic 等服务中的 MIDI 曾存在版权争议。

因此公开上线时，更稳妥的方案是：

```
开源/自研 CanMusic-compatible Engine
+
允许用户导入自己合法拥有的 .vos
+
只内置公版/原创/授权曲目
```

而不是直接把保存下来的 8000 多首 `.vos` 全部公开部署。

### 三十八、我认为“网页版 CanMusic”最合理的技术选型

如果现在正式开这个项目，我会选：

| 部分 | 技术 |
| --- | --- |
| 前端 | TypeScript |
| UI | React 或轻量自研 UI |
| 游戏画面 | Canvas2D → WebGL2 |
| Parser | TypeScript + DataView |
| Parser Worker | Web Worker |
| MIDI | 自己解析 VOS embedded MIDI |
| Synth | WebAudio + WASM SF2 synth |
| 主时钟 | AudioContext.currentTime |
| 图形刷新 | requestAnimationFrame |
| 网络 | WebSocket |
| API | HTTP/JSON |
| Server | Go / Rust / Node.js 均可 |
| DB | PostgreSQL |
| 文件 | S3/OSS 类对象存储 |
| Cache | Redis，后期再加 |
| Replay | 压缩的 input-event stream |
| PWA | 可以 |
| CDN | 曲目和 skin 静态资源 |

项目规模其实没有想象中大。

**最困难的是历史还原，不是现代工程实现。**

### 三十九、下一阶段我认为非常值得做：直接解剖 MyCanMusic/CanMusic 客户端

现在通过公开资料，我们已经能重建大约：

**70%–80% 的游戏技术概念和 VOS 文件层。**

要再往下，就不该继续只搜网页了，而应该对保存下来的：

```
CanMusic.exe
MyCanMusic.exe
CanMusic.dat
*.ini
*.ift
skin.ini
DLL
```

做静态考古。

重点检查：

```
PE imports
strings
resources
DirectX imports
Winsock imports
registry paths
config parsing
EQ tables
network host strings
packet constants
MIDI APIs
timing APIs
```

尤其需要看有没有：

```
winmm.dll
midiOutShortMsg
DirectMusic
dsound.dll
ddraw.dll
d3d*.dll
ws2_32.dll
QueryPerformanceCounter
timeGetTime
```

一旦得到这些信息，就能回答目前还悬着的几个问题：

**原客户端到底怎样 MIDI 发声、怎样计时、怎样画面同步、怎样联网。**

如果再对 `.ift` / `.dat` 做格式分析，很可能连原版判定和 EQ 都能挖出来。

### 我建议我们的下一步

如果你的目标不是“做一个类似 CanMusic 的网页音游”，而是**尽可能忠实地复活 NewCanMusic**，那我建议接下来不要先写 UI。

直接进入 **第二阶段技术考古**：

> **拿保存版 MyCanMusic / CanMusic 安装包和几个真实 `.vos` 文件，逐个分析 EXE、DLL、DAT、INI、IFT 和谱面二进制，然后输出一份可以直接作为开发规格书的协议/格式文档。**

之后第一段真正该写的代码就是一个独立的：

```
@canmusic/vos-parser
```

目标做到：

```ts
const song = parseVOS(arrayBuffer);

console.log(song.title);
console.log(song.artist);
console.log(song.level);
console.log(song.playableNotes);
console.log(song.tempoMap);
```

这个 parser 一旦跑通，整个网页版 CanMusic 就算真正开始了。

### 关键来源

本次研究以同期新闻、HanseulSoft 专利、保存版资料和开源逆向代码互相交叉验证。核心资料包括：HanseulSoft 的 VOS 演奏系统专利 `WO2001020594A1`，描述 MIDI→VOS、乐谱简化、实时 MIDI 输出和网络演奏机制；其网络服务专利 `WO2001046829A1`，描述服务器、曲库、用户、评价和多人 Concert 数据结构。

文件格式层最重要的是 felixonmars 保存的 PMG 项目，其中 `format.txt` 和 `dump_vos.c` 给出了 VOS1、VOS006、VOS022、`Vosctemp.trk`、note arrays、user-note mapping 和 lyric 数据的逆向结构；PMG README 同时明确提醒其评分算法不是原版。

历史和玩法方面，2002 年 iNews24 记录了 Hangame 与 HanseulSoft 的 CanMusic 合作及准确度计分方式；2004 年《京乡新闻》记录了七键、1–12 难度、Solo/Audition/Battle 和六种 modifier；Lemonball 时期新闻记录了 5 人 Battle、用户制谱、自动售货机、PDA 与皮肤调色；2005 年资料则记录了 30 人 Concert Hall。

保存生态方面，VSRG/CanMusic 页面与 MyCanMusic archive 提供了旧客户端的 16-bit/DirectDraw 兼容问题、键位配置、skin.ini、CanMusic.dat、8542 谱面的离线保存情况。

**如果你愿意继续，我下一轮可以直接进入“旧客户端二进制考古 + `.vos` Parser 开发规格”这一层，把 `VOS006/VOS022` 按字节 offset 整理成正式结构体，并进一步研究 CanMusic.exe 的 MIDI、DirectX、计时和网络实现。**
