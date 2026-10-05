package at.petrak.hexcasting.client.render

import at.petrak.hexcasting.api.HexAPI
import at.petrak.hexcasting.client.render.PatternRenderer.WorldlyBits
import at.petrak.hexcasting.client.render.shader.HexRenderPipelines
import at.petrak.hexcasting.client.render.shader.HexRenderTypes
import com.mojang.blaze3d.PrimitiveTopology
import com.mojang.blaze3d.pipeline.RenderPipeline
import com.mojang.blaze3d.vertex.PoseStack
import com.mojang.blaze3d.vertex.VertexConsumer
import net.minecraft.client.Minecraft
import net.minecraft.client.gui.GuiGraphicsExtractor
import net.minecraft.client.gui.navigation.ScreenRectangle
import net.minecraft.client.gui.render.TextureSetup
import net.minecraft.client.renderer.RenderPipelines
import net.minecraft.client.renderer.state.gui.GuiElementRenderState
import net.minecraft.client.renderer.texture.OverlayTexture
import net.minecraft.resources.Identifier
import net.minecraft.util.LightCoordsUtil
import net.minecraft.world.phys.Vec2
import net.minecraft.world.phys.Vec3
import org.joml.Matrix4f
import org.joml.Vector3f
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max

/**
 * Minecraft's rendering is deferred: nothing is drawn right when you ask for it, instead you describe what you want to
 * be drawn ("submit" it to the world renderer or add a render state to the GUI renderer) and it all gets drawn later.
 *
 * This is a growable buffer of vertices that the pattern drawing code writes to. Once a bit of geometry
 * is done, the [VCDrawHelper] hands it over to whichever renderer is appropriate.
 *
 * Positions are stored already transformed.
 */
class HexMesh(val topology: PrimitiveTopology) : VertexConsumer {
    private var cap = 64
    private var pos = FloatArray(cap * 3)
    private var uv = FloatArray(cap * 2)
    private var nrm = FloatArray(cap * 3)
    private var cols = IntArray(cap)
    private var light = IntArray(cap)

    var count = 0
        private set

    private fun grow() {
        cap *= 2
        pos = pos.copyOf(cap * 3)
        uv = uv.copyOf(cap * 2)
        nrm = nrm.copyOf(cap * 3)
        cols = cols.copyOf(cap)
        light = light.copyOf(cap)
    }

    override fun addVertex(x: Float, y: Float, z: Float): VertexConsumer {
        if (count == cap) grow()
        val i = count++
        pos[i * 3] = x
        pos[i * 3 + 1] = y
        pos[i * 3 + 2] = z
        uv[i * 2] = 0f
        uv[i * 2 + 1] = 0f
        nrm[i * 3] = 0f
        nrm[i * 3 + 1] = 1f
        nrm[i * 3 + 2] = 0f
        cols[i] = -1
        light[i] = LightCoordsUtil.FULL_BRIGHT
        return this
    }

    override fun setColor(r: Int, g: Int, b: Int, a: Int): VertexConsumer {
        cols[count - 1] = ((a and 0xff) shl 24) or ((r and 0xff) shl 16) or ((g and 0xff) shl 8) or (b and 0xff)
        return this
    }

    override fun setColor(color: Int): VertexConsumer {
        cols[count - 1] = color
        return this
    }

    override fun setUv(u: Float, v: Float): VertexConsumer {
        uv[(count - 1) * 2] = u
        uv[(count - 1) * 2 + 1] = v
        return this
    }

    override fun setUv1(u: Int, v: Int): VertexConsumer = this

    override fun setUv2(u: Int, v: Int): VertexConsumer {
        light[count - 1] = (u and 0xffff) or ((v and 0xffff) shl 16)
        return this
    }

    override fun setNormal(x: Float, y: Float, z: Float): VertexConsumer {
        nrm[(count - 1) * 3] = x
        nrm[(count - 1) * 3 + 1] = y
        nrm[(count - 1) * 3 + 2] = z
        return this
    }

    override fun setLineWidth(width: Float): VertexConsumer = this

    /** The topology that [replay] will actually emit. Triangle fans get unrolled into plain triangles. */
    val outputTopology: PrimitiveTopology
        get() = if (topology == PrimitiveTopology.TRIANGLE_FAN) PrimitiveTopology.TRIANGLES else topology

    val isEmpty get() = count == 0

