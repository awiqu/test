package at.petrak.hexcasting.api.casting.circles;

import at.petrak.hexcasting.api.HexAPI;
import at.petrak.hexcasting.api.casting.eval.env.CircleCastEnv;
import at.petrak.hexcasting.api.casting.eval.vm.CastingImage;
import at.petrak.hexcasting.api.misc.Result;
import at.petrak.hexcasting.api.mod.HexConfig;
import at.petrak.hexcasting.api.pigment.FrozenPigment;
import at.petrak.hexcasting.api.utils.ChunkScanning;
import com.mojang.datafixers.util.Pair;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockBox;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.UUIDUtil;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.AABB;
import org.jetbrains.annotations.Nullable;

import java.util.*;

/**
 * See {@link BlockEntityAbstractImpetus}, this is what's stored in it
 */
public class CircleExecutionState {
    public static final String
        TAG_IMPETUS_POS = "impetus_pos",
        TAG_IMPETUS_DIR = "impetus_dir",
        TAG_REACHED_POSITIONS = "reached_positions",
        TAG_CURRENT_POS = "current_pos",
        TAG_ENTERED_FROM = "entered_from",
        TAG_IMAGE = "image",
        TAG_CASTER = "caster",
        TAG_PIGMENT = "pigment",
        TAG_REACHED_NUMBER = "reached_slate",
        TAG_POSITIVE_POS = "positive_pos",
        TAG_NEGATIVE_POS = "negative_pos";

    public final BlockPos impetusPos;
    public final Direction impetusDir;
    // Does contain the starting impetus
    public final HashSet<BlockPos> reachedPositions;
    public BlockPos currentPos;
    public Direction enteredFrom;
    public CastingImage currentImage;
    public @Nullable UUID caster;
    public @Nullable FrozenPigment casterPigment;
    public long reachedSlate;

    // Tracks the highest pos, and lowest pos of the AABB
    public BlockPos greaterCorner;
    public BlockPos lesserCorner;

    public final BlockBox bounds;


    protected CircleExecutionState(BlockPos impetusPos, Direction impetusDir, HashSet<BlockPos> reachedPositions,
       BlockPos currentPos, Direction enteredFrom, CastingImage currentImage, @Nullable UUID caster,
       @Nullable FrozenPigment casterPigment, Long reachedSlate, BlockPos greaterCorner, BlockPos lesserCorner) {
        this.impetusPos = impetusPos;
        this.impetusDir = impetusDir;
        this.reachedPositions = reachedPositions;
        this.currentPos = currentPos;
        this.enteredFrom = enteredFrom;
        this.currentImage = currentImage;
        this.caster = caster;
        this.casterPigment = casterPigment;
        this.reachedSlate = reachedSlate;

        this.greaterCorner = greaterCorner;
        this.lesserCorner = lesserCorner;
        this.bounds = new BlockBox(greaterCorner, lesserCorner);
    }

    public @Nullable ServerPlayer getCaster(ServerLevel world) {
        if (this.caster == null) {
            return null;
        }
        var entity = world.getEntity(this.caster);
        if (entity instanceof ServerPlayer serverPlayer) {
            return serverPlayer;
        }
        // there's a problem if this branch is reached
        return null;
    }

