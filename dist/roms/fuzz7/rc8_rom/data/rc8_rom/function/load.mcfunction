# прошивка ПЗУ RC-8: fuzz7.asm, 512 слов; ~ ~ ~ = та же точка, что у rc8:build
place template rc8_rom:b0 ~40 ~1 ~553
place template rc8_rom:b1 ~118 ~1 ~553
place template rc8_rom:b2 ~196 ~1 ~553
place template rc8_rom:b3 ~274 ~1 ~553
clone ~40 ~1 ~553 ~70 ~1 ~807 ~40 ~1 ~553 replace force
clone ~118 ~1 ~553 ~148 ~1 ~807 ~118 ~1 ~553 replace force
clone ~196 ~1 ~553 ~226 ~1 ~807 ~196 ~1 ~553 replace force
clone ~274 ~1 ~553 ~304 ~1 ~807 ~274 ~1 ~553 replace force
