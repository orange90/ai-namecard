#pragma once
#include "esp_err.h"
#include "folocard_model.h"
typedef enum {
  FC_OFF,
  FC_STARTING,
  FC_WAITING,
  FC_CONNECTED,
  FC_SAVED,
  FC_ERROR
} fc_sync_state_t;
esp_err_t fc_sync_init(void);
void fc_sync_enable(bool enabled);
fc_sync_state_t fc_sync_state(void);
unsigned fc_sync_pin(void);
unsigned fc_sync_revision(void);
void fc_sync_snapshot(fc_card_t *out);

bool fc_sync_enabled(void);
