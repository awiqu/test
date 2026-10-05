package at.petrak.hexcasting.api.advancements;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.advancements.predicates.ContextAwarePredicate;
import net.minecraft.advancements.predicates.entity.EntityPredicate;
import net.minecraft.advancements.triggers.SimpleCriterionTrigger;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;

import java.util.Optional;

public class SpendMediaTrigger extends SimpleCriterionTrigger<SpendMediaTrigger.Instance> {
    private static final Identifier ID = Identifier.fromNamespaceAndPath("hexcasting", "spend_media");

    @Override
    public Codec<Instance> codec() {
        return Instance.CODEC;
    }

    public void trigger(ServerPlayer player, long mediaSpent, long mediaWasted) {
        super.trigger(player, inst -> inst.test(mediaSpent, mediaWasted));
    }

    public static record Instance(
            Optional<ContextAwarePredicate> player,
            MinMaxLongs mediaSpent,
            MinMaxLongs mediaWasted
    ) implements SimpleCriterionTrigger.SimpleInstance {
        public static final Codec<Instance> CODEC = RecordCodecBuilder.create(
                inst -> inst.group(
                                EntityPredicate.ADVANCEMENT_CODEC.optionalFieldOf("player").forGetter(Instance::player),
                                MinMaxLongs.CODEC.fieldOf("media_generated").forGetter(Instance::mediaSpent),
                                MinMaxLongs.CODEC.fieldOf("health_used").forGetter(Instance::mediaWasted)
                        )
                        .apply(inst, Instance::new)
        );

        private boolean test(long mediaSpentIn, long mediaWastedIn) {
            return this.mediaSpent.matches(mediaSpentIn) && this.mediaWasted.matches(mediaWastedIn);
        }

        @Override
        public Optional<ContextAwarePredicate> player() {
            return Optional.empty();
        }
    }
}
