package at.petrak.hexcasting.api.mod;

import at.petrak.hexcasting.api.misc.MediaConstants;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.stats.StatFormatter;
import net.minecraft.stats.Stats;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

public class HexStatistics {
    public static final Identifier MEDIA_USED = makeCustomStat("media_used",
        mediamount -> StatFormatter.DEFAULT.format((int) (mediamount / MediaConstants.DUST_UNIT)));
    public static final Identifier MEDIA_OVERCAST = makeCustomStat("media_overcast",
        mediamount -> StatFormatter.DEFAULT.format((int) (mediamount / MediaConstants.DUST_UNIT)));
    public static final Identifier PATTERNS_DRAWN = makeCustomStat("patterns_drawn", StatFormatter.DEFAULT);
    public static final Identifier SPELLS_CAST = makeCustomStat("spells_cast", StatFormatter.DEFAULT);

    public static void register() {
        // wake up java
    }

    private static Identifier makeCustomStat(String key, StatFormatter formatter) {
        Identifier resourcelocation = modLoc(key);
        Registry.register(BuiltInRegistries.CUSTOM_STAT, key, resourcelocation);
        Stats.CUSTOM.get(resourcelocation, formatter);
        return resourcelocation;
    }
}
