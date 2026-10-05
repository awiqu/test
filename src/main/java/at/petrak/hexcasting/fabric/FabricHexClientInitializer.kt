package at.petrak.hexcasting.fabric

import at.petrak.hexcasting.api.HexAPI
import at.petrak.hexcasting.client.ClientTickCounter
import at.petrak.hexcasting.client.Keybinds
import at.petrak.hexcasting.client.RegisterClientStuff
import at.petrak.hexcasting.client.ShiftScrollListener
import at.petrak.hexcasting.client.gui.PatternTooltipComponent
import at.petrak.hexcasting.client.model.AltioraLayer
import at.petrak.hexcasting.client.model.HexModelLayers
import at.petrak.hexcasting.client.render.HexAdditionalRenderers
import at.petrak.hexcasting.client.render.shader.HexRenderPipelines
import at.petrak.hexcasting.common.casting.PatternRegistryManifest
import at.petrak.hexcasting.common.lib.HexParticles
import at.petrak.hexcasting.fabric.event.MouseScrollCallback
import at.petrak.hexcasting.fabric.network.FabricPacketHandler
import at.petrak.hexcasting.interop.HexInterop
import net.fabricmc.api.ClientModInitializer
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper
import net.fabricmc.fabric.api.client.model.loading.v1.ModelLoadingPlugin
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents
import net.fabricmc.fabric.api.client.particle.v1.ParticleProviderRegistry
import net.fabricmc.fabric.api.client.rendering.v1.BlockEntityRendererRegistry
import net.fabricmc.fabric.api.client.rendering.v1.ClientTooltipComponentCallback
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityRenderLayerRegistrationCallback
import net.fabricmc.fabric.api.client.rendering.v1.ModelLayerRegistry
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElement
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry
import net.fabricmc.fabric.api.client.rendering.v1.level.LevelRenderEvents
import net.minecraft.client.Minecraft
import net.minecraft.client.model.player.PlayerModel
import net.minecraft.client.particle.ParticleProvider
import net.minecraft.client.particle.SpriteSet
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState
import net.minecraft.client.renderer.entity.RenderLayerParent
import net.minecraft.client.renderer.entity.player.AvatarRenderer
import net.minecraft.client.renderer.entity.state.AvatarRenderState
import net.minecraft.core.particles.ParticleOptions
import net.minecraft.core.particles.ParticleType
import net.minecraft.world.entity.EntityTypes
import net.minecraft.world.level.block.entity.BlockEntity
import net.minecraft.world.level.block.entity.BlockEntityType
import java.util.function.Function

object FabricHexClientInitializer : ClientModInitializer {
    override fun onInitializeClient() {
        FabricPacketHandler.initClient()
        HexRenderPipelines.init()

        LevelRenderEvents.COLLECT_SUBMITS.register { ctx ->
            HexAdditionalRenderers.overlayLevel(
                ctx.submitNodeCollector(),
                Minecraft.getInstance().deltaTracker.getGameTimeDeltaPartialTick(false)
            )
        }
        HudElementRegistry.addLast(HexAPI.modLoc("scrying_lens_overlay"),
            HudElement(HexAdditionalRenderers::overlayGui))
        LevelRenderEvents.START_MAIN.register {
            ClientTickCounter.renderTickStart(Minecraft.getInstance().deltaTracker.getGameTimeDeltaPartialTick(false))
        }
        ClientTickEvents.END_CLIENT_TICK.register {
            ClientTickCounter.clientTickEnd()
            Keybinds.clientTickEnd()
            ShiftScrollListener.clientTickEnd()
        }
        ClientTooltipComponentCallback.EVENT.register(PatternTooltipComponent::tryConvert)
        ClientPlayConnectionEvents.JOIN.register { _, _, _ ->
            if (!FabricHexInitializer.patternRegistryIsProcessed) {
                PatternRegistryManifest.processRegistry(null)
                FabricHexInitializer.patternRegistryIsProcessed = true
            }
        }

        MouseScrollCallback.EVENT.register(ShiftScrollListener::onScrollInGameplay)

        Keybinds.ALL_BINDS.forEach(KeyMappingHelper::registerKeyMapping)

        RegisterClientStuff.init()
        HexModelLayers.init { loc, defn -> ModelLayerRegistry.registerModelLayer(loc, defn::get) }
        // the little wings. The player renderer is the only one that has an elytra layer anyways.
        LivingEntityRenderLayerRegistrationCallback.EVENT.register { type, renderer, helper, ctx ->
            if (type == EntityTypes.PLAYER && renderer is AvatarRenderer<*>) {
                @Suppress("UNCHECKED_CAST")
                val parent = renderer as RenderLayerParent<AvatarRenderState, PlayerModel>
                helper.register<AvatarRenderState>(AltioraLayer(parent, ctx.modelSet))
            }
        }

        HexParticles.FactoryHandler.registerFactories(object : HexParticles.FactoryHandler.Consumer {
            override fun <T : ParticleOptions> register(
                type: ParticleType<T>,
                constructor: Function<SpriteSet, ParticleProvider<T>>
            ) {
                ParticleProviderRegistry.getInstance().register(type) { sprites -> constructor.apply(sprites) }
            }
        })

        // how ergonomic
        RegisterClientStuff.registerBlockEntityRenderers(object :
            RegisterClientStuff.BlockEntityRendererRegisterererer {
            override fun <T : BlockEntity, S : BlockEntityRenderState> registerBlockEntityRenderer(
                type: BlockEntityType<T>,
                berp: BlockEntityRendererProvider<in T, in S>
            ) {
                BlockEntityRendererRegistry.register(type, berp)
            }
        })

        HexInterop.clientInit()
        RegisterClientStuff.registerColorProviders()
        ModelLoadingPlugin.register { context -> RegisterClientStuff.onModelRegister(context) }
    }
}
