# Smart Pillbox 概念渲染 v1

生成日期：2026-10-27

使用内置 image_gen 工具生成。以下图片用于造型及结构讨论，不是已验证尺寸的 CAD、STL 或电路设计；灯光状态仅为视觉示意。

- 01-exterior.png：八格整机外观，白色 FDM 质感上壳与灰色底座。
- 02-open-lid.png：第 3 格打开，展示内胆与盖内磁铁。
- 03-exploded.png：上框及盒盖、药格内胆、电子仓、底盖的分层概念。

下一步应测量实物模块、确认传感器位置、单格试装，再建立参数化 CAD。

## 完整生成提示词

### 01 整机

Use case: product-mockup. Asset type: first of a coherent three-image industrial design concept series for an ESP32 smart pillbox prototype, not a manufacturing drawing.
Create a highly realistic 3D studio render of a physically plausible FDM 3D-printed desktop smart pillbox. Single object, elevated front three-quarter view, entire object visible with comfortable margins, landscape composition on warm light gray studio background with soft grounded shadow.
Design: compact rounded rectangular enclosure approximately 220 mm wide, 160 mm deep, 55 mm high as conceptual proportions, matte warm-white printed upper housing, very light cool-gray detachable electronics base with a subtle horizontal seam and accessible screws. Fine visible horizontal FDM layer lines, softened edges, practical prototype construction, not glossy injection molded plastic.
Exactly EIGHT independent rectangular flip lids arranged FOUR COLUMNS by TWO ROWS. Back row numbered 1,2,3,4 left to right; front row 5,6,7,8 left to right. All eight lids closed. Each lid matte warm white, small rear hinge, generous front finger tab, engraved dark gray number. Fixed frame has a small green indicator next to each respective compartment, only slot 3 illuminated softly. Lid hinges belong to their individual rows.
Along the FRONT of the enclosure, below the grid, one slim integrated control strip: small black 0.96-inch OLED window towards the left showing only 'OPEN SLOT 3' in clean white letters; one tiny red warning indicator and small buzzer perforations towards the right. No buttons, cameras, motors, locks or touchscreen. One USB-C power opening on the right side of electronics base. Tasteful subtle 'SMART PILLBOX' text on front bezel.
Prioritize legible eight-cell layout, easy-open tabs for older hands, believable enclosure wall thickness and realistic home-lab fabrication. No wires exposed outside, no pills scattered around, no person, no decorative props, no dimensions, no leader lines, no poster titles. Restrained product design photography lighting, sharp high detail.

### 02 开盖（参考 01）

Use case: product-mockup. Create the second image in a coherent industrial-design series. Input image is the exact design reference; preserve this SAME smart pillbox, eight compartments in FOUR columns and TWO rows, numbering 1–4 back row and 5–8 front row, warm white fine-layer FDM printed upper frame, gray detachable base, hinge/tab style, front OLED, front buzzer perforations, USB-C on right, materials and proportions. Render a slightly higher-angle front-right three-quarter view, entire device visible on neutral studio backdrop. Change the physical state: open ONLY compartment 3, its lid rotated backwards around its rear hinge to about 100 degrees, remaining SEVEN lids closed and correctly numbered. Clearly show inside compartment 3: a smooth removable white storage cup with two small unmarked inert demonstration tablets. Show small captive round magnet recessed on the underside near the lid's front edge and corresponding tiny sensor window in the fixed front rim. Keep electronics and wiring entirely hidden from medicine compartment. Green indicator for slot 3 softly lit, all other green indicators and red warning light OFF. OLED exact text 'SLOT 3 OPENED'. This is an assembly concept, not a medical claim or technical drawing. Soft studio shadows, realistic FDM striations, physically plausible hinge, restrained product render. No callouts, dimensions, collage, people, extra cells or redesigned controls.

### 03 爆炸图（参考 01）

Use case: product-mockup. Create the third image in an industrial design concept series: a polished yet physically plausible EXPLODED ASSEMBLY 3D render of the EXACT same smart pillbox in the input reference. Preserve warm-white fine FDM printed enclosure, light-gray electronics base, FOUR columns by TWO rows of exactly eight numbered independent lids, proportions, front-left small OLED and front-right red indicator and buzzer perforations, side USB-C. Portrait-ish or square composition with ample space for vertical exploded stack, neutral warm light gray studio background, all parts in consistent elevated front-right three-quarter perspective.
Explode into FOUR neatly vertically aligned major assemblies with clear gaps:
TOP: the complete warm-white upper frame with all eight closed flip lids labeled 1,2,3,4 in back row and 5,6,7,8 front row, tiny fixed-frame LEDs and integrated front control bezel. It is lifted off the next assembly.
SECOND: a single removable white eight-well medicine tray, exactly four by two wells, solid cup bottoms isolating medicines from electronics, sized to nest directly below the eight lids.
THIRD: light-gray electronics tub with believable screw posts, an ESP32-S3 development board with rectangular RF shield on a compact green carrier PCB, eight small connector groups, a few organized wiring harnesses around the perimeter to small sensor boards, a small black buzzer, and the rear of small OLED at front-left. Hardware is schematic concept only, do not pretend exact circuit design. All electronics stay BELOW the solid medicine tray. No battery, no motors, no cameras. ESP32 antenna end faces the outer wall with open space around it.
BOTTOM: removable light-gray flat bottom cover with four screw holes, four black rubber feet and a few separated screws vertically aligned to bosses.
Maintain obvious assembly correspondence between layers. No duplicated extra lids, no excess compartments, no chaotic wires. Fine FDM texture on printed parts, real connector and screw details, subtle shadows, no dimension arrows, labels, captions or engineering certification claims.

### 03 最终修订（参考首次爆炸图）

Use case: precise-object-edit. Edit this exploded smart pillbox assembly render, keeping camera, material, eight-lid numbering, eight-well tray, PCB, layout, background and four-layer stack unchanged. Correct ONLY duplicated control components so the exploded assembly makes physical sense: on the TOP suspended eight-lid cover, replace the glowing OLED display with a plain empty rectangular bezel opening (a dark hollow aperture, no screen, no lettering or emitted light). Replace the glowing red warning LED in that same suspended top cover with an empty small round hole. Replace its right-side USB-C socket with a plain blank wall: the only USB-C should be on the gray electronics tub below. The actual single OLED and actual warning LED remain mounted in the lower gray electronics tub as shown, and will align behind the upper cover openings when assembled. Turn all green indicator lights in the suspended top cover off, retaining their green lenses. Do not add or remove any medicine cells or lids. Keep this a beautiful detailed fine-layer FDM 3D-printed prototype render.
