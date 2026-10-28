// Smart Pillbox engineering prototype R1 / 2026-10-28 / units: mm
// Source of truth for printable geometry. See README and assembly guide.
// No medicine-contact qualification; cups are demonstration geometry.
part = "assembly";
slot_number = 1;
explode = 0;
open_angle = 0;
$fn = 48;

W = 216;
D = 184;
base_h = 54;
wall = 2.4;
floor_t = 2.4;
deck_t = 3;
cell_pitch_x = 50;
cell_pitch_y = 66;
cell_x0 = 33;
cell_y0 = 62;
cup_w = 40;
cup_d = 38;
cup_depth = 22;
cup_wall = 2;
flange_t = 2;
fit_gap = 0.30; // per side of cup, validate with coupon
lid_gap = 0.40; // vertical clearance above cup flange
lid_t = 2.4;
hinge_y = 24.5;
hinge_r = 3.2;
pin_d = 2.4; // clearance bore for a purchased 2.0 mm rod
nut_hex_d = 6.7; // hex recess across corners; use fit coupon first
magnet_d = 6;
magnet_t = 2;
magnet_gap = 0.20; // diametral clearance
reed_len = 22;
reed_w = 5;
reed_depth = 2;
led_d = 5.2;
OLED_window = [25,14];
eps = 0.02;
fasteners = [[8,8],[W/2,8],[W-8,8],[8,D-8],[W/2,D-8],[W-8,D-8]];
carrier_mounts = [[24,44],[192,44],[24,160],[192,160]];
deck_z = base_h;
cup_z = deck_z + deck_t - cup_depth;
lid_z = deck_z + deck_t + flange_t + lid_gap;
axis_z = deck_t + flange_t + lid_gap + hinge_r;

assert(W >= 212 && D >= 174, "Envelope too small for the fixed component layout");
assert(fit_gap >= 0.15 && fit_gap <= 0.6, "Validate cup clearance first");
assert(pin_d > 2 && pin_d < 3, "2 mm hinge rod requires clearance bore");

function cx(i) = cell_x0 + ((i-1)%4)*cell_pitch_x;
function cy(i) = cell_y0 + (i<=4 ? cell_pitch_y : 0);

module rr(w,d,h,r=3) {
  linear_extrude(height=h) hull()
    for(x=[r,w-r],y=[r,d-r]) translate([x,y]) circle(r=r);
}
module centered_rr(w,d,h,r=3) { translate([-w/2,-d/2,0]) rr(w,d,h,r); }
module hole(x,y,z,h,d) { translate([x,y,z]) cylinder(h=h,d=d); }
module slot_hole(x,y,z,len,d,h) {
  hull() for(dx=[-len/2,len/2]) hole(x+dx,y,z,h,d);
}
module hinge_barrel(x,len,z) {
  translate([x,hinge_y,z]) rotate([0,90,0]) cylinder(h=len,r=hinge_r);
}

module base() {
  difference() {
    union() {
      difference() {
        rr(W,D,base_h,7);
        translate([wall,wall,floor_t]) rr(W-2*wall,D-2*wall,base_h,4.6);
      }
      for(p=fasteners) hole(p[0],p[1],0,base_h,12.6);
      for(p=carrier_mounts) hole(p[0],p[1],0,8,10);
    }
    for(p=fasteners) {
      hole(p[0],p[1],base_h-13,14,3.4);
      translate([p[0],p[1],base_h-2.7]) cylinder(h=2.8,d=nut_hex_d,$fn=6);
    }
    for(p=carrier_mounts) hole(p[0],p[1],-eps,9,3.4);
    // USB cable pass-through, NOT a nominal USB-C panel connector footprint.
    translate([W-wall-1,44,11]) cube([wall+2,24,14]);
  }
}

module fixed_hinge() {
  difference() {
    union() {
      for(x=[-21,13]) {
        translate([x,hinge_y-3,deck_t-eps]) cube([8,6,axis_z-deck_t]);
        hinge_barrel(x,8,axis_z);
      }
    }
    translate([-23,hinge_y,axis_z]) rotate([0,90,0]) cylinder(h=46,d=pin_d);
  }
}

