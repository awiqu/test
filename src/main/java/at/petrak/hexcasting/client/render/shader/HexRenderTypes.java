package at.petrak.hexcasting.client.render.shader;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import net.minecraft.client.renderer.rendertype.RenderSetup;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.resources.Identifier;
import net.minecraft.util.Util;

import java.util.function.Function;

// https://github.com/VazkiiMods/Botania/blob/3a43accc2fbc439c9f2f00a698f8f8ad017503db/Common/src/main/java/vazkii/botania/client/core/helper/RenderHelper.java
public final class HexRenderTypes {
    private HexRenderTypes() {
    }

    private static RenderType make(String name, RenderPipeline pipeline, Identifier texture, boolean lightmap,
        boolean overlay) {
        var setup = RenderSetup.builder(pipeline).withTexture("Sampler0", texture);
        if (lightmap) {
            setup.useLightmap();
        }
        if (overlay) {
            setup.useOverlay();
        }
        return RenderType.create(name, setup.createRenderSetup());
    }

    private static final Function<Identifier, RenderType> GRAYSCALE_PROVIDER = Util.memoize(texture ->
        make("hexcasting:grayscale", HexRenderPipelines.ENTITY_GRAYSCALE, texture, true, true));

    private static final Function<Identifier, RenderType> LIT_TRIANGLES = Util.memoize(texture ->
        make("hexcasting:lit_triangles", HexRenderPipelines.WORLD_LIT_TRIANGLES, texture, true, false));

    private static final Function<Identifier, RenderType> LIT_QUADS = Util.memoize(texture ->
        make("hexcasting:lit_quads", HexRenderPipelines.WORLD_LIT_QUADS, texture, true, false));

    private static final Function<Identifier, RenderType> UNLIT_TRIANGLES = Util.memoize(texture ->
        make("hexcasting:unlit_triangles", HexRenderPipelines.WORLD_UNLIT_TRIANGLES, texture, false, false));

    private static final RenderType LINES_NO_DEPTH = RenderType.create("hexcasting:lines_no_depth",
        RenderSetup.builder(HexRenderPipelines.WORLD_LINES_NO_DEPTH).createRenderSetup());

    /**
     * An entity-style layer that draws the texture in grayscale.
     */
    public static RenderType getGrayscaleLayer(Identifier texture) {
        return GRAYSCALE_PROVIDER.apply(texture);
    }

    /**
     * Translucent, lit triangles (entity vertex format) sampling the given texture.
     */
    public static RenderType litTriangles(Identifier texture) {
        return LIT_TRIANGLES.apply(texture);
    }

    /**
     * Translucent, lit quads (entity vertex format) sampling the given texture.
     */
    public static RenderType litQuads(Identifier texture) {
        return LIT_QUADS.apply(texture);
    }

    /**
     * Translucent triangles (entity vertex format) that ignore lighting.
     */
    public static RenderType unlitTriangles(Identifier texture) {
        return UNLIT_TRIANGLES.apply(texture);
    }

    /**
     * Translucent lines that are drawn over everything else.
     */
    public static RenderType linesNoDepth() {
        return LINES_NO_DEPTH;
    }
}
