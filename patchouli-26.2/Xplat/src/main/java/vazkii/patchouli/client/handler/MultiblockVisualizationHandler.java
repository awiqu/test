package vazkii.patchouli.client.handler;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.datafixers.util.Pair;

import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

import vazkii.patchouli.api.IMultiblock;
import vazkii.patchouli.client.base.ClientTicker;
import vazkii.patchouli.client.base.PersistentData.Bookmark;
import vazkii.patchouli.client.multiblock.GhostBlockGeometry;
import vazkii.patchouli.common.multiblock.StateMatcher;
import vazkii.patchouli.common.util.RotationUtil;

import java.util.Collection;
import java.util.Objects;
import java.util.function.Function;

public final class MultiblockVisualizationHandler {
	public static final MultiblockVisualizationHandler INSTANCE = new MultiblockVisualizationHandler();

	private boolean hasMultiblock;
	private Bookmark bookmark;
	private IMultiblock multiblock;
	private Component name;
	private BlockPos pos;
	private boolean isAnchored;
	private Rotation facingRotation;
	private Function<BlockPos, BlockPos> offsetApplier;
	private int blocks, blocksDone, airFilled;
	private int timeComplete;
	private BlockState lookingState;
	private BlockPos lookingPos;

	public boolean hasMultiblock() {
		return hasMultiblock;
	}

	public void setHasMultiblock(boolean hasMultiblock) {
		this.hasMultiblock = hasMultiblock;
	}

	public Bookmark bookmark() {
		return bookmark;
	}

	public Component name() {
		return name;
	}

	public BlockState getLookingState() {
		return lookingState;
	}

	public BlockPos getLookingPos() {
		return lookingPos;
	}

	public int getTimeComplete() {
		return timeComplete;
	}

	public float getProgress() {
		return (float) blocksDone / Math.max(1, blocks);
	}

	public String getProgressString() {
		return blocksDone + "/" + blocks;
	}

	public boolean isComplete() {
		return blocksDone == blocks && airFilled > 0;
	}

	public void setMultiblock(IMultiblock multiblock, Component name, Bookmark bookmark, boolean flip) {
		setMultiblock(multiblock, name, bookmark, flip, pos -> pos);
	}

	public void setMultiblock(IMultiblock multiblock, Component name, Bookmark bookmark, boolean flip, Function<BlockPos, BlockPos> offsetApplier) {
		if (flip && hasMultiblock) {
			hasMultiblock = false;
		} else {
			this.multiblock = multiblock;
			this.name = name;
			this.bookmark = bookmark;
			this.offsetApplier = offsetApplier;
			pos = null;
			hasMultiblock = multiblock != null;
			isAnchored = false;
		}
	}

	/**
	 * Collects the ghost blocks of the active multiblock. Must be called while the level's submits are being collected,
	 * with the level's (identity) pose stack; the camera position is used to make block positions camera-relative.
	 */
	public void onCollectSubmits(PoseStack ms, SubmitNodeCollector submitNodeCollector, Vec3 cameraPosition) {
		if (hasMultiblock && multiblock != null) {
			renderMultiblock(Minecraft.getInstance().level, ms, submitNodeCollector, cameraPosition);
		}
	}

	public void anchorTo(BlockPos target, Rotation rot) {
		pos = target;
		facingRotation = rot;
		isAnchored = true;
	}

	public InteractionResult onPlayerInteract(Player player, Level world, InteractionHand hand, BlockHitResult hit) {
		if (hasMultiblock && !isAnchored && player == Minecraft.getInstance().player) {
			anchorTo(hit.getBlockPos(), getRotation(player));
			return InteractionResult.SUCCESS;
		}
		return InteractionResult.PASS;
	}

