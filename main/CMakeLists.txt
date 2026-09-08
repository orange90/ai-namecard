idf_component_register(
    SRCS "main.c" "ui_pixel.c" "ui_pixel_math.c" "demo_radio.c"
         "folocard_model.c" "folocard_sync.c" "folocard_ui.c"
         "folocard_logos.c"
         "../assets/fonts/folocard_source_han_sans_cn_16.c"
    INCLUDE_DIRS "."
    REQUIRES bsp bt esp_event esp_netif esp_timer nvs_flash json
    EMBED_FILES "../assets/images/folocard-codex-40.argb8888"
                "../assets/images/folocard-zhihu-40.argb8888"
                "../assets/images/folocard-xiaohongshu-40.argb8888"
)