    // Return OK if it succeeded; returns Err if it didn't close and the location
    public static Result<CircleExecutionState, @Nullable BlockPos> createNew(BlockEntityAbstractImpetus impetus,
        @Nullable ServerPlayer caster) {
        var level = (ServerLevel) impetus.getLevel();

        if (level == null)
            return new Result.Err<>(null);

        // Flood fill! Just like VCC all over again.
        // this contains tentative positions and directions entered from
        var todo = new Stack<Pair<Direction, BlockPos>>();
        todo.add(Pair.of(impetus.getStartDirection(), impetus.getBlockPos().relative(impetus.getStartDirection())));
        var seenGoodPosSet = new HashSet<BlockPos>();
        var impetusPos = impetus.getBlockPos();
        var positiveBlock = impetusPos.mutable();
        var negativeBlock = impetusPos.mutable();
        var lastBlockPos = impetusPos.mutable();
        var scanning = new ChunkScanning(level);

        while (!todo.isEmpty()) {
            var pair = todo.pop();
            var enterDir = pair.getFirst();
            var herePos = pair.getSecond();
            var hereBs = scanning.getBlock(herePos);

            if (hereBs == null){
                continue;
            }
            if (!(hereBs.getBlock() instanceof ICircleComponent cmp)) {
                continue;
            }
            if (!cmp.canEnterFromDirection(enterDir, herePos, hereBs, level)) {
                continue;
            }

            if (seenGoodPosSet.add(herePos)) {
                lastBlockPos.set(herePos);
                // Updates the highest and or lowest corner of the Circle
                positiveBlock.setX(Math.max(herePos.getX(), positiveBlock.getX()));
                positiveBlock.setY(Math.max(herePos.getY(), positiveBlock.getY()));
                positiveBlock.setZ(Math.max(herePos.getZ(), positiveBlock.getZ()));

                negativeBlock.setX(Math.min(herePos.getX(), negativeBlock.getX()));
                negativeBlock.setY(Math.min(herePos.getY(), negativeBlock.getY()));
                negativeBlock.setZ(Math.min(herePos.getZ(), negativeBlock.getZ()));
                // it's new
                var outs = cmp.possibleExitDirections(herePos, hereBs, level);
                for (var out : outs) {
                    todo.add(Pair.of(out, herePos.relative(out)));
                }
            }
            // Who would leave out the config limit? If this is forgotten, someone could make a Spell Circle the size of a world
            if (seenGoodPosSet.size() >= HexConfig.server().maxSpellCircleLength()){
                return new Result.Err<>(null);
            }
        }
        scanning.clearCache();

        if (lastBlockPos == impetus.getBlockPos()) {
            return new Result.Err<>(null);
        } else if (!seenGoodPosSet.contains(impetus.getBlockPos())) {
            // we can't enter from the side the impetus exits from, so this means we couldn't loop back.
            // the last item we tried to examine will always be a terminal slate (b/c if it wasn't,
            // then the *next* slate would be last qed)
            return new Result.Err<>(lastBlockPos);
        }

        var reachedPositions = new HashSet<BlockPos>();
        reachedPositions.add(impetus.getBlockPos());

        FrozenPigment colorizer = null;
        UUID casterUUID;
        if (caster == null) {
            casterUUID = null;
        } else {
            colorizer = HexAPI.instance().getColorizer(caster);
            casterUUID = caster.getUUID();
        }
        return new Result.Ok<>(
            new CircleExecutionState(impetus.getBlockPos(), impetus.getStartDirection(),
                reachedPositions, impetus.getBlockPos().offset(impetus.getStartDirection().getUnitVec3i()),
                impetus.getStartDirection(), new CastingImage(), casterUUID, colorizer, 0L,
                positiveBlock, negativeBlock));
    }

    public CompoundTag save() {
        var out = new CompoundTag();

        out.store(TAG_IMPETUS_POS, BlockPos.CODEC, this.impetusPos);
        out.putByte(TAG_IMPETUS_DIR, (byte) this.impetusDir.ordinal());

        out.store(TAG_REACHED_POSITIONS, BlockPos.CODEC.listOf(), new ArrayList<>(this.reachedPositions));

        out.store(TAG_CURRENT_POS, BlockPos.CODEC, this.currentPos);
        out.putByte(TAG_ENTERED_FROM, (byte) this.enteredFrom.ordinal());
        out.store(TAG_IMAGE, CastingImage.getCODEC(), currentImage);

        out.storeNullable(TAG_CASTER, UUIDUtil.CODEC, this.caster);

        out.storeNullable(TAG_PIGMENT, FrozenPigment.CODEC, this.casterPigment);

        out.putLong(TAG_REACHED_NUMBER, this.reachedSlate);

        out.store(TAG_POSITIVE_POS, BlockPos.CODEC, this.greaterCorner);
        out.store(TAG_NEGATIVE_POS, BlockPos.CODEC, this.lesserCorner);

        return out;
    }

