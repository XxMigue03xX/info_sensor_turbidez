#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>

#ifdef ARDUINO_ARCH_ESP32
  #include "esp_adc_cal.h"
#endif

/***** CONFIGURACIÓN *****/
// --- WiFi ---
const char* WIFI_SSID = "Nada que"; 
const char* WIFI_PASS = "Ver aqui"; 

// --- API ---
// Ej.: "http://192.168.1.50/info_sensor_turbidez/api"  (NO usar localhost desde el ESP32)
String BASE_URL = "http://10.132.66.205/info_sensor_turbidez/api";
String AUTH_TOKEN = ""; // X-Auth-Token
String DEVICE_ID_PARAM = ""; // opcional, p.ej. "esp32-lab" (vacío para omitir)

// --- Muestreo/tiempos (mantener en sync con el simulador) ---
static const uint32_t STEP_MS = 5000;      // cada 5 s
static const uint16_t COUNT   = 60;        // 60 lecturas -> ~5 min
static const uint16_t pollSec = 5;         // polling cuando idle
static const uint16_t postSleepSec = 60;   // espera después de POST /session

// --- ADC / Sensor ---
static const int PIN_TURBIDITY = 34; // ADC1_6 (GPIO34 es sólo entrada, recomendado)
static const adc_attenuation_t ADC_ATT = ADC_11db; // ~0..3.6V
static const uint8_t ADC_BITS = 12; // 0..4095
static const uint8_t ADC_SAMPLES = 20; // promedio para reducir ruido
// Si su referencia real difiere, ajuste ADC_VREF_MV.
static const uint16_t ADC_VREF_MV = 3300; // milivoltios a full-scale a efecto de cálculo si no hay calibración

// --- NTP ---
static const long  GMT_OFFSET_SEC = 0;     // usar UTC
static const int   DST_OFFSET_SEC = 0;
static const char* NTP_SERVER     = "pool.ntp.org";

/***** UTILIDADES DE TIEMPO *****/
uint64_t nowEpochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr); // tv_sec (s), tv_usec (us)
  return (uint64_t)tv.tv_sec * 1000ULL + (uint64_t)(tv.tv_usec / 1000ULL);
}

uint64_t alignNextTickMs(uint64_t ms, uint32_t stepMs) {
  uint64_t rem = ms % stepMs;
  return rem == 0 ? ms : (ms + (stepMs - rem));
}

void sleepUntil(uint64_t targetMs) {
  while (true) {
    uint64_t now = nowEpochMs();
    if (now + 2 >= targetMs) break; // margen 2 ms
    uint64_t diff = targetMs - now;
    // dividir en porciones para no bloquear watchdog
    if (diff > 100) delay( (diff > 1000) ? 100 : (uint32_t)diff );
    else delay((uint32_t)diff);
  }
}

/***** RED Y HTTP *****/
void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Conectando a WiFi "); Serial.print(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint8_t tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 60) { // ~30 s
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK. IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi FAIL. Reintentando luego...");
  }
}

bool httpGET_JSON(const String& url, const String& token, DynamicJsonDocument& outDoc, uint16_t timeoutMs = 10000) {
  HTTPClient http;
  http.setTimeout(timeoutMs);
  http.begin(url);
  http.addHeader("X-Auth-Token", token);
  int code = http.GET();
  if (code > 0 && code / 100 == 2) {
    DeserializationError err = deserializeJson(outDoc, http.getStream());
    http.end();
    if (err) {
      Serial.print("JSON GET parse error: "); Serial.println(err.c_str());
      return false;
    }
    return true;
  } else {
    Serial.print("HTTP GET error: "); Serial.print(code); Serial.print(" -> "); Serial.println(http.getString());
    http.end();
    return false;
  }
}

