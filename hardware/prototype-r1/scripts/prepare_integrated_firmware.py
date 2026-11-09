#!/usr/bin/env python3
"""Create a separate R1 firmware snapshot. Never edit the project's original."""
from pathlib import Path
import argparse, hashlib, json
ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser(); ap.add_argument('--source',type=Path)
args=ap.parse_args()
repo_root=ROOT.parents[1]
src=(args.source or repo_root/'hardware/esp32-s3/smart_pillbox_demo/smart_pillbox_demo.ino').resolve()
s=src.read_text()
old='true, true, false, false, false, false, false, false'
assert s.count(old)==1 and s.count('constexpr uint8_t BUZZER_PIN = 38;')==1, 'Source changed; review adaptation'
s=s.replace(old,'true, true, true, true, true, true, true, true')
s=s.replace('constexpr uint8_t BUZZER_PIN = 38;','constexpr uint8_t BUZZER_PIN = 40;')
s=s.replace('// The physical demo currently uses Slot 1 and Slot 2.','// R1 build package: eight channels enabled; passive piezo driver on GPIO40.')
out=ROOT/'firmware/integrated_prototype'; out.mkdir(parents=True,exist_ok=True)
(out/'integrated_prototype.ino').write_text(s)
(out/'config.example.h').write_text('''#pragma once
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define SERVER_BASE_URL "https://smartpb.me"
#define DEVICE_ID "YOUR_REGISTERED_DEVICE_ID"
#define DEVICE_API_KEY "YOUR_DEVICE_API_KEY_IF_REQUIRED"
#define FIRMWARE_VERSION "esp32-s3-prototype-r1"
''')
try: source_label=str(src.relative_to(repo_root))
except ValueError: source_label=str(src)
(ROOT/'validation/firmware-origin.json').write_text(json.dumps({
 'source':source_label, 'sha256':hashlib.sha256(src.read_bytes()).hexdigest(),
 'changes':['enable eight channels','buzzer GPIO38 -> GPIO40'],
 'device_registration':'Use an existing paired account or register a device. Placeholder ID will not provision a device.'
},indent=2))
print(out)
