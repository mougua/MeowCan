# CanMusic 原版按键发声与空按/提前按键发音原版游戏记录

本文记录 2004 年原版 `ref/CanMusic/CanMusic.dll`（SHA-256: `e6cd61d82014987e733624c7195ff764b4926a6ebce703d2e993f4880e4c0682`）的按键发声（Keysound）与按键乐器演奏机制。

---

## 一、现象与原版游戏目标

原版 MyCanMusic 中，玩家点击“开始”后，即使谱面音符尚未落至判定线（或曲目前奏阶段跑道上没有音符），按下 7 个按键中的任意一个键，已经能够发出清晰的 Key 音（主奏乐器琴键声音）。

我们需要通过对 `CanMusic.dll` 核心函数反汇编，查明：
1. 按键按下时，音符在判定窗口外（或未到达）时是否发声？
2. 发声所使用的通道（Channel）、音色（Program/Instrument）、音高（Pitch）、力度（Velocity）与持续时间（Duration）是如何计算的？
3. 对比现有 Web 重制版，找出未能发声的原因并进行修正。

---

## 二、反汇编核心证据链

### 1. 按键分派入口

外层入口位于 `0x1002206f`，处理按键时刻记录后，调用核心判定与发音函数 `0x10022271`（`CPlayArea::OnKeyDown(int lane, int velocity)`）：
- `esi` 为当前按键轨道编号（`0..6`，对应 7 键）。
- `ecx` 为 `CPlayArea` 实例指针。

### 2. 候选音符查找与分支

函数在 `0x10022284` 调用短音符候选查找 `0x100225de`，并在 `0x10022299` 调用长音符候选查找 `0x10022662`。

```x86asm
0x1002229e  xor ecx, ecx
0x100222a0  mov dword ptr [ebp+8], eax      ; 比较长短音符候选
0x100222a3  cmp eax, ecx
0x100222a5  jne 0x10022312
0x100222a7  cmp ebx, ecx
0x100222a9  jne 0x1002230d
; 若长短音符候选均不存在（即当前轨道当前暂无音符）：
0x100222ab  lea eax, [esi+esi*4+0x834]
0x100222b2  mov dword ptr [edi+eax*8], ecx  ; 判定置 0（无判定，不扣分，不断连）
0x100222b5  lea eax, [esi+esi*4]
0x100222b8  cmp dword ptr [edi+eax*8+0x4198], ecx
0x100222bf  lea eax, [edi+eax*8]
0x100222c2  je  0x100222d5                 ; 跳转至 Fallback 琴键发声逻辑
```

若找到候选音符，接着在 `0x1002236d` 比较绝对 tick 偏差：

```x86asm
0x10022368  call abs
0x1002236d  cmp eax, 0x258                  ; 600 tick 判定窗口
0x10022373  mov dword ptr [ebp-0x10], eax
0x10022376  jl  0x10022412                 ; < 600 tick: 正常进入 COOL/BAD/MISS 判定与 PlayNote
; 若 >= 600 tick（音符未到判定线）：
0x1002237c  lea ecx, [esi+esi*4+0x834]
0x10022383  xor eax, eax
0x10022385  mov dword ptr [edi+ecx*8], eax  ; 判定置 0（无判定）
0x10022388  mov dword ptr [ebx+0x4184], eax ; 清空当前捕获
...
0x10022394  je  0x100223ae                 ; 跳转至 Fallback 琴键发声逻辑
```

### 3. Fallback 琴键发声逻辑（0x100223ae / 0x100222d5）

当没有可判定的音符或偏差 $\ge 600$ tick 时，程序执行以下逻辑：

