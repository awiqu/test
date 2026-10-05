package at.petrak.hexcasting.fabric.cc;

import at.petrak.hexcasting.api.casting.eval.env.StaffCastEnv;
import at.petrak.hexcasting.api.casting.eval.vm.CastingImage;
import at.petrak.hexcasting.api.casting.eval.vm.CastingVM;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.NbtOps;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jetbrains.annotations.Nullable;
import org.ladysnake.cca.api.v8.component.CardinalComponent;

public class CCStaffcastImage implements CardinalComponent {
    public static final String TAG_VM = "harness";

    private final ServerPlayer owner;
    private CompoundTag lazyLoadedTag = new CompoundTag();

    public CCStaffcastImage(ServerPlayer owner) {
        this.owner = owner;
    }

    /**
     * Turn the saved image into a VM in a player staffcasting environment
     */
    public CastingVM getVM(InteractionHand hand) {
        var img = this.lazyLoadedTag.isEmpty()
            ? new CastingImage()
            : CastingImage.getCODEC().parse(NbtOps.INSTANCE, lazyLoadedTag).getOrThrow();
        var env = new StaffCastEnv(this.owner, hand);
        return new CastingVM(img, env);
    }

    public void setImage(@Nullable CastingImage image) {
        this.lazyLoadedTag =
            image == null
                ? new CompoundTag()
                : (CompoundTag) CastingImage.getCODEC().encode(image, NbtOps.INSTANCE, new CompoundTag()).getOrThrow();
    }

    @Override
    public void readData(ValueInput input) {
        this.lazyLoadedTag = input.read(TAG_VM, CompoundTag.CODEC).orElseGet(CompoundTag::new);
    }

    @Override
    public void writeData(ValueOutput output) {
        output.store(TAG_VM, CompoundTag.CODEC, this.lazyLoadedTag);
    }
}
