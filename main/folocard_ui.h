#pragma once
#include "bsp_button.h"
void fc_ui_init(void);
void fc_ui_key(bsp_btn_t btn, bsp_btn_ev_t ev, void *user);
void fc_ui_battery(int soc);
