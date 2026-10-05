package at.petrak.hexcasting.common.blocks.entity;

import at.petrak.hexcasting.api.block.HexBlockEntity;
import at.petrak.hexcasting.common.blocks.BlockQuenchedAllay;
import at.petrak.hexcasting.common.lib.HexBlockEntities;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import net.minecraft.world.level.block.state.BlockState;

import java.util.function.BiFunction;

/**
 * No-op BE just to have a BER
 */
public class BlockEntityQuenchedAllay extends HexBlockEntity {
    public BlockEntityQuenchedAllay(BlockQuenchedAllay block, BlockPos pos, BlockState blockState) {
        super(HexBlockEntities.typeForQuenchedAllay(block), pos, blockState);
    }

    public static BiFunction<BlockPos, BlockState, BlockEntityQuenchedAllay> fromKnownBlock(BlockQuenchedAllay block) {
        return (pos, state) -> new BlockEntityQuenchedAllay(block, pos, state);
    }

    @Override
    protected void saveModData(ValueOutput output) {

    }

    @Override
    protected void loadModData(ValueInput input) {

    }
}
