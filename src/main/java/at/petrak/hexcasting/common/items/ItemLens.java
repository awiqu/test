package at.petrak.hexcasting.common.items;

import at.petrak.hexcasting.api.HexAPI;
import at.petrak.hexcasting.common.lib.HexAttributes;
import com.google.common.collect.HashMultimap;
import com.google.common.collect.Multimap;
import net.minecraft.core.Holder;
import net.minecraft.world.entity.EquipmentSlotGroup;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.ItemAttributeModifiers;

public class ItemLens extends Item implements HexBaubleItem { // Wearable,

    // The 0.1 is *additive*

    public static final AttributeModifier GRID_ZOOM = new AttributeModifier(
            HexAPI.modLoc("scrying_lens_zoom"), 0.33, AttributeModifier.Operation.ADD_MULTIPLIED_BASE);

    public static final AttributeModifier SCRY_SIGHT = new AttributeModifier(
            HexAPI.modLoc("scrying_lens_sight"), 1.0, AttributeModifier.Operation.ADD_VALUE);

    public static final ItemAttributeModifiers MODIFIERS = ItemAttributeModifiers.builder()
            .add(HexAttributes.GRID_ZOOM, GRID_ZOOM, EquipmentSlotGroup.HAND)
            .add(HexAttributes.GRID_ZOOM, GRID_ZOOM, EquipmentSlotGroup.HEAD)
            .add(HexAttributes.SCRY_SIGHT, SCRY_SIGHT, EquipmentSlotGroup.HAND)
            .add(HexAttributes.SCRY_SIGHT, SCRY_SIGHT, EquipmentSlotGroup.HEAD)
            .build();

    public ItemLens(Properties pProperties) {
        // Equippable on the head (and thus dispensable) via the EQUIPPABLE component set in HexItems
        super(pProperties);
    }

    @Override
    public Multimap<Holder<Attribute>, AttributeModifier> getHexBaubleAttrs(ItemStack stack) {
        HashMultimap<Holder<Attribute>, AttributeModifier> out = HashMultimap.create();
        out.put(HexAttributes.GRID_ZOOM, GRID_ZOOM);
        out.put(HexAttributes.SCRY_SIGHT, SCRY_SIGHT);
        return out;
    }

//    @Nullable
//    @Override
//    public SoundEvent getEquipSound() {
//        return SoundEvents.AMETHYST_BLOCK_CHIME;
//    }

}
