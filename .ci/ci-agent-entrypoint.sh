#!/bin/sh
# Copyright (C) 2026-2026 Huawei Technologies Co., Ltd
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Entry point for the CI agent image: the container connects outwards to the
# Jenkins controller as an inbound agent. Nothing here needs, or is given, a
# Docker socket.
#
# Two calling conventions have to work, because the two ways this image gets
# started do not agree:
#
#   * a Docker Cloud passes positional arguments, `-url <url> <secret> <name>`,
#     the shape the official inbound-agent entry point takes, and sets no
#     environment variables;
#   * a hand-started or Compose-started container sets JENKINS_URL,
#     JENKINS_SECRET and JENKINS_AGENT_NAME instead.
set -eu

URL="${JENKINS_URL:-}"
SECRET="${JENKINS_SECRET:-}"
NAME="${JENKINS_AGENT_NAME:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        -url) URL="$2"; shift 2 ;;
        -secret) SECRET="$2"; shift 2 ;;
        -name) NAME="$2"; shift 2 ;;
        -workDir) JENKINS_AGENT_WORKDIR="$2"; shift 2 ;;
        *)
            # Positional arguments arrive in the inbound-agent order: secret, then name.
            if [ -z "$SECRET" ]; then
                SECRET="$1"
            elif [ -z "$NAME" ]; then
                NAME="$1"
            fi
            shift ;;
    esac
done

: "${URL:?JENKINS_URL or -url is required}"
: "${SECRET:?JENKINS_SECRET or a secret argument is required}"
: "${NAME:?JENKINS_AGENT_NAME or a name argument is required}"

WORKDIR="${JENKINS_AGENT_WORKDIR:-/ci-agent}"
JAR="$WORKDIR/agent.jar"

# Fetch remoting from the controller rather than baking it in: it is compiled
# for the controller's Java release, and a stale copy fails at connect time
# with UnsupportedClassVersionError rather than with anything readable.
curl -sfo "$JAR" "${URL%/}/jnlpJars/agent.jar"

exec java -jar "$JAR" \
    -url "$URL" \
    -secret "$SECRET" \
    -name "$NAME" \
    -workDir "$WORKDIR"
