# Hex Casting — port to Minecraft 26.2 (Fabric)

Port of [Hex Casting](https://github.com/FallingColors/HexMod) (MIT) to **Minecraft 26.2, Fabric** (Java 25, Fabric Loader ≥ 0.19.5, Fabric API 0.161.0+26.2).

Base: upstream `1.21` branch (0.12.0-devel), collapsed into a single Gradle module. Mojang names are used directly (26.x is unobfuscated).

## Requirements
Fabric API, Fabric Language Kotlin ≥ 1.14.0, Cardinal Components API 8.0.1, Cloth Config 26.2.x. Optional: Mod Menu, Patchouli.
Patchouli has no official 26.2 release; `patchouli-26.2/` contains our port (source, CC BY-NC-SA 3.0 like upstream) and `dev-libs/patchouli-26.2-94-port.jar` the built jar. Without it the mod works but the in-game Hex book is unavailable.

## Build / run
```
export JAVA_HOME=/path/to/jdk25
./gradlew build        # build/libs/hexcasting-fabric-26.2-*.jar
./gradlew runServer    # dev server (eula=true in run/eula.txt)
```

## Status
Verified: compiles; dedicated server boots with the mod (registries, mixins, recipes, loot, advancements, custom registries/tags, block entities save/load, commands).
**Not verified in a running client** (no usable GPU where this was done): rendering of patterns, the spellcasting GUI, item models/tints, particles, Patchouli book GUI.

Not ported (no 26.x releases of the dependency): Inline, Trinkets, Pehkui, JEI, EMI integrations (sources kept in `disabled/`), data generation (`disabled/datagen`; generated output is in `src/generated`). The remote contributor manifest of Paucal is stubbed.
See `PORTING_NOTES.md` for details.