bool httpPOST_JSON(const String& url, const String& token, const String& payload, String& resp, uint16_t timeoutMs = 15000) {
  HTTPClient http;
  http.setTimeout(timeoutMs);
  http.begin(url);
  http.addHeader("X-Auth-Token", token);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST((uint8_t*)payload.c_str(), payload.length());
  if (code > 0) {
    resp = http.getString();
  } else {
    resp = String("HTTP POST error: ") + code;
  }
  http.end();
  return (code / 100) == 2;
}

/***** ADC y conversión NTU *****/
uint16_t analogReadMilliVoltsAveraged(int pin, uint8_t samples) {
  uint32_t acc = 0;
  for (uint8_t i = 0; i < samples; ++i) {
  #ifdef ARDUINO_ARCH_ESP32
    acc += analogReadMilliVolts(pin);
  #else
    acc += (uint32_t)analogRead(pin) * ADC_VREF_MV / ((1 << ADC_BITS) - 1);
  #endif
    delay(2);
  }
  return (uint16_t)(acc / samples);
}

// Polinomio típico de SEN0189. Ajuste con su propia calibración si es necesario.
// mv: milivoltios medidos en el pin del ESP32 (después de divisor si existe)
// v: voltios (double)
double turbidityFromMilliVolts(uint16_t mv) {
  double v = mv / 1000.0; // a voltios
  // Si su sensor se alimenta a 5V y usa divisor (ej. R1=10k, R2=10k), la salida del sensor
  // se reduce a la mitad. Entonces la tensión real del sensor sería v*2. Ajuste si aplica.
  const double DIVIDER_GAIN = 1.5; // ponga 2.0 si usó divisor 1:1, etc.
  double vs = v * DIVIDER_GAIN;
  double ntu = -1120.4 * vs * vs + 5742.3 * vs - 4352.9;
  if (ntu < 0) ntu = 0;
  if (ntu > 4000) ntu = 4000; // clamp
  return ntu;
}

/***** LÓGICA /command + /session *****/
String buildCommandURL() {
  String url = BASE_URL;
  if (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/command";
  if (DEVICE_ID_PARAM.length()) {
    url += "?device_id=" + DEVICE_ID_PARAM;
  }
  return url;
}

String buildSessionURL() {
  String url = BASE_URL;
  if (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/session";
  return url;
}

bool pollCommand(JsonDocument& outCmd) {
  ensureWiFi();
  DynamicJsonDocument doc(1024);
  String url = buildCommandURL();
  Serial.print("GET "); Serial.println(url);
  if (!httpGET_JSON(url, AUTH_TOKEN, doc)) return false;
  outCmd = doc; // copia
  return true;
}

bool postSessionBatch(int sessionId, JsonArray readings) {
  ensureWiFi();

  // Capacidad suficiente para:
  // { "session_id": ..., "readings": [ {4 campos} x COUNT ] }
  const size_t CAP =
    JSON_OBJECT_SIZE(2) +                  // session_id + readings
    JSON_ARRAY_SIZE(COUNT) +               // cabecera del array
    COUNT * JSON_OBJECT_SIZE(4) +          // cada objeto: seq, device_epoch_ms, ntu, raw_mv
    256;                                   // margen de seguridad

  DynamicJsonDocument doc(CAP);
  doc["session_id"] = sessionId;
  doc["readings"] = readings;              // copia profunda desde readingsDoc

  String payload;
  serializeJson(doc, payload);

  String url = buildSessionURL();
  Serial.print("POST ");
  Serial.print(url);
  Serial.print(" bytes=");
  Serial.println(payload.length());

  String resp;
  bool ok = httpPOST_JSON(url, AUTH_TOKEN, payload, resp);
  Serial.print("Resp: ");
  Serial.println(resp);
  return ok;
}

/***** SETUP *****/
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ESP32-NTU] Booting...");

  ensureWiFi();
  configTime(GMT_OFFSET_SEC, DST_OFFSET_SEC, NTP_SERVER);
  Serial.println("Sincronizando NTP...");
  // Esperar tiempo válido (time() > 2020-01-01)
  for (int i = 0; i < 50; ++i) {
    time_t now = time(nullptr);
    if (now > 1577836800) break; // 2020-01-01
    delay(200);
  }
  struct tm tminfo; time_t now = time(nullptr); gmtime_r(&now, &tminfo);
  Serial.printf("NTP OK: %04d-%02d-%02d %02d:%02d:%02dZ\n",
                tminfo.tm_year + 1900, tminfo.tm_mon + 1, tminfo.tm_mday,
                tminfo.tm_hour, tminfo.tm_min, tminfo.tm_sec);

  // Configurar ADC
  analogReadResolution(ADC_BITS);
  analogSetPinAttenuation(PIN_TURBIDITY, ADC_ATT);
  // analogSetVRef(1100); // opcional: si conoce Vref de su módulo
}

