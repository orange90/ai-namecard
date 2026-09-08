#include "folocard_ui.h"
#include "folocard_logos.h"
#include "folocard_sync.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "lvgl.h"
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>

LV_FONT_DECLARE(folocard_font);

#define CODEX_BG 0x080B0A
#define CODEX_PANEL 0x101713
#define CODEX_GREEN 0x35D06F
#define ZHIHU_BLUE 0x1677FF
#define ZHIHU_PALE 0xEAF3FF
#define XHS_RED 0xFF2442
#define XHS_PALE 0xFFF0F2
#define WHITE 0xFFFFFF
#define INK 0x15231E
#define MUTED 0x748078

static lv_obj_t *screen;
static QueueHandle_t keys;
static fc_card_t view;
static int page;
static bool detail, settings;
static unsigned revision;
static fc_sync_state_t last_state;
static atomic_int battery = -1;
static int last_battery = -2;
static const uint32_t greens[] = {0x202A24, 0x164D2B, 0x187F3E, 0x28B85D,
                                  0x48E17D};

typedef struct {
  bsp_btn_t btn;
  bsp_btn_ev_t ev;
} key_t;

static lv_obj_t *box(lv_obj_t *parent, int x, int y, int w, int h,
                     uint32_t color, int radius) {
  lv_obj_t *object = lv_obj_create(parent);
  lv_obj_remove_flag(object, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_size(object, w, h);
  lv_obj_set_style_pad_all(object, 0, 0);
  lv_obj_set_style_border_width(object, 0, 0);
  lv_obj_set_style_radius(object, radius, 0);
  lv_obj_set_style_bg_color(object, lv_color_hex(color), 0);
  return object;
}

static lv_obj_t *label(lv_obj_t *parent, const char *text, int x, int y,
                       int width, uint32_t color) {
  lv_obj_t *object = lv_label_create(parent);
  lv_label_set_text(object, text);
  lv_obj_set_pos(object, x, y);
  lv_obj_set_width(object, width);
  lv_label_set_long_mode(object, LV_LABEL_LONG_DOT);
  lv_obj_set_style_text_font(object, &folocard_font, 0);
  lv_obj_set_style_text_color(object, lv_color_hex(color), 0);
  return object;
}

static lv_obj_t *new_screen(uint32_t color) {
  lv_obj_t *object = lv_obj_create(NULL);
  lv_obj_remove_flag(object, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_style_pad_all(object, 0, 0);
  lv_obj_set_style_border_width(object, 0, 0);
  lv_obj_set_style_bg_color(object, lv_color_hex(color), 0);
  return object;
}

static void battery_chip(lv_obj_t *parent, uint32_t bg, uint32_t fg) {
  char text[16];
  int soc = atomic_load(&battery);
  if (soc < 0)
    strcpy(text, "--%");
  else
    snprintf(text, sizeof(text), "%d%%", soc);
  lv_obj_t *chip = box(parent, 184, 14, 44, 25, bg, 12);
  lv_obj_t *value = label(chip, text, 0, 3, 44, fg);
  lv_obj_set_style_text_align(value, LV_TEXT_ALIGN_CENTER, 0);
}

static void nav(lv_obj_t *parent, uint32_t color) {
  for (int i = 0; i < 3; i++) {
    lv_obj_t *dot =
        box(parent, 101 + i * 15, 302, i == page ? 10 : 6, 6, color, 3);
    lv_obj_set_style_bg_opa(dot, i == page ? LV_OPA_COVER : LV_OPA_40, 0);
  }
}

static void codex_logo(lv_obj_t *parent) {
  fc_logo_create(parent, FC_LOGO_CODEX, 12, 10);
  label(parent, "CODEX", 59, 13, 100, WHITE);
  label(parent, "ACTIVITY", 59, 33, 100, 0x7B9485);
}

static void zhihu_logo(lv_obj_t *parent) {
  fc_logo_create(parent, FC_LOGO_ZHIHU, 12, 10);
  label(parent, "知乎名片", 60, 17, 110, WHITE);
}

static void xhs_logo(lv_obj_t *parent) {
  fc_logo_create(parent, FC_LOGO_XIAOHONGSHU, 12, 10);
  label(parent, "创作者名片", 66, 17, 105, WHITE);
}

static void default_avatar(lv_obj_t *parent, uint32_t accent) {
  box(parent, 15, 9, 16, 16, accent, 8);
  box(parent, 8, 26, 30, 17, accent, 12);
}

static void avatar(lv_obj_t *parent, const fc_social_t *social,
                   uint32_t accent) {
  lv_obj_t *holder = box(parent, 10, 10, 48, 48, WHITE, 24);
  lv_obj_set_style_border_width(holder, 3, 0);
  lv_obj_set_style_border_color(holder, lv_color_hex(accent), 0);
  lv_obj_set_style_clip_corner(holder, true, 0);
  if (!social->avatar.present) {
    default_avatar(holder, accent);
    return;
  }
  lv_obj_t *canvas = lv_canvas_create(holder);
  lv_canvas_set_buffer(canvas, (void *)social->avatar.pixels, FC_AVATAR_W,
                       FC_AVATAR_H, LV_COLOR_FORMAT_RGB565);
  lv_obj_set_pos(canvas, 0, 0);
  lv_image_set_pivot(canvas, 0, 0);
  lv_image_set_scale(canvas, 512);
  lv_image_set_antialias(canvas, false);
}

static void qr(lv_obj_t *parent, const char *url, int x, int y, int size,
               uint32_t dark, uint32_t light) {
  lv_obj_t *code = lv_qrcode_create(parent);
  lv_qrcode_set_size(code, size);
  lv_obj_set_pos(code, x, y);
  lv_qrcode_set_dark_color(code, lv_color_hex(dark));
  lv_qrcode_set_light_color(code, lv_color_hex(light));
  lv_obj_set_style_border_width(code, 4, 0);
  lv_obj_set_style_border_color(code, lv_color_hex(light), 0);
  if (lv_qrcode_update(code, url, strlen(url)) != LV_RESULT_OK) {
    lv_obj_delete(code);
    label(parent, "二维码不可用", x, y + size / 2 - 8, size, dark);
  }
}

static void metric_value(char *out, size_t cap, const fc_social_t *social,
                         int index) {
  if (!social->has_metric[index]) {
    strcpy(out, "--");
    return;
  }
  double value = social->metrics[index];
  if (value >= 100000000.0)
    snprintf(out, cap, "%.1f亿", value / 100000000.0);
  else if (value >= 10000.0)
    snprintf(out, cap, "%.1f万", value / 10000.0);
  else
    snprintf(out, cap, "%.0f", value);
}

static void stat_box(lv_obj_t *parent, const fc_social_t *social, int index,
                     const char *name, int x, int y, int w, int h, uint32_t bg,
                     uint32_t accent) {
  char value[24];
  metric_value(value, sizeof(value), social, index);
  lv_obj_t *card = box(parent, x, y, w, h, bg, 9);
  label(card, name, 9, 5, w - 18, MUTED);
  label(card, value, 9, h - 23, w - 18, accent);
}

static void render_codex(void) {
  screen = new_screen(CODEX_BG);
  codex_logo(screen);
  battery_chip(screen, 0x183321, CODEX_GREEN);
  lv_obj_t *summary = box(screen, 12, 61, 216, 42, CODEX_PANEL, 10);
  lv_obj_set_style_border_width(summary, 1, 0);
  lv_obj_set_style_border_color(summary, lv_color_hex(0x24462F), 0);
  char text[64];
  if (view.day_count) {
    label(summary, "本周活跃：", 12, 11, 84, 0xA4B4AA);
    snprintf(text, sizeof(text), "%d天", fc_week_active(&view));
    label(summary, text, 88, 11, 40, CODEX_GREEN);
  } else {
    lv_obj_t *prompt =
        label(summary, "请先同步数据", 12, 11, 192, CODEX_GREEN);
    lv_obj_set_style_text_align(prompt, LV_TEXT_ALIGN_CENTER, 0);
  }
  if (detail) {
    lv_obj_t *usage = box(screen, 12, 113, 216, 169, CODEX_PANEL, 12);
    bool tokens = false;
    const fc_day_t *latest = NULL;
    for (int i = 0; i < view.day_count; i++)
      if (view.days[i].has_tokens) {
        tokens = true;
        latest = &view.days[i];
      }
    label(usage, (tokens || view.has_usage_tokens) ? "TOKEN 用量" : "活动强度",
          13, 12, 180, CODEX_GREEN);
    if (view.has_usage_tokens || latest) {
      if (view.has_usage_tokens)
        snprintf(text, sizeof(text), "当前周期  %.0f tokens",
                 view.usage_tokens);
      else
        snprintf(text, sizeof(text), "%s  %.0f tokens", latest->date,
                 latest->tokens);
      lv_obj_t *token_box = box(usage, 12, 43, 192, 50, 0x17231C, 9);
      label(token_box, text, 10, 15, 172, CODEX_GREEN);
    } else {
      label(usage, "页面没有提供精确 Token", 13, 48, 185, 0xA4B4AA);
    }
    label(usage, view.has_quota ? "额度（不等于 Token）" : "额度不可用", 13,
          105, 185, 0xA4B4AA);
    if (view.has_quota) {
      snprintf(text, sizeof(text), "已用 %.0f%%", view.used_percent);
      label(usage, text, 13, 131, 100, WHITE);
      box(usage, 117, 137, 76, 7, 0x26332B, 4);
      box(usage, 117, 137, (int)(76 * view.used_percent / 100.0), 7,
          CODEX_GREEN, 4);
    }
    if (view.has_usage_credits) {
      snprintf(text, sizeof(text), "Credits  %.1f", view.usage_credits);
      label(usage, text, 13, 151, 170, 0xA4B4AA);
    }
  } else {
    lv_obj_t *heatmap = box(screen, 12, 113, 216, 169, CODEX_PANEL, 12);
    label(heatmap, "最近 12 周", 12, 10, 100, 0xA4B4AA);
    for (int col = 0; col < 12; col++)
      for (int row = 0; row < 7; row++) {
        int slot = col * 7 + row;
        int idx = fc_grid_index(&view, slot);
        lv_obj_t *cell =
            box(heatmap, 12 + col * 16, 39 + row * 16, 11, 11,
                idx < 0 ? CODEX_PANEL : greens[view.days[idx].intensity], 2);
        if (idx < 0) {
          lv_obj_set_style_border_width(cell, 1, 0);
          lv_obj_set_style_border_color(cell, lv_color_hex(0x344038), 0);
        }
      }
    label(heatmap, "低", 12, 153, 25, 0x708077);
    for (int i = 0; i < 5; i++)
      box(heatmap, 42 + i * 17, 158, 10, 7, greens[i], 2);
    label(heatmap, "高", 131, 153, 25, 0x708077);
    label(heatmap, "OK 查看用量", 150, 153, 58, 0xA4B4AA);
  }
  nav(screen, CODEX_GREEN);
}

static void render_social(bool is_zhihu) {
  fc_social_t *social = &view.social[is_zhihu ? 0 : 1];
  uint32_t accent = is_zhihu ? ZHIHU_BLUE : XHS_RED;
  uint32_t pale = is_zhihu ? ZHIHU_PALE : XHS_PALE;
  screen = new_screen(accent);
  if (is_zhihu)
    zhihu_logo(screen);
  else
    xhs_logo(screen);
  battery_chip(screen, WHITE, accent);
  lv_obj_t *body = box(screen, 0, 58, 240, 262, pale, 18);
  if (!social->present) {
    lv_obj_t *empty = box(body, 12, 14, 216, 218, WHITE, 14);
    default_avatar(empty, accent);
    label(empty, "尚未同步名片", 61, 17, 140, INK);
    label(empty, "请在扩展中读取并确认资料", 18, 80, 180, MUTED);
    nav(screen, accent);
    return;
  }
  if (detail) {
    lv_obj_t *code_card = box(body, 12, 13, 216, 222, WHITE, 14);
    label(code_card, social->name, 18, 13, 180, INK);
    qr(code_card, social->url, 28, 48, 160, accent, WHITE);
    label(code_card, "扫码访问公开主页", 35, 211, 150, accent);
  } else {
    lv_obj_t *profile = box(body, 10, 11, 220, 71, WHITE, 13);
    avatar(profile, social, accent);
    label(profile, social->name, 68, 12, 94, INK);
    label(profile, "公开主页", 68, 39, 94, MUTED);
    qr(profile, social->url, 166, 7, 56, accent, WHITE);
    if (is_zhihu) {
      static const char *names[] = {"获赞", "粉丝", "回答", "文章"};
      for (int i = 0; i < 4; i++)
        stat_box(body, social, i, names[i], 10 + (i % 2) * 113,
                 91 + (i / 2) * 52, 107, 45, WHITE, accent);
      lv_obj_t *hint = box(body, 10, 195, 220, 42, WHITE, 11);
      label(hint, "按 OK 键查看主页二维码", 18, 12, 190, accent);
    } else {
      stat_box(body, social, 0, "获赞与收藏", 10, 94, 107, 78, WHITE, accent);
      stat_box(body, social, 1, "粉丝", 123, 94, 107, 78, WHITE, accent);
      lv_obj_t *hint = box(body, 10, 182, 220, 55, WHITE, 11);
      label(hint, "OK 放大主页二维码", 19, 17, 185, accent);
    }
  }
  nav(screen, accent);
}

static void render_settings(void) {
  screen = new_screen(0x13362A);
  label(screen, "FOLOCARD SYNC", 14, 17, 160, WHITE);
  battery_chip(screen, 0x245542, 0xB4F2CF);
  lv_obj_t *card = box(screen, 12, 62, 216, 218, WHITE, 15);
  const char *states[] = {"蓝牙已关闭",      "正在启动",     "等待 Mac 连接",
                          "已连接 / 配对中", "名片保存成功", "同步失败"};
  fc_sync_state_t state = fc_sync_state();
  label(card, states[state], 16, 15, 184,
        state == FC_ERROR ? XHS_RED : 0x176B47);
  if (state != FC_OFF && state != FC_ERROR) {
    label(card, "配对 PIN", 16, 57, 90, MUTED);
    char text[16];
    snprintf(text, sizeof(text), "%06u", fc_sync_pin());
    lv_obj_t *pin_box = box(card, 14, 83, 188, 52, 0xEDF8F1, 10);
    lv_obj_t *pin = label(pin_box, text, 0, 13, 188, 0x176B47);
    lv_obj_set_style_text_align(pin, LV_TEXT_ALIGN_CENTER, 0);
  }
  label(card, "OK 开始 / 取消", 16, 153, 184, INK);
  label(card, "3 分钟后自动关闭", 16, 180, 184, MUTED);
  label(screen, "长按 OK 返回名片", 47, 299, 150, 0xB4F2CF);
}

static void render(void) {
  fc_sync_snapshot(&view);
  lv_obj_t *old = screen;
  if (settings)
    render_settings();
  else if (page == 0)
    render_codex();
  else
    render_social(page == 1);
  lv_screen_load(screen);
  if (old)
    lv_obj_delete(old);
}

static void log_card_summary(void) {
  ESP_LOGI("folocard",
           "Screen data: updated=%s days=%d week_active=%d zhihu=%d xhs=%d",
           view.updated[0] ? view.updated : "none", view.day_count,
           fc_week_active(&view), view.social[0].present,
           view.social[1].present);
}

static void tick(lv_timer_t *timer) {
  (void)timer;
  key_t key;
  bool changed = false;
  while (xQueueReceive(keys, &key, 0) == pdTRUE) {
    if (key.btn == BSP_BTN_OK && key.ev == BSP_BTN_LONG) {
      settings = false;
      detail = false;
      fc_sync_enable(false);
      changed = true;
    } else if (key.btn == BSP_BTN_OK && key.ev == BSP_BTN_DOUBLE) {
      settings = true;
      detail = false;
      changed = true;
    } else if (key.ev == BSP_BTN_CLICK) {
      if (settings && key.btn == BSP_BTN_OK) {
        fc_sync_enable(!fc_sync_enabled());
        changed = true;
      } else if (!settings && key.btn == BSP_BTN_OK) {
        detail = !detail;
        changed = true;
      } else if (!settings) {
        page = fc_page_step(page, key.btn == BSP_BTN_UP ? -1 : 1);
        detail = false;
        changed = true;
      }
    }
  }
  unsigned new_revision = fc_sync_revision();
  fc_sync_state_t state = fc_sync_state();
  int soc = atomic_load(&battery);
  bool data_changed = new_revision != revision;
  if (data_changed || state != last_state || soc != last_battery) {
    revision = new_revision;
    last_state = state;
    last_battery = soc;
    changed = true;
  }
  if (changed) {
    render();
    if (data_changed)
      log_card_summary();
  }
}

void fc_ui_init(void) {
  keys = xQueueCreate(12, sizeof(key_t));
  if (!keys)
    return;
  render();
  revision = fc_sync_revision();
  log_card_summary();
  lv_timer_create(tick, 100, NULL);
}

void fc_ui_key(bsp_btn_t btn, bsp_btn_ev_t ev, void *user) {
  (void)user;
  if (keys) {
    key_t key = {btn, ev};
    xQueueSend(keys, &key, 0);
  }
}

void fc_ui_battery(int soc) { atomic_store(&battery, soc); }
