#!/usr/bin/env python3
"""Build SVG engineering sheets, Chinese PDF, Markdown guide and offline index."""
from pathlib import Path
import sys, json, math, html, textwrap, os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import toColor as HexColor
from reportlab.lib.utils import ImageReader
from build_data import ROOT, REED, LED, BOM, STEPS, PRINT_NOTES, CHECKS, SOURCES, write_data

INK='#193239'; TEAL='#137C78'; BLUE='#326DA8'; GRAY='#607780'; LIGHT='#EDF3F2'; RED='#C55343'; GOLD='#A47B25'
pdfmetrics.registerFont(TTFont('ReaderCN',os.environ.get('CJK_FONT','/System/Library/Fonts/STHeiti Light.ttc'),subfontIndex=0))

class Figure:
 def __init__(self,title,w=1000,h=600): self.title=title; self.w=w; self.h=h; self.ops=[]
 def line(self,x1,y1,x2,y2,c=INK,width=2): self.ops.append(('line',(x1,y1,x2,y2,c,width)))
 def rect(self,x,y,w,h,fill='none',stroke=INK,r=0): self.ops.append(('rect',(x,y,w,h,fill,stroke,r)))
 def circle(self,x,y,r,fill='none',stroke=INK): self.ops.append(('circle',(x,y,r,fill,stroke)))
 def text(self,x,y,s,size=19,c=INK,anchor='start'): self.ops.append(('text',(x,y,str(s),size,c,anchor)))
 def poly(self,p,fill=INK,stroke=INK): self.ops.append(('poly',(p,fill,stroke)))
 def arrow(self,x1,y1,x2,y2,c=TEAL):
  self.line(x1,y1,x2,y2,c)
  a=math.atan2(y2-y1,x2-x1); p=[(x2,y2),(x2-9*math.cos(a-.45),y2-9*math.sin(a-.45)),(x2-9*math.cos(a+.45),y2-9*math.sin(a+.45))]
  self.poly(p,c,c)
 def dim(self,x1,y1,x2,y2,s):
  self.line(x1,y1,x2,y2,GRAY,1)
  self.line(x1-4,y1-6,x1+4,y1+6,GRAY,1); self.line(x2-4,y2-6,x2+4,y2+6,GRAY,1)
  self.text((x1+x2)/2,(y1+y2)/2-8,s,18,GRAY,'middle')
 def ground(self,x,y):
  for dy,w in [(0,20),(6,12),(12,4)]: self.line(x-w/2,y+dy,x+w/2,y+dy)
 def resistor(self,x,y,w=60,label='R'):
  self.rect(x,y-9,w,18,'white'); self.text(x+w/2,y-18,label,17,INK,'middle')
 def save(self,name):
  self.filename=name
  out=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}">',f'<title>{html.escape(self.title)}</title>', '<rect width="100%" height="100%" fill="white"/>','<g font-family="PingFang SC,Noto Sans CJK SC,Arial,sans-serif">']
  for kind,a in self.ops:
   if kind=='line':
    x1,y1,x2,y2,c,w=a; out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c}" stroke-width="{w}"/>')
   elif kind=='rect':
    x,y,w,h,f,s,r=a; out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{f}" stroke="{s}" stroke-width="2"/>')
   elif kind=='circle':
    x,y,r,f,s=a; out.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{f}" stroke="{s}" stroke-width="2"/>')
   elif kind=='text':
    x,y,t,size,c,an=a; out.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{c}" text-anchor="{an}">{html.escape(t)}</text>')
   elif kind=='poly':
    p,f,s=a; out.append(f'<polygon points="{" ".join(f"{x},{y}" for x,y in p)}" fill="{f}" stroke="{s}"/>')
  out.append('</g></svg>'); (ROOT/'drawings'/name).write_text('\n'.join(out))
 def pdf(self,c,x,y,width):
  s=width/self.w
  def pt(xx,yy): return x+xx*s,y+(self.h-yy)*s
  for kind,a in self.ops:
   c.setLineWidth(1.2*s)
   if kind=='line':
    x1,y1,x2,y2,col,w=a; c.setStrokeColor(HexColor(col)); c.setLineWidth(w*s); c.line(*pt(x1,y1),*pt(x2,y2))
   elif kind=='rect':
    xx,yy,w,h,f,st,r=a; c.setStrokeColor(HexColor(st)); c.setFillColor(HexColor(f if f!='none' else '#FFFFFF')); xx,yy=pt(xx,yy+h)
    c.roundRect(xx,yy,w*s,h*s,r*s,stroke=1,fill=f!='none')
   elif kind=='circle':
    xx,yy,r,f,st=a; c.setStrokeColor(HexColor(st)); c.setFillColor(HexColor(f if f!='none' else '#FFFFFF')); c.circle(*pt(xx,yy),r*s,stroke=1,fill=f!='none')
   elif kind=='text':
    xx,yy,t,size,col,anchor=a; c.setFillColor(HexColor(col)); c.setFont('ReaderCN',size*s); xx,yy=pt(xx,yy)
    if anchor=='middle': c.drawCentredString(xx,yy,t)
    elif anchor=='end': c.drawRightString(xx,yy,t)
    else: c.drawString(xx,yy,t)
   elif kind=='poly':
    p,f,st=a; c.setStrokeColor(HexColor(st)); c.setFillColor(HexColor(f)); pp=c.beginPath(); pp.moveTo(*pt(*p[0]))
    for q in p[1:]: pp.lineTo(*pt(*q))
    pp.close(); c.drawPath(pp,stroke=1,fill=1)