    fun minX(): Float = (0 until count).minOfOrNull { pos[it * 3] } ?: 0f
    fun maxX(): Float = (0 until count).maxOfOrNull { pos[it * 3] } ?: 0f
    fun minY(): Float = (0 until count).minOfOrNull { pos[it * 3 + 1] } ?: 0f
    fun maxY(): Float = (0 until count).maxOfOrNull { pos[it * 3 + 1] } ?: 0f

    private fun order(): IntArray {
        if (topology != PrimitiveTopology.TRIANGLE_FAN) {
            return IntArray(count) { it }
        }
        val tris = max(0, count - 2)
        val out = IntArray(tris * 3)
        for (i in 0 until tris) {
            out[i * 3] = 0
            out[i * 3 + 1] = i + 1
            out[i * 3 + 2] = i + 2
        }
        return out
    }

    /** Write the vertices out with the format used by the GUI shaders (position + color) */
    fun replayGui(vc: VertexConsumer, textured: Boolean) {
        for (i in order()) {
            vc.addVertex(pos[i * 3], pos[i * 3 + 1], 0f).setColor(cols[i])
            if (textured) {
                vc.setUv(uv[i * 2], uv[i * 2 + 1])
            }
        }
    }

    /** Write the vertices out with the entity vertex format */
    fun replayEntity(vc: VertexConsumer) {
        for (i in order()) {
            vc.addVertex(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
                .setColor(cols[i])
                .setUv(uv[i * 2], uv[i * 2 + 1])
                .setOverlay(OverlayTexture.NO_OVERLAY)
                .setLight(light[i])
                .setNormal(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2])
        }
    }
}

/**
 * A GUI element built out of a [HexMesh] that is already in GUI coordinates.
 */
class HexMeshGuiElement(
    private val mesh: HexMesh,
    private val pipeline: RenderPipeline,
    private val textureSetup: TextureSetup,
    private val textured: Boolean,
    private val scissor: ScreenRectangle?,
    private val bounds: ScreenRectangle?,
) : GuiElementRenderState {
    override fun buildVertices(vertexConsumer: VertexConsumer) = mesh.replayGui(vertexConsumer, textured)
    override fun pipeline(): RenderPipeline = pipeline
    override fun textureSetup(): TextureSetup = textureSetup
    override fun scissorArea(): ScreenRectangle? = scissor
    override fun bounds(): ScreenRectangle? = bounds
}

interface VCDrawHelper {
    fun vcSetupAndSupply(vertMode: PrimitiveTopology): VertexConsumer
    fun vertex(vc: VertexConsumer, color: Int, pos: Vec2, matrix: Matrix4f) {
        vertex(vc, color, pos, Vec2(0f, 0f), matrix)
    }

    fun vertex(vc: VertexConsumer, color: Int, pos: Vec2, uv: Vec2, matrix: Matrix4f)

    fun vcEndDrawer(vc: VertexConsumer)

    companion object {

        @JvmStatic
        val WHITE: Identifier = HexAPI.modLoc("textures/entity/white.png")

        /**
         * Get the helper for drawing in the world (if [worldlyBits] is not null) or in the GUI
         * (if [graphics] is not null).
         */
        @JvmStatic
        fun getHelper(
            worldlyBits: WorldlyBits?,
            graphics: GuiGraphicsExtractor?,
            ps: PoseStack?,
            z: Float,
            texture: Identifier
        ): VCDrawHelper {
            if (worldlyBits != null && ps != null) {
                return Worldly(worldlyBits, ps, z * -1, texture)
            }
            return Gui(graphics ?: throw IllegalArgumentException("need either world or GUI rendering context"), z, texture)
        }

        @JvmStatic
        fun getHelper(
            worldlyBits: WorldlyBits?,
            graphics: GuiGraphicsExtractor?,
            ps: PoseStack?,
            z: Float
        ): VCDrawHelper {
            return getHelper(worldlyBits, graphics, ps, z, WHITE)
        }
    }

    /**
     * Draws to the GUI. Vertices should have already been transformed into GUI space by the matrix passed in
     * (so just make that out of the GUI pose with [guiMatrix]).
     *
     * Layering is up to the GUI renderer: things drawn later go on top of things drawn earlier they overlap with.
     */
    class Gui(val graphics: GuiGraphicsExtractor, val z: Float = 0f, val texture: Identifier? = null) : VCDrawHelper {
        override fun vcSetupAndSupply(vertMode: PrimitiveTopology): VertexConsumer {
            return HexMesh(vertMode)
        }

