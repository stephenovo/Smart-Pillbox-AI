#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd "${SCRIPT_DIRECTORY}/.." && pwd)"
FIRMWARE_DIRECTORY="${PROJECT_DIRECTORY}/hardware/esp32-s3/smart_pillbox_demo"
CONFIG_FILE="${FIRMWARE_DIRECTORY}/config.h"
BUILD_DIRECTORY="${PROJECT_DIRECTORY}/.arduino-build/smart_pillbox_demo"
DEMO_HTTP_PORT="${DEMO_HTTP_PORT:-3000}"
DEMO_HOST="${DEMO_HOST:-0.0.0.0}"
ESP32_FQBN="esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi"
CONFIGURE_WIFI=0

for argument in "$@"; do
  case "${argument}" in
    --configure-wifi)
      CONFIGURE_WIFI=1
      ;;
    --help|-h)
      cat <<'EOF'
Usage: bash scripts/start-hardware-demo.sh [--configure-wifi]

  --configure-wifi  Securely prompt for the Wi-Fi name and password before
                    compiling and uploading the ESP32 firmware.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: ${argument}" >&2
      exit 1
      ;;
  esac
done

for command_name in arduino-cli npm ifconfig route perl rg awk lsof; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -f "${CONFIG_FILE}" && "${CONFIGURE_WIFI}" != "1" ]]; then
  echo "Missing ${CONFIG_FILE}. Create it from config.example.h first." >&2
  exit 1
fi

NETWORK_INTERFACE="${DEMO_NETWORK_INTERFACE:-}"
if [[ -z "${NETWORK_INTERFACE}" ]]; then
  NETWORK_INTERFACE="$(
    route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true
  )"
fi

if [[ -z "${NETWORK_INTERFACE}" ]] && ifconfig en0 >/dev/null 2>&1; then
  NETWORK_INTERFACE="en0"
fi

if [[ -z "${NETWORK_INTERFACE}" ]]; then
  echo "Could not determine the active network interface." >&2
  exit 1
fi

MAC_LAN_IP="$(ifconfig "${NETWORK_INTERFACE}" | awk '/inet /{print $2; exit}')"
if [[ -z "${MAC_LAN_IP}" || "${MAC_LAN_IP}" == "127.0.0.1" ]]; then
  echo "Could not determine a LAN IP for ${NETWORK_INTERFACE}." >&2
  exit 1
fi

SERVER_URL="http://${MAC_LAN_IP}:${DEMO_HTTP_PORT}"
echo "Using Mac network address: ${SERVER_URL}"

if [[ "${DEMO_DRY_RUN:-0}" == "1" ]]; then
  echo "Dry run complete; config, firmware, and server were not changed."
  exit 0
fi