def figures():
 figs={}
 f=Figure('D01 外形与坐标',1000,760)
 f.text(30,32,'D01 / 外形与装配坐标 · 单位 mm',24)
 x,y,sc=110,80,2.35
 f.rect(x,y,216*sc,184*sc,LIGHT,INK,16)
 for i in range(1,9):
  xx=x+(33+(i-1)%4*50)*sc; yy=y+(184-(128 if i<=4 else 62))*sc
  f.rect(xx-23*sc,yy-21*sc,46*sc,42*sc,'#FAF9F4',GRAY,6)
  f.text(xx,yy+8,str(i),26,INK,'middle'); f.circle(xx+19*sc,yy+26*sc,6,TEAL,TEAL)
 for xx,yy in [(8,8),(108,8),(208,8),(8,176),(108,176),(208,176)]: f.circle(x+xx*sc,y+(184-yy)*sc,4,'white',GRAY)
 f.rect(x+29.5*sc,y+(184-25)*sc,25*sc,14*sc,'#24373F')
 f.text(700,125,'坐标原点：前左下角',21)
 for j,t in enumerate(['X → 右；Y → 后；Z → 上','槽中心 X：33 / 83 / 133 / 183','后排 1-4：Y=128','前排 5-8：Y=62','上盖底面：Z=54','杯缘顶面：Z=59','盖底名义位置：Z=59.4','最高铰链：Z=65.8','底座壁厚 / 底厚：2.4','上盖厚度：3.0']): f.text(660,164+j*29,t,18)
 f.dim(x,y-25,x+216*sc,y-25,'216')
 f.dim(x-35,y,x-35,y+184*sc,'184')
 f.text(110,555,'前侧 / OLED 与提示区',20,TEAL)
 f.rect(110,610,216*sc,54*1.4,'#CBD4D8'); f.rect(110,605,216*sc,5,'#F4F1E8')
 f.dim(110,722,110+216*sc,722,'216')
 f.text(660,636,'高度 65.8（不含脚垫/螺丝头）',19)
 f.text(660,668,'侧面24×14为USB线过线孔',19)
 f.text(660,698,'不是USB-C连接器安装孔',18,RED)
 figs['D01-dimensions.svg']=f

 f=Figure('D02 单格配合与磁铁',1000,690)
 f.text(30,32,'D02 / 单格配合 · 剖面示意，不按比例',24)
 f.rect(70,250,410,24,'#D8E2E0'); f.rect(190,274,170,166,'#F3F0E5'); f.rect(205,274,140,151,'white')
 f.rect(178,238,194,12,'#F3F0E5')
 f.rect(145,208,260,16,'#C4D2CF'); f.rect(130,194,55,30,'#C4D2CF')
 f.rect(140,210,33,10,'#A4A9AB'); f.rect(140,220,33,4,TEAL)
 f.rect(135,238,45,12,'#8BA5A0')
 f.circle(410,210,21,'#D8E2E0'); f.circle(410,210,8,'white')
 f.arrow(100,110,155,211); f.text(45,85,'6×2 磁铁 + 封片',20)
 f.arrow(77,341,150,246); f.text(30,372,'两线干簧管',20)
 f.arrow(463,370,350,426); f.text(390,402,'药杯底厚2',20)
 f.text(70,480,'杯身40×38；上盖孔40.6×38.6',21)
 f.text(70,514,'药杯凸缘44×42；杯身深22；凸缘厚2',20)
 f.text(70,548,'磁铁盲孔Ø6.2；封片Ø6.1×0.65',20)
 f.text(70,582,'磁场距离按实物测试，不能用外形尺寸替代验证',19,RED)
 f.text(575,105,'铰链俯视 / 轴向',22,TEAL)
 f.line(580,207,945,207,GRAY,4)
 f.rect(592,178,63,58,LIGHT); f.rect(665,178,190,58,'#C4D2CF'); f.rect(865,178,63,58,LIGHT)
 f.text(624,266,'固定耳',18,INK,'middle'); f.text(760,266,'盖轴套',18,INK,'middle'); f.text(898,266,'固定耳',18,INK,'middle')
 f.text(580,325,'两固定耳之间26；中轴套长24',19)
 f.text(580,362,'轴向间隙每侧1；孔Ø2.4',19)
 f.text(580,399,'金属销Ø2×45，两端做止退',19)
 f.text(580,460,'先试一个杯 + 一个盖 + 一个传感器',20,TEAL)
 f.text(580,500,'此版自重闭合，无锁扣、无防水密封',18)
 f.text(580,537,'开盖100°是展示角度，不是机械限位',18)
 figs['D02-cell-mechanism.svg']=f

 f=Figure('D03 电气系统总览',1000,670)
 f.text(30,32,'D03 / 电气系统 · ESP32-S3 + 洞洞板',24)
 f.rect(360,190,285,285,LIGHT,TEAL,12); f.text(502,232,'ESP32-S3 开发板',24,INK,'middle')
 f.rect(380,78,245,60,'#F7F4E9',GRAY,8); f.text(502,115,'USB 5V → 板载稳压',21,INK,'middle'); f.arrow(502,138,502,190)
 for j,(title,sub) in enumerate([('8 路无源干簧管','3V3 / 10k下拉 / 1k串联'),('8 路绿色LED','每灯330Ω串联')]):
  yy=205+j*180; f.rect(25,yy,280,115,'white',GRAY,8); f.text(165,yy+40,title,22,INK,'middle'); f.text(165,yy+78,sub,18,GRAY,'middle')
 f.arrow(305,262,360,262,BLUE); f.arrow(360,432,305,432,TEAL)
 for j,(a,b) in enumerate([('OLED：SDA41 / SCL42','VCC=3V3，四线'),('红LED：GPIO39','串联330Ω'),('压电驱动：GPIO40','2N3904 + 外部方波')]):
  yy=180+j*132; f.rect(700,yy,275,93,'white',GRAY,8); f.text(837,yy+37,a,19,INK,'middle'); f.text(837,yy+68,b,17,GRAY,'middle'); f.arrow(645,yy+44,700,yy+44)
 f.text(502,288,'GPIO输入：4,5,6,7',20,BLUE,'middle'); f.text(502,323,'15,16,17,18',20,BLUE,'middle')
 f.text(502,377,'GPIO灯：8,9,10,11',20,TEAL,'middle'); f.text(502,412,'12,13,14,21',20,TEAL,'middle')
 f.line(70,564,930,564,GRAY,3); f.text(502,600,'所有支路共地；外接信号均为3.3V逻辑',21,INK,'middle')
 f.text(502,636,'只从USB单路供电；不同时接另一组5V；本版没有锂电池',19,RED,'middle')
 figs['D03-electrical-overview.svg']=f

 f=Figure('D04 干簧输入与LED单路原理图',1000,660)
 f.text(30,32,'D04 / 每格复制一份 · 输入与指示灯',24)
 f.text(50,108,'3V3',22,RED); f.line(90,125,90,185,RED)
 f.line(90,185,195,185,RED); f.circle(195,185,3,INK); f.circle(250,185,3,INK)
 f.line(195,185,242,155); f.text(185,137,'NO 干簧触点',19)
 f.line(250,185,385,185,BLUE); f.circle(385,185,4,BLUE,BLUE)
 f.line(385,185,485,185,BLUE); f.resistor(485,185,75,'1kΩ'); f.line(560,185,760,185,BLUE)
 f.text(780,192,'GPIO 输入',22,BLUE)
 f.line(385,185,385,255); f.rect(376,255,18,70,'white'); f.text(415,295,'10kΩ 外部下拉',19)
 f.line(385,325,385,357); f.ground(385,357)
 f.text(50,420,'磁铁近 → 触点闭合 → HIGH；移开 → LOW',23,TEAL)
 f.text(50,455,'本版与固件 REED_CLOSED_LEVEL=HIGH 一致',20)
 f.text(50,525,'GPIO 灯输出',20,TEAL); f.line(200,520,295,520,TEAL); f.resistor(295,520,85,'330Ω'); f.line(380,520,500,520,TEAL)
 f.poly([(500,505),(500,535),(525,520)],'white'); f.line(525,505,525,535); f.line(525,520,700,520); f.ground(700,520)
 f.arrow(520,494,545,474); f.arrow(535,504,560,484)
 f.text(490,566,'LED 阳极在左，阴极在右',19)
 f.text(50,623,'不要省略输入下拉；不要直接把LED跨接GPIO与GND',20,RED)
 figs['D04-reed-led-circuit.svg']=f

 f=Figure('D05 压电驱动原理图',1000,650)
 f.text(30,32,'D05 / 无源压电驱动 · 与 tone() 方波配套',24)
 f.text(55,280,'GPIO40',22,TEAL); f.line(160,274,215,274,TEAL); f.resistor(215,274,80,'2.2kΩ'); f.line(295,274,430,274)
 f.circle(430,274,4,INK); f.line(430,274,495,274); f.line(495,237,495,315,INK,3)
 f.line(495,260,550,222); f.line(550,222,550,166); f.text(565,240,'C',21)
 f.line(495,289,550,328); f.arrow(518,305,550,328,INK); f.line(550,328,550,427); f.ground(550,427); f.text(565,350,'E',21)
 f.text(472,227,'B',21); f.text(600,281,'Q1 2N3904',23); f.text(600,314,'核对实物E/B/C脚序',19,RED)
 f.line(430,274,430,340); f.rect(421,340,18,55,'white'); f.text(310,378,'100kΩ',19)
 f.line(430,395,430,419); f.line(430,419,550,419); f.circle(550,419,4,INK)
 f.text(550,86,'3V3',22,RED,'middle'); f.line(550,102,550,127,RED)
 f.line(528,127,572,127); f.line(528,143,572,143); f.line(550,143,550,166)
 f.text(295,137,'无源压电片',20); f.text(295,172,'不替换成电磁线圈',18,RED)
 f.line(550,110,765,110,RED); f.line(765,110,765,135); f.rect(756,135,18,45,'white'); f.text(795,163,'1kΩ',19)
 f.line(765,180,765,200); f.line(765,200,550,200); f.circle(550,200,4,INK); f.circle(550,110,4,RED,RED)
 f.text(58,506,'1kΩ与压电片并联，为关断时放电提供路径。',22)
 f.text(58,546,'2200Hz是现有固件测试频率；响度按所购压电元件实测。',20)
 f.text(58,586,'电源入口：3V3与GND间并100nF和10μF；电解电容注意极性。',20)
 figs['D05-piezo-driver.svg']=f

 f=Figure('D06 线束与针号',1000,650)
 f.text(30,32,'D06 / 线束编号 · 针号是本设计定义',24)
 f.text(40,90,'采购线束两端先用万用表逐针确认；模块端按丝印转接',21,RED)
 for i in range(8):
  yy=130+i*48; f.rect(40,yy,84,32,LIGHT,GRAY,3); f.text(82,yy+23,f'Slot {i+1}',18,INK,'middle')
  f.text(155,yy+23,f'JR{i+1}: 1=3V3  2=RAW{i+1}',18,BLUE)
  f.text(470,yy+23,f'输入 GPIO{REED[i]}',18,BLUE)
  f.text(700,yy+23,f'JL{i+1}: GPIO{LED[i]} → 330Ω → A',18,TEAL)
 f.text(45,563,'全部JL：1=LED阳极A；2=GND阴极K',20)
 f.text(45,599,'JOLED：1=3V3 / 2=GND / 3=SDA41 / 4=SCL42',20)
 f.text(45,635,'JRED：GPIO39；JPIEZO：1=3V3 / 2=Q1集电极；不要直接GPIO',19)
 figs['D06-harness-map.svg']=f

 f=Figure('D07 内部布局',1000,650)
 f.text(30,32,'D07 / 内部布局 · 元件外形仅作安装包络',24)
 f.rect(55,80,540,460,LIGHT,GRAY,14)
 f.rect(95,120,460,330,'#D7E1E4',GRAY,5)
 for xx in range(135,540,70):
  for yy in range(160,430,45): f.rect(xx,yy,40,7,'white',GRAY,3)
 f.rect(150,200,150,175,'#A8C8B8',GRAY,4); f.text(225,273,'分配洞洞板',19,INK,'middle'); f.text(225,307,'60×70',19,INK,'middle')
 f.rect(317,195,200,150,'#A8C8B8',GRAY,4); f.text(417,224,'控制洞洞板80×60',17,INK,'middle')
 f.rect(340,245,155,65,'#333E45',INK,3); f.text(417,285,'ESP32-S3',18,'white','middle')
 f.rect(482,240,52,75,'none',RED,2); f.text(640,190,'天线端靠边，附近不布线/放金属',20,RED); f.arrow(625,198,515,258,RED)
 for xx,yy in [(115,140),(535,140),(115,430),(535,430)]: f.circle(xx,yy,9,'white',INK)
 f.text(640,278,'载板184×132，槽孔可调固定',20)
 f.text(640,321,'载板上表面Z=10',20)
 f.text(640,364,'电子件顶部建议不超过Z=30',20)
 f.text(640,407,'药杯底Z=35，至少留5mm余量',20)
 f.text(640,450,'USB线固定后再经过右侧过线孔',20)
 f.text(65,592,'示意布局不是PCB铜箔图；孔位按实物使用长槽与绝缘隔离柱适配。',21,TEAL)
 figs['D07-electronics-layout.svg']=f

 f=Figure('D08 装配顺序',1000,640)
 f.text(30,32,'D08 / 装配顺序与阶段验收',24)
 names=[('1','试印配合','孔径试片 / 单格架'),('2','验证单格','磁铁 / 干簧 / 一路电路'),('3','扩展八路','焊接 / 线标 / 逐路测试'),('4','底座安装','载板 / 绝缘 / 固定电源线'),('5','上盖安装','传感器 / LED / 屏幕 / 药杯'),('6','联调验收','诊断固件 → 联网固件')]
 for j,(n,a,b) in enumerate(names):
  xx=40+(j%3)*325; yy=100+(j//3)*245
  f.rect(xx,yy,280,190,LIGHT,GRAY,14); f.circle(xx+42,yy+42,23,TEAL,TEAL); f.text(xx+42,yy+50,n,25,'white','middle')
  f.text(xx+25,yy+110,a,25); f.text(xx+25,yy+150,b,18,GRAY)
  if j%3<2: f.arrow(xx+285,yy+95,xx+318,yy+95)
 f.text(40,605,'每一步通过再进入下一步；磁铁封胶与整机打印放在单格验证之后。',21,TEAL)
 figs['D08-assembly-sequence.svg']=f
 return figs

PAGE_W,PAGE_H=595.28,841.89
class Guide:
 def __init__(self,path):
  self.c=canvas.Canvas(str(path),pagesize=(PAGE_W,PAGE_H)); self.page=0; self.y=0; self.records=[]
  self.c.setTitle('Smart Pillbox R1 原型制作与组装手册'); self.c.setAuthor('Smart Pillbox project')
 def new(self,title,kicker='SMART PILLBOX / R1'):
  if self.page: self.c.showPage()
  self.page+=1; c=self.c; c.setFillColor(HexColor(TEAL)); c.rect(0,817,PAGE_W,25,fill=1,stroke=0)
  c.setFont('Helvetica',9); c.setFillColor(HexColor('#FFFFFF')); c.drawString(40,825,kicker)
  c.setFillColor(HexColor(INK)); c.setFont('ReaderCN',22); c.drawString(40,777,title)
  c.setStrokeColor(HexColor('#CEDAD8')); c.line(40,760,555,760)
  c.setFillColor(HexColor(GRAY)); c.setFont('ReaderCN',8); c.drawString(40,25,'R1 · 2026-10-28 · 尺寸单位mm · 实物试装前版本'); c.drawRightString(555,25,str(self.page))
  self.y=738; self.records.append('\n## '+title+'\n')
 def para(self,text,size=11,color=INK,gap=10):
  self.records.append(text+'\n'); c=self.c; c.setFont('ReaderCN',size); c.setFillColor(HexColor(color)); lines=[]; cur=''
  for ch in text:
   if ch=='\n' or pdfmetrics.stringWidth(cur+ch,'ReaderCN',size)>515:
    lines.append(cur); cur='' if ch=='\n' else ch
   else: cur+=ch
  if cur: lines.append(cur)
  for line in lines: c.drawString(40,self.y,line); self.y-=size*1.65
  self.y-=gap
  assert self.y>42, f'Text overflow page {self.page}'
 def table(self,headers,rows,widths,font=9.3):
  self.records.append('| '+' | '.join(headers)+' |\n| '+' | '.join(['---']*len(headers))+' |\n'+'\n'.join('| '+' | '.join(str(v).replace('|','/') for v in row)+' |' for row in rows)+'\n')
  c=self.c; lh=font*1.55
  def wrap(text,w):
   out=[]; t=''
   for ch in str(text):
    if pdfmetrics.stringWidth(t+ch,'ReaderCN',font)>w-12: out.append(t); t=ch
    else: t+=ch
   out.append(t); return out
  for j,row in enumerate([headers]+rows):
   lines=[wrap(t,w) for t,w in zip(row,widths)]; h=max(len(v) for v in lines)*lh+12
   assert self.y-h>42, f'Table overflow page {self.page}: {row}'
   c.setFillColor(HexColor(TEAL if j==0 else ('#EDF3F2' if j%2 else '#FFFFFF'))); c.rect(40,self.y-h,515,h,fill=1,stroke=0)
   x=40
   for ll,w in zip(lines,widths):
    c.setFillColor(HexColor('#FFFFFF' if j==0 else INK)); c.setFont('ReaderCN',font)
    for k,t in enumerate(ll): c.drawString(x+6,self.y-8-font-k*lh,t)
    x+=w
   self.y-=h
  self.y-=15
 def fig(self,f,width=515):
  self.records.append(f'![{f.title}](drawings/{f.filename})\n')
  height=width*f.h/f.w; self.y-=height; f.pdf(self.c,40,self.y,width); self.y-=16
 def image(self,name,height):
  self.records.append(f'![CAD视图](views/{name})\n')
  self.y-=height; self.c.drawImage(str(ROOT/'views'/name),40,self.y,width=515,height=height,preserveAspectRatio=True,anchor='c',mask='auto'); self.y-=16
 def end(self):
  self.c.save(); (ROOT/'ASSEMBLY_GUIDE.md').write_text('# Smart Pillbox R1 组装指南\n'+''.join(self.records))

def build():
 for d in ['drawings','guide','electronics']: (ROOT/d).mkdir(exist_ok=True)
 wiring,params=write_data(); fs=figures()
 for name,f in fs.items(): f.save(name)
 g=Guide(ROOT/'guide/Smart-Pillbox-R1-Assembly-Guide.pdf')
 g.new('从桌面毛坯到可组装原型')
 g.para('这是一套从零采购与制作的工程初版。它把八格翻盖、开盖检测、灯光指引、声音提醒和网页事件回传整合到同一机壳中。',12)
 g.image('01-assembled.png',360)
 g.table(['规格','本版设计'],[['外形','216 × 184 × 65.8mm，不含脚垫和螺丝头'],['结构','8个独立药杯；销轴翻盖；上盖可拆；USB供电'],['输出','17种STL + OpenSCAD源文件 + 8张设计图 + 固件 + BOM'],['状态','网格与数字几何已检查；尺寸配合、电气和磁场待实测']],[88,427])
 g.para('先做单格样件，再打印整机。后续以本包CAD为制作依据；早期AI渲染图仅用于外观方向。',10,TEAL)

 g.new('01 / 制作路线与文件入口')
 g.fig(fs['D08-assembly-sequence.svg'])
 g.para('目录入口：index.html；中文手册：guide/；打印零件：stl/；可修改模型：cad/pillbox.scad；矢量图：drawings/；接线及采购表：electronics/；测试和联网程序：firmware/。')
 g.para('本版采用开发板 + 洞洞板。电气图是可照着焊接的连接设计，载板图是位置规划；未输出定制PCB/Gerber。待实际模块和连接器确定后，才能冻结PCB封装。')
 g.para('本版提供STL和可编辑SCAD源文件；未提供STEP或机器专用G-code。STL需进入实际打印机的切片器，检查方向、支撑、桥接和打印范围。')
 g.para('元件采购以尺寸包络和电气规格为准。标为“采购确认”的项目先拿到数据表或实物，再批量购入。')

 g.new('02 / 采购清单：电子部分')
 g.table(['编号/名称','数量','规格与确认点'],[[r[0]+' '+r[1],r[2],r[3]] for r in BOM[:13]],[135,75,305],9)
 g.para('以上为采购规格，未绑定具体商家SKU。全部接口按3.3V逻辑设计；两线无源干簧管与原项目三线模块的接法不同，见D04。',10,RED)

 g.new('03 / 采购清单：装配与材料')
 g.table(['编号/名称','数量','规格与确认点'],[[r[0]+' '+r[1],r[2],r[3]] for r in BOM[13:]],[135,95,285],9)
 g.para('工具：温控电烙铁、万用表、剥线钳、游标卡尺、内六角/十字螺丝刀、去毛刺工具、小型手钻或铰刀。预压接线束可以减少装配错误。',10)

 g.new('04 / 外形、坐标与接口尺寸')
 g.fig(fs['D01-dimensions.svg'])
 g.para('上盖使用6枚M3×8螺丝，螺母放入底座顶部六角槽。内部电子载板由底座4个支柱支撑。维修从上方拆开，不需要破坏胶粘外壳。')
 g.para('右侧24×14mm开口让整条USB线进入机内，接开发板自身接口。它没有假定某个USB-C插座外形；正式面板接口需根据所购延长线重新建孔。',10,TEAL)

 g.new('05 / 分解结构与零件关系')
 g.image('03-exploded.png',425)
 g.para('从上到下：8个编号盒盖 → 8个独立药杯 → 带传感器槽与固定轴耳的上盖 → 洞洞板/ESP32与通用载板 → 一体底座。销、磁铁、LED和螺丝是另购件。')
 g.para('杯的凸缘挂在上盖孔边；杯底在Z35。载板上表面在Z10，电子总高度限20mm时，杯底下仍有5mm名义净空。线束也不能超过这一包络。')
 g.para('模型中的电子板只表示占位尺寸，不代表可下单的PCB。OLED背板与垫柱在独立STL中，实际垫高按屏幕厚度调整。',10,TEAL)

 g.new('06 / 单格机构与传感器标定')
 g.fig(fs['D02-cell-mechanism.svg'])
 g.para('先试磁场，再封磁铁。干簧管触发受磁铁强度、距离和方向影响；槽位提供初始安装位置，不保证所有磁铁/传感器组合都会触发。')
 g.para('关盖观察稳定HIGH，开盖观察稳定LOW。若失败，先调整方向和垫高；必要时修改局部参数重印。确认相邻磁铁不会把另一格保持在闭合状态。')
 g.para('盖和杯不做气密密封，此版按桌面演示设计。磁铁封片及销端必须固定；运输扣具和防潮结构属于下一版。',10,TEAL)

 g.new('07 / 电气总览与供电')
 g.fig(fs['D03-electrical-overview.svg'])
 g.para('开发板USB输入5V，经板载稳压产生3V3。外接OLED、传感器和压电支路均使用3V3；所有GND相连。不要把5V接到GPIO，也不要同时从USB和外部5V脚供电。')
 g.para('9只LED按每路最大约4.5mA估算，合计约41mA；8路10k下拉在全闭合时约2.6mA；压电放电电阻导通时约3.3mA，另加OLED和开发板自身消耗。实际稳压器余量与温升需按所购板检查。',10)
 g.para('GPIO40用于蜂鸣器，避开新版官方DevKitC-1板载RGB使用的GPIO38。完整引脚依据本包D06，不能把旧接线表中的38直接沿用。',10,RED)

 g.new('08 / 每格电路：开盖输入与LED')
 g.fig(fs['D04-reed-led-circuit.svg'])
 g.para('JR两针接无源常开干簧触点。节点RAW通过10k下拉到GND，再经1k接ESP32输入。输入不依靠内部上拉：关盖触点导通时读取HIGH。')
 g.para('该输入电路复制8份。每只LED单独串330Ω，长脚/封装标识确认阳极；剪脚后不要只靠脚长判断。公共红灯同样串330Ω。')
 g.para('如果采购三针有源模块，需要另外验证3.3V供电、DO输出逻辑和体积；不能直接套用两针线束。优先按本包采购两线封装干簧管。',10,RED)

 g.new('09 / 声音驱动与电源去耦')
 g.fig(fs['D05-piezo-driver.svg'])
 g.para('Q1基极经2.2k接GPIO40，发射极接GND，集电极接压电片负端；压电片正端接3V3。100k从基极接到发射极。压电片两端并联1k，帮助每个方波周期放电。')
 g.para('此图只适用于无源压电元件。若换成电磁蜂鸣器或有源模块，需要按该器件的数据表重新确定驱动、续流与固件信号，不能直接代换。',10,RED)
 g.para('根据采购元件共振频率，可调整BUZZER_TONE_HZ。初版沿用2200Hz，响度是否够用须在实物上测试。')

 g.new('10 / 线束编号与焊接检查')
 g.fig(fs['D06-harness-map.svg'])
 g.para('JR1-JR8为传感器接口；JL1-JL8为绿色灯接口。JOLED的针号是本设计定义，市售屏幕排列可能不同，模块端必须按VCC/GND/SDA/SCL丝印转接。')
 g.para('焊接建议先完成3V3/GND母线，再做每路电阻和连接器。每完成一路就测通断并贴编号。洞洞板不是面包板，孔与孔通常不自动相连。')
 g.para('完整逐线连接表见electronics/wiring.csv。不要按导线颜色猜针号；上盖和底座之间留维修长度，用扎带做拉力固定。',10,TEAL)

 g.new('11 / 内部布局与干涉控制')
 g.fig(fs['D07-electronics-layout.svg'])
 g.para('开发板安装在控制洞洞板或绝缘支架上；通用载板长槽用于调整孔位。不要为了配合渲染图而强行在开发板上钻孔。所有固定件都应避开焊点。')
 g.para('天线端朝机壳外侧，周围保持空旷，按具体模组指南落实天线净空。USB线不要绕过天线；屏幕和蜂鸣器固定在前侧提示区下方。')
 g.para('OLED背板由4枚M2螺丝拉紧，泡棉只负责温和定位。垫柱长度必须让玻璃不受压、显示区贴近窗口；随包6mm垫柱只是试装起点。',10)

 g.new('12 / 打印清单与切片起点')
 names=[('01-base','1','底座'),('02-deck','1','上盖与固定轴耳'),('03-cup','8','演示药杯'),('04-lid-1 … 8','各1','编号盒盖'),('05-magnet-cap','8','磁铁封片'),('06-electronics-carrier','1','通用电子载板'),('07-oled-backplate','1','屏幕背板'),('08-oled-spacer','4','屏幕试装垫柱'),('09-fit-coupon','1','孔径试片'),('10-single-cell-fixture','1','单格验证支架')]
 g.table(['STL文件前缀','数量','用途'],names,[210,50,255],10)
 for p in PRINT_NOTES[:3]: g.para(p,10)
 g.para('STL单位按mm导入，倍率100%。此页数量是单台整机加单格试验；试验件合格后可复用杯、盖与封片。',10,TEAL)

 g.new('13 / 打印方向与尺寸核对')
 for p in PRINT_NOTES[3:]: g.para(p,10.5)
 g.table(['检查项','目标','确认方法'],[[p[0],p[1],p[2]] for p in params[:7]],[90,150,275],9.2)
 g.para('修改模型优先改fit_gap、pin_d、magnet_d、magnet_t、OLED_window等局部参数。整体长宽、排距和杯尺寸存在关联；调整后必须重出模型并检查干涉，不能只拉伸外壳。',10,TEAL)

 g.new('14 / 实际组装：先完成单格')
 for a,b in STEPS[:4]: g.para(a,14,TEAL,4); g.para(b,11,INK,15)
 g.para('在上述四步通过前，不批量封胶，不直接打印整机，也不把磁铁固定到不可拆的位置。',11,TEAL)

 g.new('15 / 实际组装：扩展与合壳')
 for a,b in STEPS[4:]: g.para(a,14,TEAL,4); g.para(b,11,INK,15)

 g.new('16 / 固件、网页与测试流程')
 g.para('先打开firmware/hardware_bringup/hardware_bringup.ino。选择实际ESP32-S3板型，烧录后串口115200。按1-8启动对应格提醒，按0停止，按s打印所有盖状态。诊断程序无需Wi-Fi。')
 g.para('打开目标格：串口只出现一次OPEN、目标灯熄灭、提示音停止。打开其他格：红灯亮、提示音加快，原目标格仍保持提醒。持续开盖不应重复上报；关闭再打开应出现新事件。')
 g.para('OLED缺失不会阻止串口测试。OLED需要SSD1306，地址0x3C；如果实物地址不同，修改初始化位置。所有输入有300ms防抖，过快掀合可能被过滤。')
 g.para('联网页面测试用firmware/integrated_prototype/。将config.example.h复制成config.h，填写Wi-Fi、服务器地址和已注册/已配对设备ID。占位ID不会自动创建云端设备。')
 g.para('联网固件从现有项目生成独立副本，仅启用全部八格并把蜂鸣器改为GPIO40。原项目固件未被改写。库：ArduinoJson 7.x、Adafruit GFX、Adafruit SSD1306；ESP32 core提供WiFi/HTTPClient/Wire。')
 g.para('网页也要允许配置和触发Slot1-8。当前项目包含两格演示账户/路径，八路诊断通过不代表所有网页入口都已支持八格。使用现有已配对账户先验证两格，再确认八格计划和演示入口。',11,RED)
 g.para('网络失败重试使用RAM队列，容量12，上传最多尝试3次；断电会丢失队列。该行为必须在现场演示前理解和测试。开盖事件不代表已吞服。',10)

 g.new('17 / 验收记录与故障定位')
 g.table(['项目','操作','通过条件'],[[r[0],r[1],r[2]] for r in CHECKS],[45,100,370],9.3)
 for t in ['关闭却读LOW：检查干簧朝向、磁铁距离、3V3以及10k下拉接法。','始终HIGH：检查RAW短接3V3、磁铁过强或相邻格干扰。','灯亮错格：检查线束标签和D06的GPIO映射。','蜂鸣器无声：核对GPIO40、Q1脚序、压电器件类型和固件tone频率。','屏幕黑屏：检查3V3、I2C地址、SDA41/SCL42及模块端丝印。','能检测开盖但网页无记录：检查设备ID、API鉴权、服务器地址和网络；先看串口上传响应。']:
  g.para(t,9.8,gap=6)

 g.new('18 / 数字验证、实物边界与后续')
 report=json.loads((ROOT/'validation/mesh-report.json').read_text())
 g.para(f'已导出并检查{len(report)}种STL：封闭网格、边方向一致、单一连通实体、正体积，最大XY尺寸216×184mm。详细结果在validation/mesh-report.json。')
 g.para('数字装配检查：41组实体交集测试通过，包含关盖状态及8个盖分别在0/30/60/90/100度的采样位置。实物的翘曲、收缩、铰链摩擦、磁力和导线弯曲不由该检查证明。')
 g.para('本包所有五张CAD视图直接由同一SCAD源文件渲染；SVG尺寸图按同一组名义尺寸制作。电子元件是包络占位，实物安装孔和PCB布线仍需采购后核对。')
 for name in ['bringup-compile.log','integrated-compile.log']:
  p=ROOT/'validation'/name
  if p.exists() and 'Sketch uses' in p.read_text(): g.para('固件编译通过：'+name+'；ESP32 Arduino core 3.3.11。尚未在实体设备烧录验证。',10,TEAL)
 g.para('必须实测的四项：打印配合、磁场阈值、供电与温升、八格网页联动。通过后，再考虑专用PCB、USB面板接口、锁扣、防潮内胆和电池系统。')
 g.para('本次没有生成G-code、PCB Gerber或量产工艺图；当前文件覆盖的是一台可逐步试制的USB供电桌面功能原型。',10)
 g.para('重新生成：python3 scripts/export_models.py；python3 scripts/validate_meshes.py；使用装有reportlab的Python运行scripts/build_guide.py。OpenSCAD路径可用环境变量OPENSCAD指定。',10)

 g.new('19 / 参考资料与交接')
 for title,url in SOURCES:
  g.para(title,11,TEAL,3); g.para(url,8.4,INK,13)
 g.para('项目依据：hardware/esp32-s3/smart_pillbox_demo/smart_pillbox_demo.ino 的当前引脚、状态逻辑与上传协议。派生记录见validation/firmware-origin.json。')
 g.para('交给打印店：stl/、本手册第12-13节、单格试装要求。交给电子同学：D03-D07、electronics/wiring.csv、BOM.csv和诊断固件。保留cad/源文件用于迭代。')
 g.end()
 write_index(fs)
 print('Created',g.page,'PDF pages and',len(fs),'SVG sheets')

def write_index(fs):
 manifest=json.loads((ROOT/'cad/print-manifest.json').read_text())
 links=''.join(f'<li><a href="{r["file"]}">{Path(r["file"]).name}</a> × {r["quantity"]}</li>' for r in manifest)
 cards=''.join(f'<article><a href="drawings/{n}"><img src="drawings/{n}" alt="{f.title}"></a><h3>{f.title}</h3></article>' for n,f in fs.items())
 views=''.join(f'<article><a href="views/{n}.png"><img src="views/{n}.png" alt="{t}"></a><h3>{t}</h3></article>' for n,t in [('01-assembled','整机CAD'),('02-open-lid','开盖CAD'),('03-exploded','装配分解'),('04-section','内部剖切'),('05-top','俯视')])
 page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart Pillbox 原型制作包 R1</title>
 <style>body{margin:0;background:#f3f6f5;color:#193239;font:16px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1120px;margin:auto;padding:52px 24px}h1{font-size:40px;line-height:1.2}h2{margin-top:48px}a{color:#137c78}nav{display:flex;gap:14px;flex-wrap:wrap}nav a{background:#137c78;color:white;text-decoration:none;padding:10px 18px;border-radius:9px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:20px}article{background:white;border:1px solid #dbe5e2;border-radius:14px;padding:18px}img{width:100%;height:260px;object-fit:contain}small{color:#607780}.note{padding:18px;background:#e3eeeb;border-radius:12px}li{margin:6px 0}code{font-family:monospace}</style>
 <main><small>工程试制版 R1 / 2026-10-28</small><h1>从八格药盒到可组装原型</h1><p>216 × 184 × 65.8 mm · USB供电 · ESP32-S3 · 独立药杯与销轴翻盖</p>
 <nav><a href="guide/Smart-Pillbox-R1-Assembly-Guide.pdf">阅读中文组装手册</a><a href="cad/pillbox.scad">可修改CAD源文件</a><a href="electronics/BOM.csv">采购清单</a><a href="electronics/wiring.csv">逐线接线表</a></nav>
 <p class="note">先打印孔径试片和单格验证架，验证铰链、药杯与磁铁触发，再打印整机。这是工程初版，已做数字网格检查，尚未实物试装。图片来自实际CAD；电子板只表示占位。</p>
 <h2>实际CAD视图</h2><div class="grid">'''+views+'''</div><h2>八张设计图</h2><div class="grid">'''+cards+'''</div>
 <h2>打印零件</h2><p>STL以毫米、100%比例导入。打印方向、支撑、材料见手册。不要把整个装配体一次打印。</p><ul>'''+links+'''</ul>
 <h2>组装与验证文件</h2><ul><li><a href="ASSEMBLY_GUIDE.md">可编辑组装指南</a></li><li><a href="electronics/measurement-checklist.csv">采购尺寸核对表</a></li><li><a href="electronics/acceptance.csv">实物验收记录表</a></li><li><a href="firmware/hardware_bringup/hardware_bringup.ino">无需网络的硬件诊断固件</a></li><li><a href="firmware/integrated_prototype/integrated_prototype.ino">独立八格联网固件</a></li><li><a href="validation/mesh-report.json">STL网格验证报告</a></li></ul>
 <p>本版用洞洞板焊接，不包含PCB Gerber、STEP或机器专用G-code。原项目代码未被修改。完整说明与参考来源见手册。</p></main></html>'''
 (ROOT/'index.html').write_text(page)

if __name__=='__main__': build()
