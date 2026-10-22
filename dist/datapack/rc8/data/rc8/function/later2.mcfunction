execute at @e[type=marker,tag=rc8_origin,limit=1] run function rc8:refresh
execute at @e[type=marker,tag=rc8_origin,limit=1] run function rc8:clear_display
schedule function rc8:rst_press 200t
