package at.petrak.hexcasting.api.advancements;

import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.minecraft.advancements.predicates.ContextAwarePredicate;
import net.minecraft.advancements.predicates.entity.EntityPredicate;
import net.minecraft.advancements.triggers.SimpleCriterionTrigger;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerPlayer;

import java.util.Optional;

public class FailToCastGreatSpellTrigger extends SimpleCriterionTrigger<FailToCastGreatSpellTrigger.Instance> {
    private static final Identifier ID = Identifier.fromNamespaceAndPath("hexcasting", "fail_to_cast_great_spell");

    @Override
    public Codec<Instance> codec() {
        return Instance.CODEC;
    }

    public void trigger(ServerPlayer player) {
        super.trigger(player, e -> true);
    }

    public static record Instance(Optional<ContextAwarePredicate> player) implements SimpleCriterionTrigger.SimpleInstance {
        public static final Codec<FailToCastGreatSpellTrigger.Instance> CODEC = RecordCodecBuilder.create(
                triggerInstance -> triggerInstance.group(
                                EntityPredicate.ADVANCEMENT_CODEC.optionalFieldOf("player").forGetter(FailToCastGreatSpellTrigger.Instance::player)
                        )
                        .apply(triggerInstance, FailToCastGreatSpellTrigger.Instance::new)
        );

        @Override
        public Optional<ContextAwarePredicate> player() {
            return player;
        }
    }
}
