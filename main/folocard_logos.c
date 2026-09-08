#include "folocard_logos.h"

#define FC_LOGO_SIZE 40
#define FC_LOGO_DATA_SIZE (FC_LOGO_SIZE * FC_LOGO_SIZE * 4)

/* Symbols are emitted from the matching EMBED_FILES entries in CMakeLists.txt. */
extern const uint8_t folocard_codex_40_argb8888[];
extern const uint8_t folocard_zhihu_40_argb8888[];
extern const uint8_t folocard_xiaohongshu_40_argb8888[];

static const lv_image_dsc_t codex = {
    .header = {.magic = LV_IMAGE_HEADER_MAGIC,
               .cf = LV_COLOR_FORMAT_ARGB8888,
               .w = FC_LOGO_SIZE,
               .h = FC_LOGO_SIZE,
               .stride = FC_LOGO_SIZE * 4},
    .data_size = FC_LOGO_DATA_SIZE,
    .data = folocard_codex_40_argb8888,
};

static const lv_image_dsc_t zhihu = {
    .header = {.magic = LV_IMAGE_HEADER_MAGIC,
               .cf = LV_COLOR_FORMAT_ARGB8888,
               .w = FC_LOGO_SIZE,
               .h = FC_LOGO_SIZE,
               .stride = FC_LOGO_SIZE * 4},
    .data_size = FC_LOGO_DATA_SIZE,
    .data = folocard_zhihu_40_argb8888,
};

static const lv_image_dsc_t xiaohongshu = {
    .header = {.magic = LV_IMAGE_HEADER_MAGIC,
               .cf = LV_COLOR_FORMAT_ARGB8888,
               .w = FC_LOGO_SIZE,
               .h = FC_LOGO_SIZE,
               .stride = FC_LOGO_SIZE * 4},
    .data_size = FC_LOGO_DATA_SIZE,
    .data = folocard_xiaohongshu_40_argb8888,
};

void fc_logo_create(lv_obj_t *parent, fc_logo_t logo, int x, int y) {
  static const lv_image_dsc_t *const images[] = {&codex, &zhihu,
                                                   &xiaohongshu};
  if (logo < FC_LOGO_CODEX || logo > FC_LOGO_XIAOHONGSHU)
    return;
  lv_obj_t *image = lv_image_create(parent);
  lv_image_set_src(image, images[logo]);
  lv_obj_set_pos(image, x, y);
}
