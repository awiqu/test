#!/bin/bash
# Standalone javac over all Java sources (ignores Kotlin) to get Java diagnostics before Kotlin compiles.
# Errors that only mention missing Kotlin classes are noise.
export JAVA_HOME=/opt/jdk25/jdk-25.0.4.1+1
export PATH=$JAVA_HOME/bin:$PATH
cd /home/user/test
CP=$(cat /tmp/claude-0/-home-user-test/3d48c79f-cf20-5233-b63c-3022b75d7275/scratchpad/cp.txt)
OUTD=${OUTD:-/tmp/javac-out}
mkdir -p $OUTD
find src/main/java -name '*.java' > /tmp/javac-files.txt
javac -XDshould-stop.ifError=FLOW -proc:none -encoding UTF-8 --release 25 -Xmaxerrs 20000 -Xmaxwarns 0 -nowarn -d $OUTD -cp "$CP" @/tmp/javac-files.txt 2> ${OUT:-/tmp/javac-errors.txt}
echo "errors: $(grep -c 'error:' ${OUT:-/tmp/javac-errors.txt})"