module cell_cuts() {
  translate([-(cup_w+2*fit_gap)/2,-(cup_d+2*fit_gap)/2,-eps])
    rr(cup_w+2*fit_gap,cup_d+2*fit_gap,deck_t+2*eps,2.3);
  // Encapsulated reed lies horizontally in the top recess under the lid tab.
  translate([-reed_len/2,-26-reed_w/2,deck_t-reed_depth])
    rr(reed_len,reed_w,reed_depth+eps,1);
  for(x=[-12.5,12.5]) hole(x,-26,-eps,deck_t+2*eps,2.5);
  hole(19,-26,-eps,deck_t+2*eps,led_d);
}

module deck() {
  difference() {
    union() {
      rr(W,D,deck_t,7);
      for(i=[1:8]) translate([cx(i),cy(i),0]) fixed_hinge();
    }
    for(i=[1:8]) translate([cx(i),cy(i),0]) cell_cuts();
    for(p=fasteners) hole(p[0],p[1],-eps,deck_t+2*eps,3.4);
    translate([42-OLED_window[0]/2,18-OLED_window[1]/2,-eps])
      rr(OLED_window[0],OLED_window[1],deck_t+2*eps,1);
    for(x=[22,62],y=[6,30]) hole(x,y,-eps,deck_t+2*eps,2.4);
    hole(153,21,-eps,deck_t+2*eps,led_d);
    for(x=[174:4:186],y=[17:4:25]) hole(x,y,-eps,deck_t+2*eps,2);
  }
}

module cup() {
  difference() {
    union() {
      centered_rr(cup_w,cup_d,cup_depth+eps,2);
      translate([0,0,cup_depth]) centered_rr(cup_w+4,cup_d+4,flange_t,3);
    }
    translate([0,0,cup_wall])
      centered_rr(cup_w-2*cup_wall,cup_d-2*cup_wall,cup_depth+flange_t,1);
  }
}

module lid(n=1) {
  difference() {
    union() {
      translate([0,-1,0]) centered_rr(cup_w+6,cup_d+4,lid_t,3);
      translate([-12,18,0]) cube([24,hinge_y-18,lid_t]);
      hinge_barrel(-12,24,hinge_r);
      translate([0,-25,0]) centered_rr(16,12,4.5,3);
    }
    translate([-13,hinge_y,hinge_r]) rotate([0,90,0]) cylinder(h=26,d=pin_d);
    // Blind recess opens from underside. Retain magnet with separate disk + adhesive.
    hole(0,-26,-eps,magnet_t+0.85,magnet_d+magnet_gap);
    translate([0,-1,lid_t-0.5]) linear_extrude(height=0.6)
      text(str(n),size=11,halign="center",valign="center",font="Liberation Sans:style=Bold");
  }
}

module magnet_cap() { cylinder(h=0.65,d=magnet_d+magnet_gap-0.10); }

module carrier() {
  difference() {
    translate([16,36,0]) rr(184,132,2,3);
    for(p=carrier_mounts) hole(p[0],p[1],-eps,2.1,3.4);
    for(x=[42:28:182],y=[56:18:146]) slot_hole(x,y,-eps,16,3.4,2.1);
  }
}

// Universal OLED backing plate, insulating foam pads take up stack variations.
// Board <= 34 x 26 mm; no assumption about the board's own screw pattern.
module oled_backplate() {
  difference() {
    centered_rr(46,30,2.4,3);
    for(x=[-20,20],y=[-12,12]) hole(x,y,-eps,2.5,2.4);
    translate([-8,-7,-eps]) rr(16,14,2.5,2);
    for(x=[-16,16]) slot_hole(x,0,-eps,0,4,2.5);
  }
}

module spacer() { difference() { cylinder(h=6,d=6); cylinder(h=6.1,d=2.4); } }

