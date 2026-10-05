package at.petrak.hexcasting.client.render.shader;

import at.petrak.hexcasting.api.HexAPI;
import com.mojang.blaze3d.PrimitiveTopology;
import com.mojang.blaze3d.pipeline.BlendFunction;
import com.mojang.blaze3d.pipeline.ColorTargetState;
import com.mojang.blaze3d.pipeline.DepthStencilState;
import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.platform.CompareOp;
import net.minecraft.client.renderer.BindGroupLayouts;
import net.minecraft.client.renderer.RenderPipelines;

/**
 * The render pipelines Hex uses for drawing patterns, in the GUI and in the world.
 * <p>
 * All of the pattern geometry is made out of plain triangles, which vanilla has no pipelines for.
 * They are registered with vanilla so they get precompiled (and recompiled on resource reloads).
 */
public final class HexRenderPipelines {
    private HexRenderPipelines() {
    }

    /**
     * Flat-colored triangles in the GUI. Uses vanilla's GUI shader, just with a different primitive topology.
     */
    public static final RenderPipeline GUI_TRIANGLES = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.GUI_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/gui_triangles"))
            .withPrimitiveTopology(PrimitiveTopology.TRIANGLES)
            .build());

    /**
     * Textured triangles in the GUI.
     */
    public static final RenderPipeline GUI_TEXTURED_TRIANGLES = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.GUI_TEXTURED_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/gui_textured_triangles"))
            .withPrimitiveTopology(PrimitiveTopology.TRIANGLES)
            .build());

    /**
     * Translucent, lit (lightmap + normal-based shading) triangles in the world, in the entity vertex format.
     * Culling is off because the zappy lines are not wound consistently.
     */
    public static final RenderPipeline WORLD_LIT_TRIANGLES = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.ENTITY_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/world_lit_triangles"))
            .withShaderDefine("ALPHA_CUTOUT", 0.1F)
            .withShaderDefine("NO_OVERLAY")
            .withColorTargetState(new ColorTargetState(BlendFunction.TRANSLUCENT))
            .withPrimitiveTopology(PrimitiveTopology.TRIANGLES)
            .withCull(false)
            .build());

    /**
     * Translucent, lit quads in the world, in the entity vertex format. Used for the pattern textures.
     */
    public static final RenderPipeline WORLD_LIT_QUADS = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.ENTITY_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/world_lit_quads"))
            .withShaderDefine("ALPHA_CUTOUT", 0.1F)
            .withShaderDefine("NO_OVERLAY")
            .withColorTargetState(new ColorTargetState(BlendFunction.TRANSLUCENT))
            .withPrimitiveTopology(PrimitiveTopology.QUADS)
            .withCull(false)
            .build());

    /**
     * Translucent triangles in the world that ignore the lightmap and any directional shading.
     */
    public static final RenderPipeline WORLD_UNLIT_TRIANGLES = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.ENTITY_EMISSIVE_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/world_unlit_triangles"))
            .withShaderDefine("ALPHA_CUTOUT", 0.1F)
            .withShaderDefine("NO_OVERLAY")
            .withShaderDefine("NO_CARDINAL_LIGHTING")
            .withColorTargetState(new ColorTargetState(BlendFunction.TRANSLUCENT))
            .withPrimitiveTopology(PrimitiveTopology.TRIANGLES)
            .withCull(false)
            .build());

    /**
     * Translucent lines in the world that ignore depth. Used for the sentinel.
     */
    public static final RenderPipeline WORLD_LINES_NO_DEPTH = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.LINES_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/world_lines_no_depth"))
            .withDepthStencilState(java.util.Optional.empty())
            .build());

    /**
     * Same as vanilla's cutout, no cull entity pipeline, except that the end result is turned into grayscale.
     */
    public static final RenderPipeline ENTITY_GRAYSCALE = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.ENTITY_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/entity_grayscale"))
            .withFragmentShader(HexAPI.modLoc("core/grayscale"))
            .withShaderDefine("ALPHA_CUTOUT", 0.1F)
            .withBindGroupLayout(BindGroupLayouts.SAMPLER1)
            .withCull(false)
            .build());

    /**
     * Additive blending particles that don't write to the depth buffer. Used by the conjure particles.
     */
    public static final RenderPipeline PARTICLE_ADDITIVE = RenderPipelines.register(
        RenderPipeline.builder(RenderPipelines.PARTICLE_SNIPPET)
            .withLocation(HexAPI.modLoc("pipeline/particle_additive"))
            .withColorTargetState(new ColorTargetState(BlendFunction.LIGHTNING))
            .withDepthStencilState(new DepthStencilState(CompareOp.GREATER_THAN_OR_EQUAL, false))
            .build());

    /**
     * Called to make sure the class is loaded (and thus the pipelines registered) early enough for the first
     * resource reload.
     */
    public static void init() {
    }
}
