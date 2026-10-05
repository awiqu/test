package at.petrak.hexcasting.common.blocks.decoration;

import at.petrak.hexcasting.annotations.SoftImplement;
import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.LeavesBlock;
import net.minecraft.world.level.block.state.BlockState;

public class BlockAkashicLeaves extends LeavesBlock {
    public static final MapCodec<BlockAkashicLeaves> CODEC = simpleCodec(BlockAkashicLeaves::new);

    @Override
    public MapCodec<BlockAkashicLeaves> codec() {
        return CODEC;
    }

    public BlockAkashicLeaves(Properties props) {
        super(0f, props);
    }

    @Override
    protected void spawnFallingLeavesParticle(Level level, BlockPos pos, RandomSource random) {
        // no falling leaf particles (matches the pre-1.21.2 behaviour)
    }

    @SoftImplement("forge")
    public boolean isFlammable(BlockState state, BlockGetter level, BlockPos pos, Direction direction) {
        return true;
    }

    @SoftImplement("forge")
    public int getFlammability(BlockState state, BlockGetter level, BlockPos pos, Direction direction) {
        return 60;
    }

    @SoftImplement("forge")
    public int getFireSpreadSpeed(BlockState state, BlockGetter level, BlockPos pos, Direction direction) {
        return 30;
    }
}