        override fun vertex(vc: VertexConsumer, color: Int, pos: Vec2, uv: Vec2, matrix: Matrix4f) {
            val p = matrix.transformPosition(pos.x, pos.y, z, Vector3f())
            vc.addVertex(p.x, p.y, 0f).setColor(color).setUv(uv.x, uv.y)
        }

        override fun vcEndDrawer(vc: VertexConsumer) {
            val mesh = vc as HexMesh
            if (mesh.isEmpty) return

            val textured = texture != null
            val setup: TextureSetup
            if (textured) {
                val tex = Minecraft.getInstance().textureManager.getTexture(texture)
                setup = TextureSetup.singleTexture(tex.textureView, tex.sampler)
            } else {
                setup = TextureSetup.noTexture()
            }
            val pipeline = when (mesh.outputTopology) {
                PrimitiveTopology.QUADS -> if (textured) RenderPipelines.GUI_TEXTURED else RenderPipelines.GUI
                else -> if (textured) HexRenderPipelines.GUI_TEXTURED_TRIANGLES else HexRenderPipelines.GUI_TRIANGLES
            }

            val x0 = floor(mesh.minX()).toInt() - 1
            val y0 = floor(mesh.minY()).toInt() - 1
            val x1 = ceil(mesh.maxX()).toInt() + 1
            val y1 = ceil(mesh.maxY()).toInt() + 1
            var bounds: ScreenRectangle? = ScreenRectangle(x0, y0, x1 - x0, y1 - y0)
            val scissor = graphics.scissorStack.peek()
            if (scissor != null) {
                bounds = scissor.intersection(bounds!!)
            }

            graphics.guiRenderState.addGuiElement(HexMeshGuiElement(mesh, pipeline, setup, textured, scissor, bounds))
        }
    }

    /**
     * Draws in the world, using the lightmap and the normal given in [WorldlyBits] (or no lighting if that says so).
     *
     * The vertices are transformed by the matrix passed in, which should be the one of the pose stack (which should
     * be camera-relative, like the ones you get in entity and block entity renderers).
     */
    class Worldly(val worldlyBits: WorldlyBits, val ps: PoseStack, val z: Float, val texture: Identifier) :
        VCDrawHelper {

        override fun vcSetupAndSupply(vertMode: PrimitiveTopology): VertexConsumer {
            return HexMesh(vertMode)
        }

        override fun vertex(vc: VertexConsumer, color: Int, pos: Vec2, uv: Vec2, matrix: Matrix4f) {
            val nv = worldlyBits.normal ?: Vec3(1.0, 1.0, 1.0)
            val n = ps.last().transformNormal(nv.x.toFloat(), nv.y.toFloat(), nv.z.toFloat(), Vector3f())
            val p = matrix.transformPosition(pos.x, pos.y, z, Vector3f())
            vc.addVertex(p.x, p.y, p.z)
                .setColor(color)
                .setUv(uv.x, uv.y)
                .setLight(worldlyBits.light ?: LightCoordsUtil.FULL_BRIGHT)
                .setNormal(n.x, n.y, n.z)
        }

        override fun vcEndDrawer(vc: VertexConsumer) {
            val mesh = vc as HexMesh
            if (mesh.isEmpty) return

            val type = when {
                mesh.outputTopology == PrimitiveTopology.QUADS -> HexRenderTypes.litQuads(texture)
                worldlyBits.unlit -> HexRenderTypes.unlitTriangles(texture)
                else -> HexRenderTypes.litTriangles(texture)
            }
            worldlyBits.provider.submitCustomGeometry(PoseStack(), type) { _, buf -> mesh.replayEntity(buf) }
        }
    }
}

/**
 * Turn a GUI pose (as in [GuiGraphicsExtractor.pose]) into a 4x4 matrix so it can be used with the functions in
 * RenderLib. The z axis is untouched.
 */
fun guiMatrix(graphics: GuiGraphicsExtractor): Matrix4f {
    val p = graphics.pose()
    return Matrix4f(
        p.m00(), p.m01(), 0f, 0f,
        p.m10(), p.m11(), 0f, 0f,
        0f, 0f, 1f, 0f,
        p.m20(), p.m21(), 0f, 1f
    )
}
