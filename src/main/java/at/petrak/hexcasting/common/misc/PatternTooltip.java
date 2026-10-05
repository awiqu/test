package at.petrak.hexcasting.common.misc;

import at.petrak.hexcasting.api.casting.math.HexPattern;
import net.minecraft.resources.Identifier;
import net.minecraft.world.inventory.tooltip.TooltipComponent;

/**
 * Used for displaying patterns on the tooltips for scrolls and slates.
 *
 * @see at.petrak.hexcasting.client.gui.PatternTooltipComponent the client-side renderer for this
 */
public record PatternTooltip(HexPattern pattern, Identifier background) implements TooltipComponent {
}
