package at.petrak.hexcasting.server;

import at.petrak.hexcasting.api.HexAPI;
import at.petrak.hexcasting.api.casting.ActionRegistryEntry;
import at.petrak.hexcasting.api.casting.math.EulerPathFinder;
import at.petrak.hexcasting.api.casting.math.HexDir;
import at.petrak.hexcasting.api.casting.math.HexSignature;
import at.petrak.hexcasting.api.mod.HexTags;
import at.petrak.hexcasting.api.utils.HexUtils;
import at.petrak.hexcasting.xplat.IXplatAbstractions;
import com.mojang.datafixers.util.Pair;
import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.datafix.DataFixTypes;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import org.jetbrains.annotations.Nullable;

import java.util.HashMap;
import java.util.Map;

/**
 * Maps angle sigs to resource locations and their preferred start dir so we can look them up in the main registry
 * Save this on the world in case the random algorithm changes.
 */
public class ScrungledPatternsSave extends SavedData {
    public static final String DATA_VERSION = "0.1.0";
    public static final Identifier SAVED_DATA_ID = HexAPI.modLoc("per_world_patterns");
    private static final String TAG_DIR = "startDir";
    private static final String TAG_KEY = "key";

    /**
     * Maps scrungled signatures to their keys.
     */
    private final Map<HexSignature, PerWorldEntry> lookup;

    /**
     * Reverse-maps resource keys to their signature; you can use that in {@code lookup}.
     * <p>
     * This way we can look up things if we know their resource key, for commands and such
     */
    private final Map<ResourceKey<ActionRegistryEntry>, HexSignature> reverseLookup;

    private ScrungledPatternsSave(Map<HexSignature, PerWorldEntry> lookup) {
        this.lookup = lookup;
        this.reverseLookup = new HashMap<>();
        this.lookup.forEach((sig, entry) -> {
            this.reverseLookup.put(entry.key, sig);
        });
    }

    @Nullable
    public PerWorldEntry lookup(HexSignature signature) {
        return this.lookup.get(signature);
    }

    @Nullable
    public Pair<HexSignature, PerWorldEntry> lookupReverse(ResourceKey<ActionRegistryEntry> key) {
        var sig = this.reverseLookup.get(key);
        if (sig == null) return null;

        return Pair.of(sig, this.lookup.get(sig));
    }

    private static Codec<ScrungledPatternsSave> makeCodec() {
        var registryKey = IXplatAbstractions.INSTANCE.getActionRegistry().key();

        Codec<ResourceKey<ActionRegistryEntry>> keyCodec = Identifier.CODEC.xmap(
            id -> ResourceKey.create(registryKey, id), ResourceKey::identifier);
        Codec<HexDir> dirCodec = Codec.BYTE.xmap(
            b -> HexDir.getEntries().get(b), d -> (byte) d.ordinal());
        Codec<PerWorldEntry> entryCodec = RecordCodecBuilder.create(inst -> inst.group(
            keyCodec.fieldOf(TAG_KEY).forGetter(PerWorldEntry::key),
            dirCodec.fieldOf(TAG_DIR).forGetter(PerWorldEntry::canonicalStartDir)
        ).apply(inst, PerWorldEntry::new));

        // We don't save the reverse lookup cause we can reconstruct it when loading.
        return Codec.unboundedMap(Codec.STRING, entryCodec).xmap(
            raw -> {
                var map = new HashMap<HexSignature, PerWorldEntry>();
                raw.forEach((sig, entry) -> map.put(HexSignature.fromAnglesStringUnchecked(sig), entry));
                return new ScrungledPatternsSave(map);
            },
            save -> {
                var raw = new HashMap<String, PerWorldEntry>();
                save.lookup.forEach((sig, entry) -> raw.put(sig.toAnglesString(), entry));
                return raw;
            });
    }

    /**
     * The saved data type. The seed is only used to generate the data if it doesn't exist yet.
     */
    public static SavedDataType<ScrungledPatternsSave> type(long seed) {
        return new SavedDataType<>(
            SAVED_DATA_ID,
            () -> ScrungledPatternsSave.createFromScratch(seed),
            makeCodec(),
            DataFixTypes.PLAYER);
    }

    public static ScrungledPatternsSave createFromScratch(long seed) {
        var map = new HashMap<HexSignature, PerWorldEntry>();

        var registry = IXplatAbstractions.INSTANCE.getActionRegistry();

        // TODO: this version of the code doesn't have overlap protection
        // this means if some hilarious funny person makes a great spell that has the same shape as a normal spell
        // there might be overlap.
        // I'm going to file that under "don't do that"
        // (the number literal phial incident won't happen though because we check for special handlers first now)
        for (var key : registry.registryKeySet()) {
            var entry = registry.getValueOrThrow(key);
            if (HexUtils.isOfTag(registry, key, HexTags.Actions.PER_WORLD_PATTERN)) {
                var scrungledPat = EulerPathFinder.findAltDrawing(entry.prototype(), seed);
                map.put(scrungledPat.getSignature(), new PerWorldEntry(key, scrungledPat.getOrientation()));
            }
        }

        var out = new ScrungledPatternsSave(map);
        out.setDirty();
        return out;
    }

    public static ScrungledPatternsSave open(ServerLevel overworld) {
        return overworld.getDataStorage().computeIfAbsent(type(overworld.getSeed()));
    }

    public record PerWorldEntry(ResourceKey<ActionRegistryEntry> key, HexDir canonicalStartDir) {
    }
}
