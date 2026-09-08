#include "folocard_model.h"
#include "cJSON.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

static const cJSON *get(const cJSON *j, const char *k) {
  return cJSON_GetObjectItemCaseSensitive(j, k);
}
static bool keys(const cJSON *j, const char *const *allowed) {
  if (!cJSON_IsObject(j))
    return false;
  for (const cJSON *p = j->child; p; p = p->next) {
    bool found = false;
    for (int i = 0; allowed[i]; i++)
      if (!strcmp(p->string, allowed[i]))
        found = true;
    if (!found)
      return false;
    for (const cJSON *q = p->next; q; q = q->next)
      if (!strcmp(p->string, q->string))
        return false;
  }
  return true;
}
static bool str(const cJSON *j, char *out, size_t cap, bool required) {
  if (!j) {
    out[0] = 0;
    return !required;
  }
  if (!cJSON_IsString(j) || strlen(j->valuestring) >= cap ||
      (required && !j->valuestring[0]))
    return false;
  for (const unsigned char *p = (const unsigned char *)j->valuestring; *p; p++)
    if (*p < 32 || *p == 127)
      return false;
  strcpy(out, j->valuestring);
  return true;
}
static bool num(const cJSON *j, double max) {
  return cJSON_IsNumber(j) && isfinite(j->valuedouble) && j->valuedouble >= 0 &&
         j->valuedouble <= max;
}
static bool date(const char *s) {
  if (strlen(s) != 10 || s[4] != '-' || s[7] != '-')
    return false;
  for (int i = 0; i < 10; i++)
    if (i != 4 && i != 7 && (s[i] < '0' || s[i] > '9'))
      return false;
  int y, m, d;
  if (sscanf(s, "%4d-%2d-%2d", &y, &m, &d) != 3 || y < 2000 || m < 1 || m > 12)
    return false;
  const int days[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  return d >= 1 && d <= days[m - 1] + (m == 2 && y % 4 == 0 &&
                                       (y % 100 != 0 || y % 400 == 0));
}
static bool stamp(const char *s) {
  size_t n = strlen(s);
  if (n != 20 && n != 25)
    return false;
  char day[11];
  memcpy(day, s, 10);
  day[10] = 0;
  if (!date(day) || s[10] != 'T' || s[13] != ':' || s[16] != ':')
    return false;
  for (int i = 11; i < 19; i++)
    if (i != 13 && i != 16 && (s[i] < '0' || s[i] > '9'))
      return false;
  if ((s[11] - '0') * 10 + s[12] - '0' > 23 ||
      (s[14] - '0') * 10 + s[15] - '0' > 59 ||
      (s[17] - '0') * 10 + s[18] - '0' > 59)
    return false;
  if (n == 20)
    return s[19] == 'Z';
  if ((s[19] != '+' && s[19] != '-') || s[22] != ':')
    return false;
  for (int i = 20; i < 25; i++)
    if (i != 22 && (s[i] < '0' || s[i] > '9'))
      return false;
  return (s[20] - '0') * 10 + s[21] - '0' <= 14 &&
         (s[23] - '0') * 10 + s[24] - '0' <= 59;
}
static int base64_value(char c) {
  if (c >= 'A' && c <= 'Z')
    return c - 'A';
  if (c >= 'a' && c <= 'z')
    return c - 'a' + 26;
  if (c >= '0' && c <= '9')
    return c - '0' + 52;
  if (c == '+')
    return 62;
  if (c == '/')
    return 63;
  return -1;
}
static bool decode_avatar(const char *input, uint8_t *output) {
  size_t written = 0;
  for (size_t i = 0; i < 1536; i += 4) {
    int a = base64_value(input[i]), b = base64_value(input[i + 1]);
    int c = base64_value(input[i + 2]), d = base64_value(input[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0 || written + 3 > FC_AVATAR_BYTES)
      return false;
    output[written++] = (uint8_t)((a << 2) | (b >> 4));
    output[written++] = (uint8_t)((b << 4) | (c >> 2));
    output[written++] = (uint8_t)((c << 6) | d);
  }
  return written == FC_AVATAR_BYTES;
}
static bool avatar(const cJSON *j, fc_avatar_t *out) {
  if (!j)
    return true;
  const char *const fields[] = {"format", "width", "height", "data", NULL};
  const cJSON *format = get(j, "format"), *width = get(j, "width"),
              *height = get(j, "height"), *data = get(j, "data");
  if (!keys(j, fields) || !cJSON_IsString(format) ||
      strcmp(format->valuestring, "rgb565le") || !cJSON_IsNumber(width) ||
      width->valuedouble != FC_AVATAR_W || !cJSON_IsNumber(height) ||
      height->valuedouble != FC_AVATAR_H || !cJSON_IsString(data) ||
      strlen(data->valuestring) != 1536)
    return false;
  if (!decode_avatar(data->valuestring, (uint8_t *)out->pixels))
    return false;
  out->present = true;
  return true;
}
static bool social(const cJSON *j, fc_social_t *s, int idx) {
  if (!j)
    return true;
  const char *const fields[] = {"name",    "bio",    "url",
                                "metrics", "avatar", NULL};
  const char *const a[] = {"likes",    "followers",    "answers",
                           "articles", "interactions", NULL};
  const char *const b[] = {"likes", "followers", NULL};
  const char *const *names = idx ? b : a;
  if (!keys(j, fields) ||
      !str(get(j, "name"), s->name, sizeof(s->name), true) ||
      !str(get(j, "bio"), s->bio, sizeof(s->bio), false) ||
      !str(get(j, "url"), s->url, sizeof(s->url), true))
    return false;
  const char *prefix = idx ? "https://www.xiaohongshu.com/user/profile/"
                           : "https://www.zhihu.com/people/";
  size_t n = strlen(prefix);
  if (strncmp(s->url, prefix, n) || !s->url[n])
    return false;
  for (const char *p = s->url + n; *p; p++)
    if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
          (*p >= '0' && *p <= '9') || *p == '-' || *p == '_'))
      return false;
  const cJSON *m = get(j, "metrics");
  if (m && !keys(m, names))
    return false;
  for (int i = 0; names[i]; i++) {
    const cJSON *v = get(m, names[i]);
    if (v) {
      if (!num(v, 1e12) || floor(v->valuedouble) != v->valuedouble)
        return false;
      s->metrics[i] = v->valuedouble;
      s->has_metric[i] = true;
    }
  }
  if (!avatar(get(j, "avatar"), &s->avatar))
    return false;
  s->present = true;
  return true;
}
/* Bound cJSON recursion before parsing untrusted BLE bytes. Strings do not
 * contribute to nesting. Reject escaped NUL because cJSON exposes C strings. */
