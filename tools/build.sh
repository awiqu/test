#!/bin/bash
# Serialized gradle compile helper. Usage: tools/build.sh [gradle task, default compileKotlin compileJava]
# Writes full compiler errors to $OUT (default /tmp/hex-build-$$.txt) and prints a summary.
export JAVA_HOME=/opt/jdk25/jdk-25.0.4.1+1
export PATH=$JAVA_HOME/bin:$PATH
cd /home/user/test
TASK=${1:-compileJava}
OUT=${OUT:-/tmp/hex-build-$$.txt}
exec 9>/tmp/hex-build.lock
flock 9
./gradlew $TASK -q --continue 2>&1 | grep -vE 'JAVA_TOOL_OPTIONS|^To honour|^Daemon will' > $OUT
echo "full output: $OUT ($(grep -cE '^e: |error:' $OUT) errors)"
