package at.petrak.hexcasting.shim;

import com.google.gson.JsonObject;
import org.jetbrains.annotations.Nullable;

import java.util.UUID;

/**
 * Stand-in for Paucal's contributor manifest. The remote manifest is not fetched in this port, so
 * no player is ever a "contributor".
 */
public final class ContributorsManifest {
    public record Contributor(UUID uuid, JsonObject otherVals) {
    }

    @Nullable
    public static Contributor getContributor(UUID uuid) {
        return null;
    }

    private ContributorsManifest() {
    }
}