/***** LOOP PRINCIPAL *****/
void loop() {
  // 1) Polling a command
  DynamicJsonDocument cmd(1024);
  if (!pollCommand(cmd)) {
    delay(pollSec * 1000);
    return;
  }

  const char* command = cmd["command"] | "idle";
  Serial.print("/command -> "); Serial.println(command);
  if (String(command) != "start") {
    delay(pollSec * 1000);
    return;
  }

  int sessionId = cmd["session_id"] | -1;
  if (sessionId <= 0) {
    Serial.println("Comando START sin session_id válido.");
    delay(pollSec * 1000);
    return;
  }

  // 2) Planificar muestreo
  uint64_t nowMs = nowEpochMs();
  uint64_t t0 = alignNextTickMs(nowMs, STEP_MS);
  Serial.print("Sampling REAL, t0="); Serial.println((unsigned long)t0);

  // Si llegamos antes de t0, esperar.
  if (t0 > nowEpochMs()) sleepUntil(t0);

  // 3) Recolectar 60 lecturas en ticks exactos de 5 s
  // Pre-alocar contenedor JSON para lecturas
  const size_t CAP = JSON_ARRAY_SIZE(COUNT) + COUNT * JSON_OBJECT_SIZE(4) + 1024;
  DynamicJsonDocument readingsDoc(CAP);
  JsonArray readings = readingsDoc.to<JsonArray>();

  for (uint16_t i = 0; i < COUNT; ++i) {
    uint64_t ti = t0 + (uint64_t)i * (uint64_t)STEP_MS;

    // Espera activa hasta el tick
    uint64_t nowMsi = nowEpochMs();
    if (ti > nowMsi) sleepUntil(ti);

    // Lectura del sensor
    uint16_t mv = analogReadMilliVoltsAveraged(PIN_TURBIDITY, ADC_SAMPLES);
    double ntu = turbidityFromMilliVolts(mv);

    // Empaquetar sample
    JsonObject o = readings.add<JsonObject>();
    o["seq"] = i;
    // IMPORTANTE: device_epoch_ms en milisegundos (usar uint64->string para no perder precisión en JSON)
    char tsbuf[24];
    snprintf(tsbuf, sizeof(tsbuf), "%llu", (unsigned long long)ti);
    o["device_epoch_ms"] = tsbuf;
    o["ntu"] = ntu;    // double -> JSON
    o["raw_mv"] = (int)mv;

    if (i % 10 == 0) {
      Serial.printf("  [%2u/%2u] t=%llu mv=%u -> NTU=%.2f\n", i, COUNT, (unsigned long long)ti, mv, ntu);
    }
  }

  // 4) POST /session con el batch
  if (postSessionBatch(sessionId, readings)) {
    Serial.println("POST /session OK");
  } else {
    Serial.println("POST /session FAIL");
  }

  // 5) Dar tiempo al backend para cerrar la sesión
  Serial.printf("Durmiendo %us para cierre de sesión...\n", postSleepSec);
  for (uint16_t s = 0; s < postSleepSec; ++s){
    delay(1000);
  }
}