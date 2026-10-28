# Smart Pillbox 原型制作包 R1

日期：2026-10-28。适用于从零采购、逐步试制一台八格USB供电桌面功能原型。

## 从这里开始

1. 打开 `index.html` 浏览所有CAD视图和设计图。
2. 阅读 `guide/Smart-Pillbox-R1-Assembly-Guide.pdf`（中文手册）。
3. 按 `electronics/BOM.csv` 准备单格所需部件；带“采购确认”的规格先核实。
4. **先打印** `09-fit-coupon.stl`、`10-single-cell-fixture.stl`、`03-cup.stl`、`04-lid-1.stl`、`05-magnet-cap.stl`。
5. 完成试装、磁场和单路通电测试后，再打印其余零件。不要直接给整机批量封胶。

## 本包交付

| 目录 | 内容 | 给谁用 |
|---|---|---|
| `cad/` | 参数化OpenSCAD源文件、打印数量清单 | 建模/打印同学 |
| `stl/` | 17种可导入切片器的零件文件（含8个编号盖） | 打印店 |
| `views/` | 同一CAD源文件生成的整机、开盖、爆炸、剖切、俯视图 | 全体 |
| `drawings/` | 8张可缩放SVG工程说明图 | 结构/电气装配 |
| `electronics/` | BOM、逐线接线表、尺寸确认表、验收表 | 采购/焊接 |
| `firmware/` | 离线硬件诊断、独立八格联网固件、配置模板 | 固件/软件 |
| `guide/` | 中文PDF组装手册 | 全体 |
| `scripts/` | 可重复生成CAD、验证、图纸和手册的脚本 | 后续维护 |
| `validation/` | STL、数字干涉与编译检查记录 | 复核 |

## 初版规格

- 总体216×184×65.8mm，不含脚垫和螺丝头；建议256×256mm打印平台。
- 独立药杯主体40×38mm，凸缘44×42mm，高24mm；内腔约36×34×22mm。
- 2mm金属铰链销；6×2mm磁铁；两线无源常开干簧管。
- USB从开发板供电。GPIO40驱动压电蜂鸣器，避开新版官方板GPIO38板载灯。
- 结构采用一体底座与可拆上盖；本版自重闭合，无锁扣、防水或电池。
- 本版打印药杯仅用于惰性演示物。真实储药需合适材料的内胆并重新验证。

## 文件成熟度

这是有实际几何、接线设计与可编译固件的工程初版；**尚未完成实体试印与通电验收**。CAD网格检查不证明打印收缩、磁场触发或实物安装尺寸。电子板只是尺寸占位，不是定制PCB。

本版采用洞洞板，无需Gerber；未提供STEP或打印机专用G-code。可编辑源文件是SCAD，打印交换文件是STL。不能把先前AI外观渲染的尺寸当作加工尺寸。

## 重新生成与修改

软件依赖：OpenSCAD 2026.06.12（本次使用版本）、Python 3.12；文档生成另需reportlab；默认嵌入Mac系统中文字体。其他系统通过环境变量CJK_FONT指定可嵌入的中文TrueType字体路径。导出和验证脚本本身使用Python标准库。

```bash
python3 scripts/export_models.py
python3 scripts/validate_meshes.py
python3 scripts/check_assembly.py
python3 scripts/build_guide.py
```

可用环境变量 `OPENSCAD` 指定可执行文件。Mac默认路径为 `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD`。Windows/Linux需正确配置PATH或该变量。

打开 `cad/pillbox.scad` 修改 `part` 可预览独立零件。修改 `fit_gap`、`pin_d`、磁铁参数与OLED窗口后需重新导出；整机长宽、杯尺寸和排距相互关联，不要只改一处就打印。

## 固件

先用 `hardware_bringup`：串口115200，1-8触发提醒，0停止，s查看状态，无需网络。

`integrated_prototype` 是原项目固件的独立副本，启用8格并将蜂鸣器38改为40。将其中 `config.example.h` 复制为 `config.h`，填入自己Wi-Fi与已配对的设备账户。不要公开包含凭据的config.h。

现有云端/网页包含两格演示路径，使用前要确认具体账户和页面支持所需Slot。诊断固件可独立验收8路；八格网页闭环需要实际联调。

原项目固件没有被本包改写。若原项目后来更新，可在项目中运行 `scripts/prepare_integrated_firmware.py` 重新生成；脚本会检查预期文本，避免静默套错版本。

## 加工交接顺序

给打印店：第12-13节、stl目录、单格优先要求。给焊接同学：D03-D07、BOM和wiring.csv。给软件同学：两份固件和原项目接口文档。全部使用mm与100%比例。

参考资料完整链接在手册最后一页。实物验收逐项填写 `electronics/acceptance.csv`，再冻结下一版结构与电路。
