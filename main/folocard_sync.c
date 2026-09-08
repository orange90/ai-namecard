#include "folocard_sync.h"
#include "demo_radio.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "nvs.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "store/config/ble_store_config.h"
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>

/* ESP-IDF NimBLE exposes this initializer without a public declaration. */
void ble_store_config_init(void);

/* Worker owns BLE lifecycle, staging buffer and NVS; host callbacks only queue
 * bounded frames. Neither worker nor host touches LVGL. */
static QueueHandle_t queue;
static SemaphoreHandle_t model_lock, host_stopped;
static fc_card_t card, candidate;
static atomic_int state;
static atomic_bool wanted;
static atomic_uint pin, revision, epoch, ack_crc, ack_offset;
static atomic_int ack_status;
static uint8_t addr_type;
static bool initialized;
static atomic_uint connection = BLE_HS_CONN_HANDLE_NONE;
static fc_receiver_t receiver;
#define staging receiver.json
static uint32_t transfer_epoch;
static int64_t deadline;
typedef struct {
  unsigned epoch;
  uint16_t len;
  uint8_t bytes[244];
} packet_t;
static const ble_uuid128_t service_uuid =
    BLE_UUID128_INIT(0x01, 0x00, 0x00, 0x00, 0x55, 0x43, 0x4f, 0x46, 0x80, 0x00,
                     0x43, 0x46, 0x00, 0x00, 0x01, 0xfc);
static const ble_uuid128_t data_uuid =
    BLE_UUID128_INIT(0x02, 0x00, 0x00, 0x00, 0x55, 0x43, 0x4f, 0x46, 0x80, 0x00,
                     0x43, 0x46, 0x00, 0x00, 0x01, 0xfc);
static const ble_uuid128_t ack_uuid =
    BLE_UUID128_INIT(0x03, 0x00, 0x00, 0x00, 0x55, 0x43, 0x4f, 0x46, 0x80, 0x00,
                     0x43, 0x46, 0x00, 0x00, 0x01, 0xfc);
static int access_cb(uint16_t conn, uint16_t attr,
                     struct ble_gatt_access_ctxt *ctxt, void *arg) {
  (void)attr;
  (void)arg;
  struct ble_gap_conn_desc desc;
  if (ble_gap_conn_find(conn, &desc) || !desc.sec_state.encrypted ||
      !desc.sec_state.authenticated || !desc.sec_state.bonded)
    return BLE_ATT_ERR_INSUFFICIENT_AUTHEN;
  if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
    char ack[128];
    int n =
        snprintf(ack, sizeof(ack),
                 "{\"version\":1,\"checksum\":%lu,\"status\":%d,\"offset\":%u,"
                 "\"revision\":%u}",
                 (unsigned long)atomic_load(&ack_crc), atomic_load(&ack_status),
                 atomic_load(&ack_offset), atomic_load(&revision));
    return os_mbuf_append(ctxt->om, ack, n) ? BLE_ATT_ERR_INSUFFICIENT_RES : 0;
  }
  if (!atomic_load(&wanted))
    return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
  packet_t p = {.epoch = atomic_load(&epoch), .len = OS_MBUF_PKTLEN(ctxt->om)};
  if (p.len < 1 || p.len > sizeof(p.bytes))
    return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
  if (os_mbuf_copydata(ctxt->om, 0, p.len, p.bytes))
    return BLE_ATT_ERR_UNLIKELY;
  return xQueueSend(queue, &p, 0) == pdTRUE ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}
static const struct ble_gatt_svc_def services[] = {
    {.type = BLE_GATT_SVC_TYPE_PRIMARY,
     .uuid = &service_uuid.u,
     .characteristics =
         (struct ble_gatt_chr_def[]){
             {.uuid = &data_uuid.u,
              .access_cb = access_cb,
              .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_ENC |
                       BLE_GATT_CHR_F_WRITE_AUTHEN},
             {.uuid = &ack_uuid.u,
              .access_cb = access_cb,
              .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC |
                       BLE_GATT_CHR_F_READ_AUTHEN},
             {0}}},
    {0}};
