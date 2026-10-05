package at.petrak.hexcasting.client;

import at.petrak.hexcasting.api.item.IotaHolderItem;
import at.petrak.hexcasting.api.item.MediaHolderItem;
import at.petrak.hexcasting.api.item.VariantItem;
import at.petrak.hexcasting.api.misc.MediaConstants;
import at.petrak.hexcasting.client.render.GaslightingTracker;
import at.petrak.hexcasting.common.items.magic.ItemMediaBattery;
import at.petrak.hexcasting.common.items.magic.ItemPackagedHex;
import at.petrak.hexcasting.common.items.storage.ItemFocus;
import at.petrak.hexcasting.common.items.storage.ItemSlate;
import at.petrak.hexcasting.common.items.storage.ItemSpellbook;
import at.petrak.hexcasting.common.items.storage.ItemThoughtKnot;
import at.petrak.hexcasting.common.lib.HexDataComponents;
import at.petrak.hexcasting.common.lib.HexItems;
import com.mojang.serialization.MapCodec;
import net.minecraft.client.color.item.ItemTintSource;
import net.minecraft.client.color.item.ItemTintSources;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.item.properties.numeric.RangeSelectItemModelProperties;
import net.minecraft.client.renderer.item.properties.numeric.RangeSelectItemModelProperty;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.entity.ItemOwner;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import org.jetbrains.annotations.Nullable;

import java.util.Locale;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

/**
 * In 1.21.1 and before, we had a bunch of "item property overrides" that picked a model based on some number.
 * Those are gone, replaced by item model definitions (assets/hexcasting/items/*.json) which can use a
 * <code>range_dispatch</code> on a property. Here are the custom properties we use there. They all have the
 * same names (and, for the most part, values) as the old ones.
 * <p>
 * There's also the tint source for the colored overlay of the foci and such.
 */
public final class HexItemProperties {
    private HexItemProperties() {
    }

    public enum Kind {
        /** 0 = empty, 1 = holds an iota, 2 = holds a sealed iota */
        OVERLAY_LAYER {
            @Override
            float get(ItemStack stack) {
                boolean hasIota;
                boolean sealed;
                if (stack.getItem() instanceof ItemFocus) {
                    hasIota = stack.has(HexDataComponents.IOTA_HOLDER_IOTA.get());
                    sealed = ItemFocus.isSealed(stack);
                } else if (stack.getItem() instanceof ItemSpellbook book) {
                    hasIota = book.readIota(stack) != null;
                    sealed = ItemSpellbook.isSealed(stack);
                } else {
                    return 0;
                }
                if (!hasIota && !stack.has(HexDataComponents.VISUAL_OVERRIDE.get())) {
                    return 0;
                }
                return sealed ? 2 : 1;
            }
        },
        /** Cycles through 0-3 constantly, unless you look at it. */
        GASLIGHTING {
            @Override
            float get(ItemStack stack) {
                return Math.abs(GaslightingTracker.getGaslightingAmount() % 4);
            }
        },
        MEDIA_FULLNESS {
            @Override
            float get(ItemStack stack) {
                return stack.getItem() instanceof MediaHolderItem item ? item.getMediaFullness(stack) : 0f;
            }
        },
        MAX_MEDIA_SCALE {
            @Override
            float get(ItemStack stack) {
                if (!(stack.getItem() instanceof ItemMediaBattery item)) {
                    return 0f;
                }
                var max = item.getMaxMedia(stack);
                return 1.049658f * (float) Math.log((float) max / MediaConstants.CRYSTAL_UNIT + 9.06152f) - 2.1436f;
            }
        }
        ;

        abstract float get(ItemStack stack);

        public String id() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    private record Property(Kind kind, MapCodec<Property> codec) implements RangeSelectItemModelProperty {
        @Override
        public float get(ItemStack stack, @Nullable ClientLevel level, @Nullable ItemOwner owner, int seed) {
            return kind.get(stack);
        }

        @Override
        public MapCodec<? extends RangeSelectItemModelProperty> type() {
            return codec;
        }
    }

    /**
     * Colors the layers of an item that stores an iota, in the manner of foci and spellbooks.
     * Use as a tint on the layer you want colored (the one with the iota color in it).
     */
    public record IotaColorTint() implements ItemTintSource {
        public static final MapCodec<IotaColorTint> CODEC = MapCodec.unit(new IotaColorTint());

        @Override
        public int calculate(ItemStack stack, @Nullable ClientLevel level, @Nullable LivingEntity owner) {
            if (stack.getItem() instanceof IotaHolderItem holder) {
                return 0xff_000000 | holder.getColor(stack);
            }
            return 0xff_ffffff;
        }

        @Override
        public MapCodec<IotaColorTint> type() {
            return CODEC;
        }
    }

    public static void register() {
        for (var kind : Kind.values()) {
            var codecHolder = new MapCodec[1];
            @SuppressWarnings("unchecked")
            MapCodec<Property> codec = MapCodec.unit(() -> new Property(kind, (MapCodec<Property>) codecHolder[0]));
            codecHolder[0] = codec;
            RangeSelectItemModelProperties.ID_MAPPER.put(modLoc(kind.id()), codec);
        }
        ItemTintSources.ID_MAPPER.put(modLoc("iota_color"), IotaColorTint.CODEC);
    }
}
