package at.petrak.hexcasting.common.blocks.circles.impetuses;

import at.petrak.hexcasting.api.HexAPI;
import at.petrak.hexcasting.api.casting.circles.BlockEntityAbstractImpetus;
import at.petrak.hexcasting.common.lib.HexBlockEntities;
import com.mojang.authlib.GameProfile;
import com.mojang.datafixers.util.Pair;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.UUIDUtil;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.ExtraCodecs;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ResolvableProfile;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jetbrains.annotations.Nullable;

import java.util.List;
import java.util.UUID;

public class BlockEntityRedstoneImpetus extends BlockEntityAbstractImpetus {
    public static final String TAG_STORED_PLAYER = "stored_player";
    public static final String TAG_STORED_PLAYER_PROFILE = "stored_player_profile";

    private GameProfile storedPlayerProfile = null;
    private UUID storedPlayer = null;

    private GameProfile cachedDisplayGameProfile = null;
    private ResolvableProfile cachedDisplayProfile = null;
    private ItemStack cachedDisplayStack = null;

    public BlockEntityRedstoneImpetus(BlockPos pWorldPosition, BlockState pBlockState) {
        super(HexBlockEntities.IMPETUS_REDSTONE_TILE.get(), pWorldPosition, pBlockState);
    }

    protected @Nullable GameProfile getPlayerName() {
        if (this.level instanceof ServerLevel) {
            Player player = getStoredPlayer();
            if (player != null) {
                return player.getGameProfile();
            }
        }

        return this.storedPlayerProfile;
    }

    public void setPlayer(GameProfile profile, UUID player) {
        this.storedPlayerProfile = profile;
        this.storedPlayer = player;
        this.setChanged();
    }

    public void clearPlayer() {
        this.storedPlayerProfile = null;
        this.storedPlayer = null;
    }

    //TODO port: test player profiles
    public void updatePlayerProfile() {
        ServerPlayer player = getStoredPlayer();
        if (player != null) {
            GameProfile newProfile = player.getGameProfile();
            if (!newProfile.equals(this.storedPlayerProfile)) {
                this.storedPlayerProfile = newProfile;
                this.setChanged();
            }
        }
    }

    // just feels wrong to use the protected method
    @Nullable
    public ServerPlayer getStoredPlayer() {
        if (this.storedPlayer == null) {
            return null;
        }
        if (!(this.level instanceof ServerLevel slevel)) {
            HexAPI.LOGGER.error("Called getStoredPlayer on the client");
            return null;
        }
        var e = slevel.getEntity(this.storedPlayer);
        if (e instanceof ServerPlayer player) {
            return player;
        } else {
            // if owner is offline then getEntity will return null
            // if e is somehow neither null nor a player, something is very wrong
            if (e != null) {
                HexAPI.LOGGER.error("Entity {} stored in a cleric impetus wasn't a player somehow", e);
            }
            return null;
        }
    }

    public void applyScryingLensOverlay(List<Pair<ItemStack, Component>> lines,
        BlockState state, BlockPos pos, Player observer,
        Level world,
        Direction hitFace) {
        super.applyScryingLensOverlay(lines, state, pos, observer, world, hitFace);

        var plProfile = this.getPlayerName();
        if (plProfile != null) {
            if (!plProfile.equals(cachedDisplayGameProfile) || cachedDisplayStack == null) {
                cachedDisplayGameProfile = plProfile;
                cachedDisplayProfile = ResolvableProfile.createResolved(plProfile);
                var head = new ItemStack(Items.PLAYER_HEAD);
                head.set(DataComponents.PROFILE, cachedDisplayProfile);
                cachedDisplayStack = head;
            }
            lines.add(new Pair<>(cachedDisplayStack,
                Component.translatable("hexcasting.tooltip.lens.impetus.redstone.bound", plProfile.name())));
        } else {
            lines.add(new Pair<>(new ItemStack(Items.BARRIER),
                Component.translatable("hexcasting.tooltip.lens.impetus.redstone.bound.none")));
        }
    }

    @Override
    protected void saveModData(ValueOutput output) {
        super.saveModData(output);
        output.storeNullable(TAG_STORED_PLAYER, UUIDUtil.CODEC, this.storedPlayer);
        output.storeNullable(TAG_STORED_PLAYER_PROFILE, ExtraCodecs.STORED_GAME_PROFILE.codec(), this.storedPlayerProfile);
    }

    @Override
    protected void loadModData(ValueInput input) {
        super.loadModData(input);
        this.storedPlayer = input.read(TAG_STORED_PLAYER, UUIDUtil.CODEC).orElse(null);
        this.storedPlayerProfile = input.read(TAG_STORED_PLAYER_PROFILE, ExtraCodecs.STORED_GAME_PROFILE.codec()).orElse(null);
    }
}
