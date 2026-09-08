#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define FC_MAX_JSON 8192
#define FC_DAYS 84
#define FC_AVATAR_W 24
#define FC_AVATAR_H 24
#define FC_AVATAR_BYTES (FC_AVATAR_W * FC_AVATAR_H * 2)
#define FC_SOCIAL_METRICS 5

typedef struct {
  char date[11];
  int intensity;
  bool has_tokens;
  double tokens;
} fc_day_t;
typedef struct {
  bool present;
  uint16_t pixels[FC_AVATAR_W * FC_AVATAR_H];
} fc_avatar_t;
typedef struct {
  bool present;
  char name[97], bio[193], url[193];
  double metrics[FC_SOCIAL_METRICS];
  bool has_metric[FC_SOCIAL_METRICS];
  fc_avatar_t avatar;
} fc_social_t;
typedef struct {
  char updated[36];
  fc_day_t days[FC_DAYS];
  int day_count;
  bool has_quota;
  double used_percent;
  char resets[36];
  bool has_usage_tokens;
  double usage_tokens;
  bool has_usage_credits;
  double usage_credits;
  fc_social_t social[2];
} fc_card_t;
/* Pure parsing: caller publishes the output only after success. */
bool fc_parse(const char *json, size_t len, fc_card_t *out);
uint32_t fc_crc32(const void *data, size_t len);
int fc_page_step(int page, int direction);
/* Grid slot 0 is 83 calendar days before updatedAt, slot 83 is its date. */
int fc_grid_index(const fc_card_t *card, int slot);

typedef struct {
  char json[FC_MAX_JSON + 1];
  size_t total, received;
  uint32_t checksum;
} fc_receiver_t;
typedef enum {
  FC_RX_ERROR = -1,
  FC_RX_PROGRESS = 1,
  FC_RX_COMPLETE = 2
} fc_rx_result_t;
fc_rx_result_t fc_receive(fc_receiver_t *rx, const uint8_t *frame, size_t len);
int fc_week_active(const fc_card_t *card);