```x86asm
0x100223ae  mov eax, dword ptr [0x10071d5c] ; 全局时间指针对应的 Note 索引
0x100223b3  mov ecx, dword ptr [0x1006125c] ; 谱面可玩音符数组 (CPlayNoteArray)
0x100223b9  dec eax                         ; index - 1 (上一个已播放音符)
0x100223ba  push eax
0x100223bb  call 0x10008e5d                ; CPlayNoteArray::GetAt(index)
0x100223c0  mov edi, eax                    ; edi = 基准音符 (Reference Note)
0x100223c2  cmp byte ptr [edi+0xd], 9       ; 检查是否为打击乐通道（MIDI channel 9，即通道 10）
0x100223c6  je  0x100223f0                  ; 若是打击乐，跳转至 diff = 0
0x100223c8  mov al, byte ptr [edi+0x28]     ; 基准音符原本所属的 lane
0x100223cb  push eax
0x100223cc  call 0x100450b0                ; 获取基准轨的大调音阶半音偏移
0x100223d1  push esi                        ; 当前按下的 lane
0x100223d2  movzx ebx, al
0x100223d5  call 0x100450b0                ; 获取按下轨的大调音阶半音偏移
0x100223dc  movzx ecx, byte ptr [edi+0xc]   ; ecx = 基准音符 pitch
0x100223e0  movzx eax, al
0x100223e3  sub eax, ebx                    ; diff = pressed_offset - ref_offset
0x100223e5  add ecx, eax                    ; new_pitch = ref_pitch + diff
0x100223e7  cmp ecx, 0x7f
0x100223ea  jg  0x100223f0                  ; 越界保护
0x100223ec  test ecx, ecx
0x100223ee  jge 0x100223f2
0x100223f0  xor eax, eax                    ; 越界时 diff = 0
0x100223f2  mov cl, byte ptr [edi+0xc]
0x100223f5  push 0x180                      ; duration = 384 tick (半拍八分音符)
0x100223fa  add cl, al                      ; pitch
0x100223fc  mov al, byte ptr [edi+0xd]      ; channel
0x100223ff  push 0x64                       ; velocity = 100
0x10022401  push ecx                        ; pitch
0x10022402  push eax                        ; channel
0x10022403  mov ecx, 0x100cd0e0             ; MIDI 合成器对象
0x10022408  call 0x100443c0                 ; noteOn(channel, pitch, velocity, duration)
```

### 4. 大调自然音阶半音映射表（0x100450b0）

```x86asm
0x100450b0  mov eax, [esp+4]
0x100450b4  and eax, 0xff
0x100450b9  dec eax
0x100450ba  cmp eax, 5
0x100450bd  ja  0x100450d8
0x100450bf  jmp [eax*4+0x100450e0] ; 跳转表：
; 0 (dec为-1, ja到 0x100450d8): 0 (Do)
; 1: 2 (Re)
; 2: 4 (Mi)
; 3: 5 (Fa)
; 4: 7 (Sol)
; 5: 9 (La)
; 6: 11 (Si)
```

7 个键对应自然大调白键半音程：
`MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11]`。

### 5. 开始时刻与初始索引

在歌曲刚启动时：
- `0x1000ad16` 将游标 `0x10071d5c` 赋为 0。
- 按下按键时 `dec eax` 传入 `-1`。
- `0x10008e5d`（`GetAt`）中，当 `index == -1` 时执行 `lea eax, [edx - 1]` 返回数组最后一个元素。在实际演奏中，谱面所有可玩音符属于同一主奏乐器通道，因此获取该乐器作为基准音色，玩家按 7 个键即以该乐器弹奏 Do-Re-Mi-Fa-Sol-La-Si。

---

## 三、对比与缺陷修正

| 项目 | 原版行为 | Web 端修改前 | Web 端修正后 |
| :--- | :--- | :--- | :--- |
| **倒计时/前奏按键** | 正常响应，琴键按键发声 | `if (currentTime < 0) return;` 阻断 | 移除阻断，立即响应按键高亮与发音 |
| **无音符/提前按键** | 不判 COOL/BAD/MISS，出 key 音 | 仅在本轨找未来音符，空轨无声 | 接入 `getKeysound` 双层机制，空闲出音 |
| **琴键演奏音高** | 大调白键音程度数差映射 | 直接原样播放未来单音音高 | 严格遵循 `MAJOR_SCALE_OFFSETS` 计算音高 |
| **持续时间与力度** | 固定 384 tick（半拍）与力度 100 | 使用未来音符的任意时值 | 固定 384 tick 时值与力度 100 |
| **判定影响** | 600 tick 外无判定，不扣分不断连 | 600 tick 外无判定 | 保持 600 tick 外无判定 |