if [[ "${CONFIGURE_WIFI}" == "1" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Wi-Fi setup needs an interactive terminal so the password can stay hidden." >&2
    exit 1
  fi

  read -r -p "Wi-Fi or hotspot name (SSID): " DEMO_WIFI_SSID
  read -r -s -p "Wi-Fi or hotspot password (hidden): " DEMO_WIFI_PASSWORD
  printf '\n'

  if [[ -z "${DEMO_WIFI_SSID}" ]]; then
    echo "The Wi-Fi name cannot be empty." >&2
    exit 1
  fi

  if [[ ! -f "${CONFIG_FILE}" ]]; then
    cp "${FIRMWARE_DIRECTORY}/config.example.h" "${CONFIG_FILE}"
  fi

  escape_c_string() {
    local escaped_value="$1"
    escaped_value="${escaped_value//\\/\\\\}"
    escaped_value="${escaped_value//\"/\\\"}"
    printf '%s' "${escaped_value}"
  }

  DEMO_WIFI_SSID_ESCAPED="$(escape_c_string "${DEMO_WIFI_SSID}")"
  DEMO_WIFI_PASSWORD_ESCAPED="$(escape_c_string "${DEMO_WIFI_PASSWORD}")"

  if ! rg -q '^#define WIFI_SSID "[^"]*"$' "${CONFIG_FILE}" ||
    ! rg -q '^#define WIFI_PASSWORD "[^"]*"$' "${CONFIG_FILE}"; then
    echo "WIFI_SSID or WIFI_PASSWORD was not found in ${CONFIG_FILE}." >&2
    exit 1
  fi

  DEMO_WIFI_SSID_ESCAPED="${DEMO_WIFI_SSID_ESCAPED}" \
    DEMO_WIFI_PASSWORD_ESCAPED="${DEMO_WIFI_PASSWORD_ESCAPED}" \
    perl -0pi -e \
    's{^#define WIFI_SSID "[^"]*"$}{#define WIFI_SSID "$ENV{DEMO_WIFI_SSID_ESCAPED}"}m;
     s{^#define WIFI_PASSWORD "[^"]*"$}{#define WIFI_PASSWORD "$ENV{DEMO_WIFI_PASSWORD_ESCAPED}"}m' \
    "${CONFIG_FILE}"

  echo "Wi-Fi credentials updated locally for SSID: ${DEMO_WIFI_SSID}"
  echo "The password was hidden and config.h remains excluded from Git."
  unset DEMO_WIFI_PASSWORD DEMO_WIFI_PASSWORD_ESCAPED
fi

if lsof -nP -iTCP:"${DEMO_HTTP_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${DEMO_HTTP_PORT} is already in use. Stop the existing server and rerun." >&2
  exit 1
fi

if ! rg -q '^#define SERVER_BASE_URL "[^"]+"$' "${CONFIG_FILE}"; then
  echo "SERVER_BASE_URL was not found in ${CONFIG_FILE}." >&2
  exit 1
fi

DEMO_SERVER_URL="${SERVER_URL}" perl -0pi -e \
  's{^#define SERVER_BASE_URL "[^"]+"$}{#define SERVER_BASE_URL "$ENV{DEMO_SERVER_URL}"}m' \
  "${CONFIG_FILE}"

ESP32_SERIAL_PORT="${ESP32_PORT:-}"
if [[ -z "${ESP32_SERIAL_PORT}" ]]; then
  shopt -s nullglob
  SERIAL_PORTS=(/dev/cu.usbmodem*)
  shopt -u nullglob

  if [[ "${#SERIAL_PORTS[@]}" -eq 0 ]]; then
    echo "No ESP32 serial port found. Connect its Type-C data cable and retry." >&2
    exit 1
  fi
  if [[ "${#SERIAL_PORTS[@]}" -gt 1 ]]; then
    echo "Multiple ESP32 ports found. Run with ESP32_PORT=/dev/cu.usbmodem..." >&2
    printf '  %s\n' "${SERIAL_PORTS[@]}" >&2
    exit 1
  fi
  ESP32_SERIAL_PORT="${SERIAL_PORTS[0]}"
fi

echo "Compiling the two-slot ESP32 firmware..."
arduino-cli compile \
  --fqbn "${ESP32_FQBN}" \
  --build-path "${BUILD_DIRECTORY}" \
  "${FIRMWARE_DIRECTORY}"

echo "Uploading firmware through ${ESP32_SERIAL_PORT}..."
arduino-cli upload \
  -p "${ESP32_SERIAL_PORT}" \
  --fqbn "${ESP32_FQBN}" \
  --input-dir "${BUILD_DIRECTORY}" \
  "${FIRMWARE_DIRECTORY}"

echo "Hardware demo ready: http://localhost:${DEMO_HTTP_PORT}/dashboard"
echo "Keep this terminal open. Press Control-C after the demo."
cd "${PROJECT_DIRECTORY}"
exec npm run dev:webpack -- -H "${DEMO_HOST}" -p "${DEMO_HTTP_PORT}"