    public static CircleExecutionState load(CompoundTag nbt, ServerLevel world) {
        var startPos = nbt.read(TAG_IMPETUS_POS, BlockPos.CODEC).orElseThrow();
        var startDir = Direction.values()[nbt.getByteOr(TAG_IMPETUS_DIR, (byte) 0)];

        var reachedPositions = new HashSet<BlockPos>(
            nbt.read(TAG_REACHED_POSITIONS, BlockPos.CODEC.listOf()).orElseGet(List::of));

        var currentPos = nbt.read(TAG_CURRENT_POS, BlockPos.CODEC).orElseThrow();
        var enteredFrom = Direction.values()[nbt.getByteOr(TAG_ENTERED_FROM, (byte) 0)];
        var image = nbt.read(TAG_IMAGE, CastingImage.getCODEC()).orElseThrow();

        var reachedSlate = nbt.getLongOr(TAG_REACHED_NUMBER, 0L);
        var positivePos = nbt.read(TAG_POSITIVE_POS, BlockPos.CODEC).orElseThrow();
        var negativePos = nbt.read(TAG_NEGATIVE_POS, BlockPos.CODEC).orElseThrow();

        UUID caster = nbt.read(TAG_CASTER, UUIDUtil.CODEC).orElse(null);
        FrozenPigment pigment = nbt.read(TAG_PIGMENT, FrozenPigment.CODEC).orElse(null);

        return new CircleExecutionState(startPos, startDir, reachedPositions, currentPos,
            enteredFrom, image, caster, pigment, reachedSlate, positivePos, negativePos);
    }

    /**
     * Update this, also mutates the impetus.
     * <p>
     * Returns whether to continue.
     */
    public boolean tick(BlockEntityAbstractImpetus impetus) {
        var world = (ServerLevel) impetus.getLevel();

        if (world == null)
            return true; // if the world is null, try again next tick.

        var env = new CircleCastEnv(world, this);

        var executorBlockState = world.getBlockState(this.currentPos);
        if (!(executorBlockState.getBlock() instanceof ICircleComponent executor)) {
            // TODO: notification of the error?
            ICircleComponent.sfx(this.currentPos, executorBlockState, world,
                Objects.requireNonNull(env.getImpetus()), false);
            return false;
        }

        executorBlockState = executor.startEnergized(this.currentPos, executorBlockState, world);
        this.reachedPositions.add(this.currentPos);
        this.reachedSlate +=1;

        // Do the execution!
        boolean halt = false;
        var ctrl = executor.acceptControlFlow(this.currentImage, env, this.enteredFrom, this.currentPos,
            executorBlockState, world);

        if (env.getImpetus() == null)
            return false; //the impetus got removed during the cast and no longer exists in the world. stop casting

        if (ctrl instanceof ICircleComponent.ControlFlow.Stop) {
            // acceptControlFlow should have already posted the error
            halt = true;
        } else if (ctrl instanceof ICircleComponent.ControlFlow.Continue cont) {
            Pair<BlockPos, Direction> found = null;

            for (var exit : cont.exits) {
                var there = world.getBlockState(exit.getFirst());
                if (there.getBlock() instanceof ICircleComponent cc
                    && cc.canEnterFromDirection(exit.getSecond(), exit.getFirst(), there, world)) {
                    if (found != null) {
                        // oh no!
                        impetus.postDisplay(
                            Component.translatable("hexcasting.tooltip.circle.many_exits",
                                Component.literal(this.currentPos.toShortString()).withStyle(ChatFormatting.RED)),
                            new ItemStack(Items.COMPASS));
                        ICircleComponent.sfx(this.currentPos, executorBlockState, world,
                            Objects.requireNonNull(env.getImpetus()), false);
                        halt = true;
                        break;
                    } else {
                        found = exit;
                    }
                }
            }

            if (found == null) {
                // will never enter here if there were too many because found will have been set
                ICircleComponent.sfx(this.currentPos, executorBlockState, world,
                    Objects.requireNonNull(env.getImpetus()), false);
                impetus.postNoExits(this.currentPos);
                halt = true;
            } else {
                // A single valid exit position has been found.
                ICircleComponent.sfx(this.currentPos, executorBlockState, world,
                    Objects.requireNonNull(env.getImpetus()), true);
                currentPos = found.getFirst();
                enteredFrom = found.getSecond();
                currentImage = cont.update.withOverriddenUsedOps(0); // reset ops used after each slate finishes executing
            }
        }

        return !halt;
    }

    /**
     * How many ticks should pass between activations, given the number of blocks encountered so far.
     */
    protected int getTickSpeed() {
        return Math.max(2, (int) (10 - (this.reachedSlate - 1) / 3));
    }

    public void endExecution(BlockEntityAbstractImpetus impetus) {
        var world = (ServerLevel) impetus.getLevel();

        if (world == null)
            return; // TODO: error here?

        for (var pos : this.reachedPositions) {
            var there = world.getBlockState(pos);
            if (there.getBlock() instanceof ICircleComponent cc) {
                cc.endEnergized(pos, there, world);
            }
        }
    }
}