static int gap_cb(struct ble_gap_event *e, void *arg);
static int advertise(void) {
  struct ble_hs_adv_fields f = {0};
  f.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
  f.name = (uint8_t *)"FoloCard";
  f.name_len = 8;
  f.name_is_complete = 1;
  int rc = ble_gap_adv_set_fields(&f);
  struct ble_hs_adv_fields scan = {0};
  scan.uuids128 = (ble_uuid128_t *)&service_uuid;
  scan.num_uuids128 = 1;
  scan.uuids128_is_complete = 1;
  if (!rc)
    rc = ble_gap_adv_rsp_set_fields(&scan);
  struct ble_gap_adv_params p = {0};
  p.conn_mode = BLE_GAP_CONN_MODE_UND;
  p.disc_mode = BLE_GAP_DISC_MODE_GEN;
  if (!rc)
    rc = ble_gap_adv_start(addr_type, NULL, BLE_HS_FOREVER, &p, gap_cb, NULL);
  atomic_store(&state, rc ? FC_ERROR : FC_WAITING);
  return rc;
}
static int gap_cb(struct ble_gap_event *e, void *arg) {
  (void)arg;
  struct ble_gap_conn_desc desc;
  switch (e->type) {
  case BLE_GAP_EVENT_CONNECT:
    if (!e->connect.status) {
      atomic_store(&connection, e->connect.conn_handle);
      atomic_fetch_add(&epoch, 1);
      atomic_store(&state, FC_CONNECTED);
      ble_gap_security_initiate(e->connect.conn_handle);
    } else if (atomic_load(&wanted))
      advertise();
    break;
  case BLE_GAP_EVENT_DISCONNECT:
    atomic_store(&connection, BLE_HS_CONN_HANDLE_NONE);
    atomic_fetch_add(&epoch, 1);
    if (atomic_load(&wanted))
      advertise();
    break;
  case BLE_GAP_EVENT_PASSKEY_ACTION: {
    if (e->passkey.params.action != BLE_SM_IOACT_DISP)
      return BLE_HS_ENOTSUP;
    struct ble_sm_io io = {.action = BLE_SM_IOACT_DISP,
                           .passkey = atomic_load(&pin)};
    return ble_sm_inject_io(e->passkey.conn_handle, &io);
  }
  case BLE_GAP_EVENT_ENC_CHANGE:
    if (e->enc_change.status)
      ble_gap_terminate(e->enc_change.conn_handle, BLE_ERR_REM_USER_CONN_TERM);
    break;
  case BLE_GAP_EVENT_REPEAT_PAIRING:
    /* The phone or Mac can lose its side of a bond while the device still has
     * the peer key. Remove only that peer and let NimBLE negotiate a fresh,
     * displayed PIN instead of trapping the user in a disconnect loop. */
    if (ble_gap_conn_find(e->repeat_pairing.conn_handle, &desc) == 0)
      ble_store_util_delete_peer(&desc.peer_id_addr);
    return BLE_GAP_REPEAT_PAIRING_RETRY;
  default:
    break;
  }
  return 0;
}
static void on_sync(void) {
  int rc = ble_hs_util_ensure_addr(0);
  if (!rc)
    rc = ble_hs_id_infer_auto(0, &addr_type);
  if (!rc && atomic_load(&wanted))
    rc = advertise();
  if (rc)
    atomic_store(&state, FC_ERROR);
}
static void host(void *arg) {
  (void)arg;
  nimble_port_run();
  xSemaphoreGive(host_stopped);
  nimble_port_freertos_deinit();
}
static void start(void) {
  atomic_store(&state, FC_STARTING);
  atomic_store(&pin, 100000 + esp_random() % 900000);
  if (nimble_port_init() != ESP_OK) {
    atomic_store(&wanted, false);
    atomic_store(&state, FC_ERROR);
    return;
  }
  initialized = true;
  ble_svc_gap_init();
  ble_svc_gatt_init();
  ble_hs_cfg.sync_cb = on_sync;
  ble_hs_cfg.sm_io_cap = BLE_HS_IO_DISPLAY_ONLY;
  ble_hs_cfg.sm_bonding = 1;
  ble_hs_cfg.sm_mitm = 1;
  ble_hs_cfg.sm_sc = 1;
  ble_hs_cfg.sm_our_key_dist =
      BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_hs_cfg.sm_their_key_dist =
      BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_store_config_init();
  int rc = ble_svc_gap_device_name_set("FoloCard");
  if (!rc)
    rc = ble_gatts_count_cfg(services);
  if (!rc)
    rc = ble_gatts_add_svcs(services);
  if (rc) {
    nimble_port_deinit();
    initialized = false;
    atomic_store(&wanted, false);
    atomic_store(&state, FC_ERROR);
    return;
  }
  deadline = esp_timer_get_time() + 180000000;
  nimble_port_freertos_init(host);
}
static void stop(void) {
  ble_gap_adv_stop();
  unsigned conn = atomic_load(&connection);
  if (conn != BLE_HS_CONN_HANDLE_NONE)
    ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
  if (nimble_port_stop() == 0) {
    xSemaphoreTake(host_stopped, portMAX_DELAY);
    nimble_port_deinit();
    initialized = false;
    atomic_store(&state, FC_OFF);
  } else
    atomic_store(&state, FC_ERROR);
  atomic_fetch_add(&epoch, 1);
  receiver.received = receiver.total = 0;
}
static esp_err_t save(size_t len) {
  nvs_handle_t h;
  esp_err_t err = nvs_open("folocard", NVS_READWRITE, &h);
  if (err != ESP_OK)
    return err;
  uint8_t active = 0;
  nvs_get_u8(h, "active", &active);
  uint8_t next = active == 0 ? 1 : 0;
  const char *next_key = next ? "card1" : "card0";
  /* NVS writes a replacement blob before invalidating its previous entries.
   * With two near-8 KiB card slots in the 24 KiB NVS partition that temporary
   * third copy cannot fit. Erase only the inactive slot first and commit the
   * tombstone so garbage collection can reclaim it; the active card remains
   * valid throughout a failed write or power loss. */
  err = nvs_erase_key(h, next_key);
  if (err == ESP_ERR_NVS_NOT_FOUND)
    err = ESP_OK;
  if (err == ESP_OK)
    err = nvs_commit(h);
  if (err == ESP_OK)
    err = nvs_set_blob(h, next_key, staging, len);
  if (err == ESP_OK)
    err = nvs_commit(h);
  if (err == ESP_OK)
    err = nvs_set_u8(h, "active", next);
  if (err == ESP_OK)
    err = nvs_commit(h);
  nvs_close(h);
  return err;
}
static void frame(const packet_t *p) {
  if (p->epoch != atomic_load(&epoch))
    return;
  if (p->epoch != transfer_epoch) {
    receiver.total = receiver.received = 0;
    transfer_epoch = p->epoch;
  }
  fc_rx_result_t result = fc_receive(&receiver, p->bytes, p->len);
  if (p->bytes[0] == 1)
    atomic_store(&ack_crc, 0);
  atomic_store(&ack_offset, receiver.received);
  if (result == FC_RX_COMPLETE) {
    bool parsed = fc_parse(staging, receiver.total, &candidate);
    esp_err_t saved = parsed ? save(receiver.total) : ESP_ERR_INVALID_ARG;
    if (parsed && saved == ESP_OK) {
      xSemaphoreTake(model_lock, portMAX_DELAY);
      card = candidate;
      xSemaphoreGive(model_lock);
      atomic_store(&ack_crc, receiver.checksum);
      atomic_fetch_add(&revision, 1);
      atomic_store(&ack_status, 2);
      atomic_store(&state, FC_SAVED);
      receiver.total = receiver.received = 0;
      ESP_LOGI("folocard", "Card committed; revision=%u",
               atomic_load(&revision));
      return;
    }
    if (!parsed)
      ESP_LOGE("folocard", "Card rejected by parser; bytes=%u",
               (unsigned)receiver.total);
    else
      ESP_LOGE("folocard", "Card save failed: %s", esp_err_to_name(saved));
    result = FC_RX_ERROR;
  }
  if (result == FC_RX_ERROR) {
    receiver.total = receiver.received = 0;
    atomic_store(&state, FC_ERROR);
  }
  atomic_store(&ack_status, result);
}
static void worker(void *arg) {
  (void)arg;
  packet_t p;
  for (;;) {
    if (atomic_load(&wanted) && !initialized)
      start();
    if (initialized && esp_timer_get_time() > deadline)
      atomic_store(&wanted, false);
    if (initialized && !atomic_load(&wanted))
      stop();
    if (xQueueReceive(queue, &p, pdMS_TO_TICKS(50)) == pdTRUE && initialized &&
        atomic_load(&wanted))
      frame(&p);
  }
}
esp_err_t fc_sync_init(void) {
  esp_err_t err = demo_radio_nvs_prepare();
  if (err != ESP_OK)
    return err;
  model_lock = xSemaphoreCreateMutex();
  host_stopped = xSemaphoreCreateBinary();
  queue = xQueueCreate(16, sizeof(packet_t));
  if (!model_lock || !host_stopped || !queue)
    return ESP_ERR_NO_MEM;
  nvs_handle_t h;
  if (nvs_open("folocard", NVS_READONLY, &h) == ESP_OK) {
    uint8_t active = 0;
    size_t len = FC_MAX_JSON;
    nvs_get_u8(h, "active", &active);
    if (nvs_get_blob(h, active ? "card1" : "card0", staging, &len) == ESP_OK &&
        fc_parse(staging, len, &candidate)) {
      card = candidate;
      atomic_store(&revision, 1);
    }
    nvs_close(h);
  }
  return xTaskCreate(worker, "card_sync", 8192, NULL, 4, NULL) == pdPASS
             ? ESP_OK
             : ESP_ERR_NO_MEM;
}
void fc_sync_enable(bool enabled) { atomic_store(&wanted, enabled); }
fc_sync_state_t fc_sync_state(void) { return atomic_load(&state); }
unsigned fc_sync_pin(void) { return atomic_load(&pin); }
unsigned fc_sync_revision(void) { return atomic_load(&revision); }
void fc_sync_snapshot(fc_card_t *out) {
  if (!model_lock) {
    memset(out, 0, sizeof(*out));
    return;
  }
  xSemaphoreTake(model_lock, portMAX_DELAY);
  *out = card;
  xSemaphoreGive(model_lock);
}

bool fc_sync_enabled(void) { return atomic_load(&wanted); }
