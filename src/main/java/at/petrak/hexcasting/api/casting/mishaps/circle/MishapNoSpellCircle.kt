package at.petrak.hexcasting.api.casting.mishaps.circle

import at.petrak.hexcasting.api.casting.eval.CastingEnvironment
import at.petrak.hexcasting.api.casting.iota.Iota
import at.petrak.hexcasting.api.casting.mishaps.Mishap
import at.petrak.hexcasting.api.pigment.FrozenPigment
import net.minecraft.core.component.DataComponents
import at.petrak.hexcasting.api.utils.TreeList
import net.minecraft.server.level.ServerPlayer
import net.minecraft.world.entity.EquipmentSlot
import net.minecraft.world.entity.player.Inventory
import net.minecraft.world.item.DyeColor
import net.minecraft.world.item.ItemStack
import net.minecraft.world.item.enchantment.Enchantments

class MishapNoSpellCircle : Mishap() {
    override fun accentColor(env: CastingEnvironment, errorCtx: Context): FrozenPigment =
        dyeColor(DyeColor.LIGHT_BLUE)

    override fun execute(env: CastingEnvironment, errorCtx: Context, stack: TreeList<Iota>): TreeList<Iota> {
        val caster = env.castingEntity as? ServerPlayer
        if (caster != null) {
            // FIXME: handle null caster case
            val inv = caster.inventory
            for (slot in 0 until inv.containerSize) {
                val stack = inv.getItem(slot)
                if (stack.isEmpty) continue
                // armor slots keep items that have curse of binding
                val isArmorSlot = Inventory.EQUIPMENT_SLOT_MAPPING[slot]?.let { it.type == EquipmentSlot.Type.HUMANOID_ARMOR } ?: false
                if (isArmorSlot && stack.get(DataComponents.ENCHANTMENTS)?.keySet()?.any { e -> e.`is`(Enchantments.BINDING_CURSE) } == true) continue
                caster.drop(stack, true)
                inv.setItem(slot, ItemStack.EMPTY)
            }
        }
        return stack
    }

    override fun errorMessage(env: CastingEnvironment, errorCtx: Context) =
        error("no_spell_circle")
}
