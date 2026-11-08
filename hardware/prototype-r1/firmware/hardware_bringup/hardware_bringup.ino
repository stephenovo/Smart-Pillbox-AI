/* R1 bench diagnostics. NO Wi-Fi credentials. NO medication schedule.
   2-wire NO reed -> 3V3; node -> 10k GND; node -> 1k -> GPIO.
   Serial 115200: keys 1..8 remind that slot; 0 silence; s print states.
   Optional SSD1306 I2C 0x3C (SDA41/SCL42). Passive piezo through NPN on GPIO40.
*/
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
const uint8_t REED[8]={4,5,6,7,15,16,17,18};
const uint8_t LED[8]={8,9,10,11,12,13,14,21};
const uint8_t BUZZER=40, RED=39;
const unsigned long DEBOUNCE_MS=300;
Adafruit_SSD1306 screen(128,64,&Wire,-1);
bool oled=false, rawClosed[8], closed[8];
unsigned long changed[8]={0}, warningUntil=0;
uint8_t activeSlot=0;

void message(const String& a,const String& b) {
  if(!oled) return;
  screen.clearDisplay(); screen.setTextColor(SSD1306_WHITE);
  screen.setTextSize(1); screen.setCursor(0,0); screen.println(a);
  screen.setTextSize(2); screen.setCursor(0,22); screen.println(b); screen.display();
}
void remind(uint8_t n) {
  activeSlot=n;
  for(int i=0;i<8;i++) digitalWrite(LED[i],n==i+1);
  if(!n) noTone(BUZZER);
  message("BENCH TEST",n ? "SLOT "+String(n) : "READY");
  Serial.printf("TARGET %u\n",n);
}
void setup() {
  Serial.begin(115200);
  for(int i=0;i<8;i++) {
    pinMode(REED[i],INPUT); // external pulldown is mandatory
    pinMode(LED[i],OUTPUT); digitalWrite(LED[i],LOW);
    closed[i]=rawClosed[i]=(digitalRead(REED[i])==HIGH);
  }
  pinMode(RED,OUTPUT); digitalWrite(RED,LOW);
  pinMode(BUZZER,OUTPUT); digitalWrite(BUZZER,LOW);
  Wire.begin(41,42); oled=screen.begin(SSD1306_SWITCHCAPVCC,0x3C);
  remind(0); Serial.println("R1: 1..8 reminder; 0 stop; s status. CLOSED=HIGH.");
}
void loop() {
  unsigned long now=millis();
  if(Serial.available()) {
    char c=Serial.read();
    if(c>='0'&&c<='8') remind(c-'0');
    if(c=='s') for(int i=0;i<8;i++) Serial.printf("Slot %d: %s\n",i+1,closed[i]?"CLOSED":"OPEN");
  }
  for(int i=0;i<8;i++) {
    bool v=digitalRead(REED[i])==HIGH;
    if(v!=rawClosed[i]) { rawClosed[i]=v; changed[i]=now; }
    if(v!=closed[i]&&now-changed[i]>=DEBOUNCE_MS) {
      closed[i]=v; Serial.printf("%lu Slot %d %s\n",now,i+1,v?"CLOSED":"OPEN");
      if(!v&&activeSlot==i+1) { remind(0); message("LID EVENT",String(i+1)+" OPEN"); }
      else if(!v&&activeSlot) { warningUntil=now+1800; message("WRONG SLOT","OPEN "+String(activeSlot)); }
    }
  }
  bool warn=(int32_t)(warningUntil-now)>0;
  digitalWrite(RED,warn);
  bool sound=activeSlot && (warn ? now%250<100 : now%1500<250);
  if(sound) tone(BUZZER,2200); else noTone(BUZZER);
}
