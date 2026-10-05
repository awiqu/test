package at.petrak.hexcasting.fabric.cc;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.ladysnake.cca.api.v3.component.sync.AutoSyncedComponent;
import org.ladysnake.cca.api.v8.component.CardinalComponent;

public class CCBrainswept implements CardinalComponent, AutoSyncedComponent {
    public static final String TAG_BRAINSWEPT = "brainswept";

    private final LivingEntity owner;

    public CCBrainswept(LivingEntity owner) {
        this.owner = owner;
    }

    private boolean brainswept = false;

    public boolean isBrainswept() {
        return this.brainswept;
    }

    public void setBrainswept(boolean brainswept) {
        this.brainswept = brainswept;
        HexCardinalComponents.BRAINSWEPT.sync(this.owner);
    }

    @Override
    public void applySyncPacket(RegistryFriendlyByteBuf buf) {
        AutoSyncedComponent.super.applySyncPacket(buf);
        if (owner instanceof Mob mob && brainswept)
            mob.removeFreeWill();
    }

    @Override
    public void readData(ValueInput input) {
        this.brainswept = input.getBooleanOr(TAG_BRAINSWEPT, false);
    }

    @Override
    public void writeData(ValueOutput output) {
        output.putBoolean(TAG_BRAINSWEPT, this.brainswept);
    }
}