module coupon() {
  difference() {
    rr(92,62,5,3);
    for(j=[0:3]) hole(12+j*20,12,-eps,5.1,2.1+j*0.1);
    for(j=[0:2]) hole(15+j*25,27,1,4.1,6.1+j*0.1);
    for(j=[0:2]) {
      hole(15+j*25,47,-eps,5.1,3.4);
      translate([15+j*25,47,2.3]) cylinder(h=2.8,d=6.5+j*0.2,$fn=6);
      translate([15+j*25,57,4.5]) linear_extrude(height=0.6)
        text(str(6.5+j*0.2),size=3,halign="center");
    }
    for(j=[0:3]) translate([12+j*20,4,4.5]) linear_extrude(height=0.6)
      text(str(2.1+j*0.1),size=3,halign="center");
  }
}

module one_cell_fixture() {
  difference() {
    union() {
      centered_rr(50,66,deck_t,3);
      fixed_hinge();
      // Two ribs outside the cup provide freestanding test support.
      for(x=[-24.5,22.5]) translate([x,-28,-25]) cube([2,56,25+eps]);
    }
    cell_cuts();
  }
}

module electronics_visual() {
  // Envelope placeholders only; not PCB fabrication data.
  color([0.1,0.40,0.28]) translate([105,54,16]) cube([80,60,1.6]);
  color([0.13,0.15,0.16]) translate([120,64,20]) cube([62,26,2]);
  color([0.65,0.67,0.7]) translate([145,68,22]) cube([20,18,3]);
  color([0.1,0.40,0.28]) translate([38,74,16]) cube([60,70,1.6]);
  color([0.08,0.1,0.12]) translate([180,21,deck_z-12]) cylinder(d=14,h=10);
  color([0.08,0.1,0.12]) translate([42,18,deck_z-3]) centered_rr(28,26,3,1);
}

module assembly(ex=0) {
  color([0.62,0.65,0.68]) base();
  color([0.74,0.78,0.80]) translate([0,0,8+ex*0.3]) carrier();
  translate([0,0,ex*0.3]) electronics_visual();
  color([0.92,0.91,0.87]) translate([0,0,deck_z+ex]) deck();
  for(i=[1:8]) {
    color([0.95,0.94,0.90]) translate([cx(i),cy(i),cup_z+ex*1.7]) cup();
    color([0.87,0.90,0.88]) translate([cx(i),cy(i),lid_z+ex*2.5])
      translate([0,hinge_y,hinge_r]) rotate([i==3 ? -open_angle : 0,0,0])
      translate([0,-hinge_y,-hinge_r]) lid(i);
    color(i==3 ? [0.1,0.8,0.4] : [0.15,0.3,0.22])
      translate([cx(i)+19,cy(i)-26,deck_z+deck_t+ex]) sphere(d=4.8);
  }
}

module posed_lid(i,angle=0) {
  translate([cx(i),cy(i),lid_z]) translate([0,hinge_y,hinge_r])
    rotate([-angle,0,0]) translate([0,-hinge_y,-hinge_r]) lid(i);
}

if(part=="base") base();
else if(part=="deck") deck();
else if(part=="cup") cup();
else if(part=="lid") lid(slot_number);
else if(part=="magnet_cap") magnet_cap();
else if(part=="carrier") translate([-16,-36,0]) carrier();
else if(part=="oled_backplate") oled_backplate();
else if(part=="spacer") spacer();
else if(part=="coupon") coupon();
else if(part=="one_cell_fixture") translate([0,0,25]) one_cell_fixture();
else if(part=="assembly") assembly(explode);
else if(part=="interference") union() {
  for(i=[1:8]) {
    intersection() { translate([0,0,deck_z]) deck(); translate([cx(i),cy(i),lid_z]) lid(i); }
    intersection() { base(); translate([cx(i),cy(i),cup_z]) cup(); }
    intersection() { translate([cx(i),cy(i),cup_z]) cup(); translate([cx(i),cy(i),lid_z]) lid(i); }
  }
}
else if(part=="motion_interference") intersection() {
  posed_lid(slot_number,open_angle);
  union() {
    translate([0,0,deck_z]) deck();
    for(i=[1:8]) translate([cx(i),cy(i),cup_z]) cup();
    for(i=[1:8]) if(i!=slot_number) posed_lid(i,0);
  }
}
else if(part=="section") intersection() { assembly(0); translate([-1,-1,-1]) cube([W/2+1,D+2,150]); }
else assert(false,"Unknown part");
