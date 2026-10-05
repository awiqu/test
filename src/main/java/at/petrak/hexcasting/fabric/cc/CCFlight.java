package at.petrak.hexcasting.fabric.cc;

import at.petrak.hexcasting.api.player.FlightAbility;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;
import org.ladysnake.cca.api.v8.component.CardinalComponent;

public class CCFlight implements CardinalComponent {
    public static final String
        TAG_ALLOWED = "allowed", // Fake: use this as a null sentinel
        TAG_TIME_LEFT = "time_left",
        TAG_DIMENSION = "dimension",
        TAG_ORIGIN = "origin",
        TAG_RADIUS = "radius";

    private final ServerPlayer owner;
    @Nullable
    private FlightAbility flight = null;

    public CCFlight(ServerPlayer owner) {
        this.owner = owner;
    }


    @Nullable
    public FlightAbility getFlight() {
        return flight;
    }

    public void setFlight(FlightAbility flight) {
        this.flight = flight;
    }

    @Override
    public void readData(ValueInput input) {
        var allowed = input.getBooleanOr(TAG_ALLOWED, false);
        var dim = input.read(TAG_DIMENSION, Level.RESOURCE_KEY_CODEC);
        if (!allowed || dim.isEmpty()) {
            this.flight = null;
        } else {
            var timeLeft = input.getIntOr(TAG_TIME_LEFT, 0);
            var origin = readVec(input.childOrEmpty(TAG_ORIGIN));
            var radius = input.getDoubleOr(TAG_RADIUS, 0.0);
            this.flight = new FlightAbility(timeLeft, dim.get(), origin, radius);
        }
    }

    @Override
    public void writeData(ValueOutput output) {
        output.putBoolean(TAG_ALLOWED, this.flight != null);
        if (this.flight != null) {
            output.putInt(TAG_TIME_LEFT, this.flight.timeLeft());
            output.store(TAG_DIMENSION, Level.RESOURCE_KEY_CODEC, this.flight.dimension());
            writeVec(output.child(TAG_ORIGIN), this.flight.origin());
            output.putDouble(TAG_RADIUS, this.flight.radius());
        }
    }

    static void writeVec(ValueOutput out, Vec3 vec) {
        out.putDouble("x", vec.x);
        out.putDouble("y", vec.y);
        out.putDouble("z", vec.z);
    }

    static Vec3 readVec(ValueInput in) {
        return new Vec3(in.getDoubleOr("x", 0.0), in.getDoubleOr("y", 0.0), in.getDoubleOr("z", 0.0));
    }
}
