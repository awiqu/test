package at.petrak.hexcasting.common.items.armor;

import at.petrak.hexcasting.api.HexAPI;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.equipment.ArmorType;

/**
 * To get the armor model in, an equipment asset (assets/hexcasting/equipment/robes.json) is used.
 */
public class ItemRobes extends Item {
    public final ArmorType type;

    public ItemRobes(ArmorType type, Properties properties) {
        super(properties.humanoidArmor(HexAPI.instance().robesMaterial(), type));
        this.type = type;
    }
}