static bool envelope(const char *s, size_t len) {
  int depth = 0;
  bool quoted = false, escaped = false;
  for (size_t i = 0; i < len; i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == '\\' && i + 5 < len && !memcmp(s + i, "\\u0000", 6))
      return false;
    if (quoted) {
      if (escaped)
        escaped = false;
      else if (c == '\\')
        escaped = true;
      else if (c == '"')
        quoted = false;
    } else if (c == '"')
      quoted = true;
    else if (c == '{' || c == '[') {
      if (++depth > 8)
        return false;
    } else if (c == '}' || c == ']') {
      if (--depth < 0)
        return false;
    }
  }
  return !quoted && depth == 0;
}
bool fc_parse(const char *json, size_t len, fc_card_t *out) {
  if (!json || !out || !len || len > FC_MAX_JSON || memchr(json, 0, len) ||
      !envelope(json, len))
    return false;
  const char *end = NULL;
  cJSON *root = cJSON_ParseWithLengthOpts(json, len, &end, false);
  if (!root)
    return false;
  while (end < json + len &&
         (*end == ' ' || *end == '\n' || *end == '\r' || *end == '\t'))
    end++;
  const char *const top[] = {"version", "updatedAt",   "codex",
                             "zhihu",   "xiaohongshu", NULL};
  const char *const cf[] = {"source", "days", "quota", "usage", NULL};
  const char *const df[] = {"date", "intensity", "tokens", NULL};
  const char *const qf[] = {"usedPercent", "resetsAt", NULL};
  const char *const uf[] = {"tokens", "credits", NULL};
  bool ok = false;
  memset(out, 0, sizeof(*out));
  if (end != json + len || !keys(root, top) || !num(get(root, "version"), 1) ||
      get(root, "version")->valuedouble != 1 ||
      !str(get(root, "updatedAt"), out->updated, sizeof(out->updated), true) ||
      !stamp(out->updated))
    goto done;
  const cJSON *c = get(root, "codex");
  if (c) {
    const cJSON *source = get(c, "source");
    if (!keys(c, cf) || !cJSON_IsString(source) ||
        (strcmp(source->valuestring, "profile-ui") &&
         strcmp(source->valuestring, "usage-ui") &&
         strcmp(source->valuestring, "profile-ui+usage-ui")))
      goto done;
    const cJSON *days = get(c, "days");
    if (!cJSON_IsArray(days) || cJSON_GetArraySize(days) > FC_DAYS)
      goto done;
    for (const cJSON *p = days->child; p; p = p->next) {
      fc_day_t *d = &out->days[out->day_count];
      if (!keys(p, df) ||
          !str(get(p, "date"), d->date, sizeof(d->date), true) ||
          !date(d->date) || !num(get(p, "intensity"), 4))
        goto done;
      double intensity = get(p, "intensity")->valuedouble;
      if (floor(intensity) != intensity ||
          (out->day_count &&
           strcmp(out->days[out->day_count - 1].date, d->date) >= 0) ||
          strncmp(d->date, out->updated, 10) > 0)
        goto done;
      d->intensity = (int)intensity;
      const cJSON *t = get(p, "tokens");
      if (t) {
        if (!num(t, 9007199254740991.0) ||
            floor(t->valuedouble) != t->valuedouble)
          goto done;
        d->tokens = t->valuedouble;
        d->has_tokens = true;
      }
      out->day_count++;
    }
    const cJSON *q = get(c, "quota");
    if (q) {
      if (!keys(q, qf) || !num(get(q, "usedPercent"), 100) ||
          !str(get(q, "resetsAt"), out->resets, sizeof(out->resets), true) ||
          !stamp(out->resets))
        goto done;
      out->has_quota = true;
      out->used_percent = get(q, "usedPercent")->valuedouble;
    }
    const cJSON *usage = get(c, "usage");
    if (usage) {
      if (!keys(usage, uf))
        goto done;
      const cJSON *tokens = get(usage, "tokens");
      const cJSON *credits = get(usage, "credits");
      if ((!tokens && !credits) ||
          (tokens && (!num(tokens, 9007199254740991.0) ||
                      floor(tokens->valuedouble) != tokens->valuedouble)) ||
          (credits && !num(credits, 1e12)))
        goto done;
      if (tokens) {
        out->has_usage_tokens = true;
        out->usage_tokens = tokens->valuedouble;
      }
      if (credits) {
        out->has_usage_credits = true;
        out->usage_credits = credits->valuedouble;
      }
    }
  }
  if (!social(get(root, "zhihu"), &out->social[0], 0) ||
      !social(get(root, "xiaohongshu"), &out->social[1], 1))
    goto done;
  if (!c && !out->social[0].present && !out->social[1].present)
    goto done;
  ok = true;
done:
  cJSON_Delete(root);
  return ok;
}
uint32_t fc_crc32(const void *data, size_t len) {
  uint32_t crc = 0xffffffff;
  const uint8_t *p = data;
  for (size_t i = 0; i < len; i++) {
    crc ^= p[i];
    for (int b = 0; b < 8; b++)
      crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}
int fc_page_step(int page, int direction) {
  return (page + (direction < 0 ? 2 : 1)) % 3;
}
static int ordinal(const char *s) {
  int y = 0, m = 0, d = 0;
  sscanf(s, "%4d-%2d-%2d", &y, &m, &d);
  y -= m <= 2;
  int era = y / 400;
  int yo = y - era * 400;
  int mp = m + (m > 2 ? -3 : 9);
  return era * 146097 + yo * 365 + yo / 4 - yo / 100 + (153 * mp + 2) / 5 + d -
         1;
}
int fc_grid_index(const fc_card_t *card, int slot) {
  if (!card->updated[0] || slot < 0 || slot >= FC_DAYS)
    return -1;
  int target = ordinal(card->updated) - 83 + slot;
  for (int i = 0; i < card->day_count; i++)
    if (ordinal(card->days[i].date) == target)
      return i;
  return -1;
}
static uint32_t little32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
         ((uint32_t)p[3] << 24);
}
fc_rx_result_t fc_receive(fc_receiver_t *rx, const uint8_t *frame, size_t len) {
  if (!rx || !frame || !len || len > 244)
    goto bad;
  if (frame[0] == 1 && len == 9) {
    rx->total = little32(frame + 1);
    rx->received = 0;
    rx->checksum = little32(frame + 5);
    if (!rx->total || rx->total > FC_MAX_JSON)
      goto bad;
    return FC_RX_PROGRESS;
  }
  if (!rx->total)
    goto bad;
  if (frame[0] == 2 && len > 3) {
    size_t offset = frame[1] | (frame[2] << 8), n = len - 3;
    if (offset != rx->received || rx->received + n > rx->total)
      goto bad;
    memcpy(rx->json + rx->received, frame + 3, n);
    rx->received += n;
    return FC_RX_PROGRESS;
  }
  if (frame[0] == 3 && len == 1 && rx->received == rx->total &&
      fc_crc32(rx->json, rx->total) == rx->checksum) {
    rx->json[rx->total] = 0;
    return FC_RX_COMPLETE;
  }
bad:
  if (rx)
    rx->total = rx->received = 0;
  return FC_RX_ERROR;
}
int fc_week_active(const fc_card_t *card) {
  if (!card->updated[0])
    return 0;
  int today = ordinal(card->updated), monday = today - (today + 2) % 7,
      active = 0;
  for (int i = 0; i < card->day_count; i++) {
    int day = ordinal(card->days[i].date);
    if (day >= monday && day <= today && card->days[i].intensity > 0)
      active++;
  }
  return active;
}