	public void onClientTick(Minecraft mc) {
		if (Minecraft.getInstance().level == null) {
			hasMultiblock = false;
		} else if (isAnchored && blocks == blocksDone && airFilled == 0) {
			timeComplete++;
			if (timeComplete == 14) {
				Minecraft.getInstance().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.EXPERIENCE_ORB_PICKUP, 1.0F));
			}
		} else {
			timeComplete = 0;
		}
	}

	public void renderMultiblock(Level world, PoseStack ms, SubmitNodeCollector submitNodeStorage, Vec3 cameraPosition) {
		Minecraft mc = Minecraft.getInstance();
		if (!isAnchored) {
			facingRotation = getRotation(mc.player);
			if (mc.hitResult instanceof BlockHitResult) {
				pos = ((BlockHitResult) mc.hitResult).getBlockPos();
			}
		} else if (pos.distToCenterSqr(mc.player.position()) > 64 * 64) {
			return;
		}

		if (pos == null) {
			return;
		}
		if (multiblock.isSymmetrical()) {
			facingRotation = Rotation.NONE;
		}

		ms.pushPose();
		ms.translate(cameraPosition.multiply(-1, -1, -1));

		BlockPos checkPos = null;
		if (mc.hitResult instanceof BlockHitResult blockRes) {
			checkPos = blockRes.getBlockPos().relative(blockRes.getDirection());
		}

		blocks = blocksDone = airFilled = 0;
		lookingState = null;
		lookingPos = checkPos;

		Pair<BlockPos, Collection<IMultiblock.SimulateResult>> sim = multiblock.simulate(world, getStartPos(), getFacingRotation(), true);
		for (IMultiblock.SimulateResult r : sim.getSecond()) {
			float alpha = 0.3F;
			if (Objects.equals(r.getWorldPosition(), checkPos)) {
				lookingState = r.getStateMatcher().getDisplayedState(ClientTicker.ticksInGame);
				alpha = 0.6F + (float) (Math.sin(ClientTicker.total * 0.3F) + 1F) * 0.1F;
			}

			if (r.getStateMatcher() != StateMatcher.ANY) {
				boolean air = r.getStateMatcher() == StateMatcher.AIR;
				if (!air) {
					blocks++;
				}

				if (!r.test(world, facingRotation)) {
					BlockState renderState = r.getStateMatcher().getDisplayedState(ClientTicker.ticksInGame).rotate(facingRotation);
					float scale = 1;
					if (renderState.getBlock() == Blocks.AIR) {
						renderState = Blocks.CONCRETE.red().defaultBlockState();
						scale = 0.3F;
					}
					submitNodeStorage.submitCustomGeometry(
							ms,
							RenderTypes.translucentMovingBlock(),
							new GhostBlockGeometry(r.getWorldPosition(), renderState, alpha, scale));

					if (air) {
						airFilled++;
					}
				} else if (!air) {
					blocksDone++;
				}
			}
		}

		if (!isAnchored) {
			blocks = blocksDone = 0;
		}

		ms.popPose();
	}

	public IMultiblock getMultiblock() {
		return multiblock;
	}

	public boolean isAnchored() {
		return isAnchored;
	}

	public Rotation getFacingRotation() {
		return multiblock.isSymmetrical() ? Rotation.NONE : facingRotation;
	}

	public BlockPos getStartPos() {
		return offsetApplier.apply(pos);
	}

	/**
	 * Returns the Rotation of a multiblock structure based on the given entity's facing direction.
	 */
	private Rotation getRotation(Entity entity) {
		return RotationUtil.rotationFromFacing(entity.getDirection());
	}

	/*private static class GhostRenderLayer extends RenderType {
		private static final Map<RenderType, RenderType> remappedTypes = new IdentityHashMap<>();
		private final RenderType original;
	
		private GhostRenderLayer(RenderType original) {
			super(String.format("%s_%s_ghost", original.toString(), PatchouliAPI.MOD_ID), original.bufferSize(), original.affectsCrumbling(), original.sortOnUpload(), () -> {
				original.setupRenderState();
	
				//RenderSystem.disableDepthTest();
				//RenderSystem.enableBlend();
				//RenderSystem.setShaderColor(1, 1, 1, 0.4F);
			}, () -> {
				//RenderSystem.setShaderColor(1, 1, 1, 1);
				//RenderSystem.disableBlend();
				//RenderSystem.enableDepthTest();
	
				original.clearRenderState();
			});
			this.original = original;
		}
	
		@Override
		public void draw(MeshData meshData) {
			original.draw(meshData);
		}
	
		@Override
		public VertexFormat format() {
			return original.format();
		}
	
		@Override
		public VertexFormat.Mode mode() {
			return original.mode();
		}
	
		@Override
		public RenderPipeline pipeline() {
			return original.pipeline();
		}
	
		public static RenderType remap(RenderType in) {
			if (in instanceof GhostRenderLayer) {
				return in;
			} else {
				return remappedTypes.computeIfAbsent(in, GhostRenderLayer::new);
			}
		}
	}*/
}
