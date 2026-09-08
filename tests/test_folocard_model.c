#include "folocard_model.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static fc_card_t card;
static bool parse(const char *s) { return fc_parse(s, strlen(s), &card); }
int main(void) {
  assert(fc_crc32("123456789", 9) == 0xcbf43926);
  assert(fc_page_step(0, -1) == 2 && fc_page_step(2, 1) == 0);
  assert(parse("{\"version\":1,\"updatedAt\":\"2026-09-07T10:30:00+08:00\","
               "\"codex\":{\"source\":\"profile-ui\",\"days\":[{\"date\":"
               "\"2026-09-07\",\"intensity\":4}]}}"));
  assert(card.day_count == 1 && !card.days[0].has_tokens);
  assert(fc_week_active(&card) == 1);
  assert(fc_grid_index(&card, 83) == 0 && fc_grid_index(&card, 82) == -1);
  assert(!parse("{\"version\":1,\"version\":1,\"updatedAt\":\"2026-09-07T10:30:"
                "00Z\",\"codex\":{\"source\":\"profile-ui\",\"days\":[]}}"));
  assert(!parse("{\"version\":1,\"updatedAt\":\"2026-09-07T10:30:00Z\","
                "\"cookie\":\"forbidden\"}"));
  assert(!parse("{\"version\":1,\"updatedAt\":\"2026-02-30T10:30:00Z\","
                "\"codex\":{\"source\":\"profile-ui\",\"days\":[]}}"));
  assert(!parse("{\"version\":1,\"updatedAt\":\"2026-09-07T10:30:00Z\","
                "\"codex\":{\"source\":\"profile-ui\",\"days\":[{\"date\":"
                "\"2026-09-07\",\"intensity\":1.5}]}}"));
  assert(!parse(
      "{\"version\":1,\"updatedAt\":\"2026-09-07T10:30:00Z\",\"zhihu\":{"
      "\"name\":\"a\",\"url\":\"https://www.zhihu.com/people/a?token=bad\"}}"));
  assert(!parse("{\"version\":1,\"updatedAt\":\"2026-09-07T10:30:00Z\","
                "\"codex\":{\"source\":\"profile-ui\",\"days\":[]}}junk"));
  assert(parse("{\"version\":1,\"updatedAt\":\"2026-09-07T10:30:00Z\","
               "\"codex\":{\"source\":\"usage-ui\",\"days\":[],\"usage\":"
               "{\"tokens\":123456,\"credits\":3.5},\"quota\":{\"usedPercent\":"
               "42,\"resetsAt\":\"2026-09-08T00:00:00Z\"}}}"));
  assert(card.has_usage_tokens && card.usage_tokens == 123456);
  assert(card.has_usage_credits && card.usage_credits == 3.5);
  char avatar_json[2300], encoded[1537];
  memset(encoded, 'A', sizeof(encoded) - 1);
  encoded[sizeof(encoded) - 1] = 0;
  snprintf(avatar_json, sizeof(avatar_json),
           "{\"version\":1,\"updatedAt\":\"2026-09-07T10:30:00Z\","
           "\"zhihu\":{\"name\":\"a\",\"url\":\"https://www.zhihu.com/"
           "people/a\",\"avatar\":{\"format\":\"rgb565le\",\"width\":24,"
           "\"height\":24,\"data\":\"%s\"}}}",
           encoded);
  assert(parse(avatar_json) && card.social[0].avatar.present &&
         card.social[0].avatar.pixels[0] == 0);
  avatar_json[strstr(avatar_json, encoded) - avatar_json] = '!';
  assert(!parse(avatar_json));
  static fc_receiver_t rx;
  const uint8_t begin[] = {1,    3,    0,    0,   0,
                           0xc2, 0x41, 0x24, 0x35}; /* CRC32 abc */
  const uint8_t data[] = {2, 0, 0, 'a', 'b', 'c'}, commit[] = {3},
                bad_offset[] = {2, 1, 0, 'b'};
  assert(fc_receive(&rx, begin, sizeof(begin)) == FC_RX_PROGRESS);
  assert(fc_receive(&rx, commit, 1) == FC_RX_ERROR); /* interrupted transfer */
  assert(fc_receive(&rx, begin, sizeof(begin)) == FC_RX_PROGRESS);
  assert(fc_receive(&rx, bad_offset, sizeof(bad_offset)) == FC_RX_ERROR);
  assert(fc_receive(&rx, begin, sizeof(begin)) == FC_RX_PROGRESS);
  assert(fc_receive(&rx, data, sizeof(data)) == FC_RX_PROGRESS);
  assert(fc_receive(&rx, commit, 1) == FC_RX_COMPLETE);
  assert(!strcmp(rx.json, "abc"));
  assert(fc_receive(&rx, begin, sizeof(begin)) == FC_RX_PROGRESS);
  assert(fc_receive(&rx, data, sizeof(data)) == FC_RX_PROGRESS);
  rx.json[0] = 'x';
  assert(fc_receive(&rx, commit, 1) == FC_RX_ERROR);
  assert(parse("{\"version\":1,\"updatedAt\":\"2026-09-08T10:30:00+08:00\","
               "\"codex\":{\"source\":\"usage-ui\",\"days\":["
               "{\"date\":\"2026-09-06\",\"intensity\":4},"
               "{\"date\":\"2026-09-07\",\"intensity\":1},"
               "{\"date\":\"2026-09-08\",\"intensity\":2}]}}"));
  assert(fc_week_active(&card) == 2); /* Sunday is outside the Monday week. */
  puts("FoloCard model: PASS");
}
