#include "bsp_battery.h"
#include "bsp_button.h"
#include "bsp_display.h"
#include "bsp_i2c.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "folocard_sync.h"
#include "folocard_ui.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
void app_main(void) {
  ESP_LOGI("folocard", "FoloCard starting; identity and Recovery preserved");
  ESP_ERROR_CHECK(bsp_i2c_init());
  ESP_ERROR_CHECK(bsp_display_init());
  if (!bsp_lvgl_init()) {
    ESP_LOGE("folocard", "LVGL initialization failed");
    return;
  }
  bsp_display_backlight(100);
  esp_err_t battery = bsp_battery_init();
  esp_err_t sync = fc_sync_init();
  if (sync != ESP_OK)
    ESP_LOGE("folocard", "Sync unavailable: %s", esp_err_to_name(sync));
  if (bsp_lvgl_lock(1000)) {
    fc_ui_init();
    bsp_lvgl_unlock();
  }
  ESP_ERROR_CHECK(bsp_button_init(fc_ui_key, NULL));
  for (;;) {
    fc_ui_battery(battery == ESP_OK ? bsp_battery_soc() : -1);
    ESP_LOGI("folocard", "Ready; revision=%u BLE=%d heap=%u minimum=%u",
             fc_sync_revision(), fc_sync_state(),
             (unsigned)esp_get_free_heap_size(),
             (unsigned)esp_get_minimum_free_heap_size());
    vTaskDelay(pdMS_TO_TICKS(10000));
  }
}
