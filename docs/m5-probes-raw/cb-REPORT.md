# C-B 起飞前侦察：`prefab apply` / `revert` 真机语义（2026-09-20）

> 真机：Unity 官方中国版 **2022.3.62f3c1**（`C:/Users/<用户>/pi-unity-official-f3c1`）。原始证据 `cb-*.json` / `cb-*.cs`。
> 目的：backlog ③ 明确「`apply` 的读回面（证明 Prefab **资产**真被改）**要先设计**」——本侦察钉死 `PrefabUtility.ApplyPrefabInstance` / `RevertPrefabInstance` 的实际值语义，供 C-B 计划设计读回面。

## 场景设置

`node create CaSrc` → `prefab create --from-node CaSrc --to Assets/Prefabs/CaP.prefab`（资产初始 pos `0,0,0` scale `1,1,1`）→
`prefab instantiate --asset … --name CaI` → `node set --path CaI --patch '{"position":{"x":5,"y":5,"z":0},"scale":{"x":3,"y":3,"z":1}}'` → `scene save`（`verified:true`）。

## 观测

| 步 | 调用 | 结果 | 证据 |
|---|---|---|---|
| 1 | `PrefabUtility.ApplyPrefabInstance(CaI, AutomatedAction)` + `SaveAssets` | **可调用、不抛异常** | `cb-60-apply.json` |
| 2 | apply 后读资产 | `assetPos="0,0,0"`（**没变**）、`assetScale="3,3,1"`（**变了**：1,1→3,3）；实例 `instPos="5,5,0"`、`instScale="3,3,1"` | 同上 |
| 3 | apply 后 `HasPrefabInstanceAnyOverrides(CaI,false)` | **`false`**（覆盖被清空） | 同上 |
| 4 | apply 后设 `CaI.position=(9,9)`，再 `RevertPrefabInstance(CaI, AutomatedAction)` | `instPosBeforeRevert="9,9"` → `instPosAfterRevert="5,5"`（回到 **5,5**，**不是资产的 0,0**）；`instScaleAfterRevert="3,3"`；`hasOverridesAfterRevert=false` | `cb-61-revert.json` |

## 结论（对 C-B 设计的约束）

1. **`ApplyPrefabInstance` 会应用「属性覆盖」（scale 实测被写入资产），但根 `localPosition` 不被应用**（资产 pos 保持 `0,0,0`，而实例是 `5,5,0`）—— 与 **U39 规则③**「根 `localPosition` 恒被记为 override → 永不跟随」一致。
   → **`prefab apply` 的读回面不得断言「资产根 position == 实例根 position」**（会必假红）。应以 `scale` / `spriteAssetPath` / `components` 等**真正会被 apply 的字段**作为 intent，或显式把根 position 排除在 intent 外并写明。
2. **`RevertPrefabInstance` 回到的是「场景里保存过的实例值」（5,5），不是「资产当前值」（0,0）** —— 因为 apply 已把覆盖清空、而场景保存值仍是 5,5。
   → **`prefab revert` 的读回面同样不能拿「资产值」当 intent**；应以「覆盖数清空（`HasPrefabInstanceAnyOverrides==false`）+ 变换回到某已知基线」为判据，需再设计。
3. 两个 API 都能通过 `unity exec` 调用（无需新 asmdef）；实现时仍应新建 `unity-scripts/prefab-apply.cs`（单 JSON 载荷 + `__error` 哨兵），并遵守「写后必读回」。

## 待 C-B 计划钉死的开放问题

- apply/revert 对**子节点**（非根）的覆盖语义（本轮只测了根）。
- `RevertPrefabInstance` 的可靠判据（覆盖清空 vs 变换基线）。
- 无覆盖时 apply 的行为（no-op 时 `verified` 该是 `true` 还是如实 `false`）。
- 与 `scene save` 的交互（本轮已用 `scene save` 前置，符合 U54）。

---

## 补充侦察（`cb2-*`，子节点覆盖 + 根 scale 覆盖）

设置：`CaSrc` 带子节点 `CaChild` → `prefab create CaP.prefab` → `instantiate CaI` → 覆盖根 `scale=3,3` + 子节点 `CaChild.position=2,2` → `scene save`。

| 步 | 观测 | 证据 |
|---|---|---|
| before apply | inst rootScale `3,3` / childPos `2,2`；asset rootScale `1,1` / childPos `0,0`；`hasOverrides=true` | `cb2-08-before.json` |
| **apply** | asset rootScale→**`3,3`**（写入）、asset childPos→**`2,2`**（写入）；实例不变；`hasOverridesAfterApply=false` | `cb2-09-apply.json` |
| after apply | inst rootScale `3,3` / childPos `2,2`；asset 同；`hasOverrides=false` | `cb2-10-after.json` |
| **revert**（先设 inst rootScale=9,9） | `instScaleAfterRevert=3,3`（**回到资产值**，不是 9,9）；`hasOverridesAfterRevert=false` | `cb2-12-revert.json` |
| after revert | inst/asset rootScale 均 `3,3`、childPos 均 `2,2`；`hasOverrides=false` | `cb2-13-state.json` |

**修正结论（对 §「结论」的细化）**：

1. **apply 会写入**：根 `scale`、子节点 `position/scale`、`sprite`、`components` 等**正常属性覆盖**（`assetRootScale 1,1→3,3`、`assetChildPos 0,0→2,2`）。
   → apply 的读回面可拿「根 scale / spriteAssetPath / components」（**排除根 position**）作为 intent。
2. **apply 不写入根 `localPosition`**（实例 5,5 时资产仍 0,0，`cb-60-apply.json`）；**revert 也不还原根 `localPosition`**（第一次 spike：9,9→5,5 是场景保存值）。
   → **根 `localPosition` 是 apply/revert 的豁免项**（与 U39③ 同源），读回面必须显式排除并文档化。
3. **revert 的可靠判据**：`PrefabUtility.HasPrefabInstanceAnyOverrides(instance, false) == false` **且**（排除根 position 后）实例投影 == 资产投影；根 `scale` 会回到资产值（`3,3`）。
4. **apply 的磁盘防线**：资产文件 mtime 前进（`cb-60-apply.json` 的 `fileMtime`）。

**仍未测**：无覆盖时的 apply（no-op）具体返回值；`--path` 指向非实例的错误码（拟 `NOT_PREFAB_INSTANCE`）。这两条写进 C-B 计划的真机步骤。
