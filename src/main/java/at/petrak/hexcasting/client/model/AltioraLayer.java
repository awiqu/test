package at.petrak.hexcasting.client.model;

import at.petrak.hexcasting.xplat.IXplatAbstractions;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.geom.EntityModelSet;
import net.minecraft.client.model.object.equipment.ElytraModel;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Items;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

public class AltioraLayer extends RenderLayer<AvatarRenderState, PlayerModel> {
    private static final Identifier TEX_LOC = modLoc("textures/misc/altiora.png");

    private final ElytraModel elytraModel;

    public AltioraLayer(RenderLayerParent<AvatarRenderState, PlayerModel> renderer, EntityModelSet ems) {
        super(renderer);
        this.elytraModel = new ElytraModel(ems.bakeLayer(HexModelLayers.ALTIORA));
    }

    @Override
    public void submit(PoseStack ps, SubmitNodeCollector collector, int packedLight, AvatarRenderState state,
        float yRot, float xRot) {
        // The render state doesn't know about our fancy data, so look at the actual player
        var level = Minecraft.getInstance().level;
        if (level == null || !(level.getEntity(state.id) instanceof Player player)) {
            return;
        }

        var altiora = IXplatAbstractions.INSTANCE.getAltiora(player);
        // do a best effort to not render over other elytra, although we can never patch up everything
        var chestSlot = player.getItemBySlot(EquipmentSlot.CHEST);
        if (altiora != null && !chestSlot.is(Items.ELYTRA)) {
            ps.pushPose();
            ps.translate(0.0, 0.0, 0.125);

            this.elytraModel.setupAnim(state);
            collector.submitModel(this.elytraModel, state, ps, RenderTypes.armorCutoutNoCull(TEX_LOC), packedLight,
                LivingEntityRenderer.getOverlayCoords(state, 0.0f), -1, null, state.outlineColor, null);

            ps.popPose();
        }
    }
}
