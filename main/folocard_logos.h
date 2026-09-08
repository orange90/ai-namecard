#pragma once

#include "lvgl.h"

typedef enum {
  FC_LOGO_CODEX,
  FC_LOGO_ZHIHU,
  FC_LOGO_XIAOHONGSHU,
} fc_logo_t;

/* Adds one of the supplied 40 px ARGB8888 brand marks to a FoloCard page. */
void fc_logo_create(lv_obj_t *parent, fc_logo_t logo, int x, int y);
