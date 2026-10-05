package at.petrak.hexcasting.client.gui;

import at.petrak.hexcasting.api.casting.math.HexPattern;
import at.petrak.hexcasting.client.render.PatternColors;
import at.petrak.hexcasting.client.render.PatternRenderer;
import at.petrak.hexcasting.client.render.WorldlyPatternRenderHelpers;
import at.petrak.hexcasting.common.misc.PatternTooltip;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.gui.screens.inventory.tooltip.ClientTooltipComponent;
import net.minecraft.resources.Identifier;
import net.minecraft.world.inventory.tooltip.TooltipComponent;
import org.jetbrains.annotations.Nullable;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

// https://github.com/VazkiiMods/Botania/blob/95bd2d3fbc857b7c102687554e1d1b112f8af436/Xplat/src/main/java/vazkii/botania/client/gui/ManaBarTooltipComponent.java
// yoink

/**
 * @see PatternTooltip the associated data for this
 */
public class PatternTooltipComponent implements ClientTooltipComponent {
    public static final Identifier PRISTINE_BG = modLoc("textures/gui/scroll.png");
    public static final Identifier ANCIENT_BG = modLoc("textures/gui/scroll_ancient.png");
    public static final Identifier SLATE_BG = modLoc("textures/gui/slate.png");

    private static final float RENDER_SIZE = 128f;
    private static final int TEXTURE_SIZE = 48;

    private final HexPattern pattern;
    private final Identifier background;

    public PatternTooltipComponent(PatternTooltip tt) {
        this.pattern = tt.pattern();
        this.background = tt.background();
    }

    @Nullable
    public static ClientTooltipComponent tryConvert(TooltipComponent cmp) {
        if (cmp instanceof PatternTooltip ptt) {
            return new PatternTooltipComponent(ptt);
        }
        return null;
    }

    @Override
    public void extractImage(Font font, int x, int y, int w, int h, GuiGraphicsExtractor graphics) {
        var ps = graphics.pose();

        // "x" and "y" are the position of the corner of the tooltip
        ps.pushMatrix();
        ps.translate(x, y);
        renderBG(graphics, this.background);

        ps.scale(RENDER_SIZE, RENDER_SIZE);

        PatternRenderer.renderPattern(pattern, graphics, WorldlyPatternRenderHelpers.READABLE_SCROLL_SETTINGS,
                (PatternRenderer.shouldDoStrokeGradient() ? PatternColors.DEFAULT_GRADIENT_COLOR : PatternColors.DEFAULT_PATTERN_COLOR)
                        .withDots(true, true),
                0, 512);

        ps.popMatrix();
    }

    private static void renderBG(GuiGraphicsExtractor graphics, Identifier background) {
        graphics.blit(
            RenderPipelines.GUI_TEXTURED,
            background, // texture
            0, 0, // x, y
            0f, 0f, // u, v (textureCoords)
            (int) RENDER_SIZE, (int) RENDER_SIZE, // renderWidth, renderHeight
            TEXTURE_SIZE, TEXTURE_SIZE, // regionWidth, regionHeight (texture sample dimensions)
            TEXTURE_SIZE, TEXTURE_SIZE); // textureWidth, textureHeight (total dimensions of texture)
    }

    @Override
    public int getWidth(Font pFont) {
        return (int) RENDER_SIZE;
    }

    @Override
    public int getHeight(Font font) {
        return (int) RENDER_SIZE;
    }
}
