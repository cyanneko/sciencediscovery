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

# The CI toolchain image, plus the little a Jenkins inbound agent needs.
#
# It is FROM the image Dockerfile produces rather than a copy of it, so the
# toolchain keeps exactly one definition: whatever `pnpm ci:*` needs is decided
# in one place and this file only adds a way to reach the controller. The build
# context is .ci/, the same as Dockerfile, so no product source can be copied
# in.
#
#     docker build --file .ci/Dockerfile       --tag sciencediscovery-ci:test  .ci
#     docker build --file .ci/agent.Dockerfile --tag sciencediscovery-ci:agent .ci
#
# An agent container needs the three non-privileged allowances the toolchain
# image's tests rely on — seccomp, apparmor and systempaths unconfined — and a
# writable /ci-agent. It needs no Docker socket: layers run in this container,
# not in containers it starts.

ARG CI_IMAGE=sciencediscovery-ci:test
ARG CONTROLLER_IMAGE=jenkins/jenkins:lts-jdk21

FROM ${CONTROLLER_IMAGE} AS controller
FROM ${CI_IMAGE}

# Take the JRE from the controller image instead of installing one. Remoting is
# compiled for the controller's Java release; an older JRE here fails at connect
# time with "class file version 65.0 ... only recognizes up to 61.0", which
# looks nothing like a version-skew problem until you read it twice.
COPY --from=controller /opt/java/openjdk /opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH

USER root
COPY ci-agent-entrypoint.sh /usr/local/bin/ci-agent-entrypoint
# 1777 because the container runs as the checkout owner's numeric identity,
# which is not a user this image knows about.
RUN chmod 0755 /usr/local/bin/ci-agent-entrypoint \
 && mkdir -p /ci-agent \
 && chmod 1777 /ci-agent
USER node

ENTRYPOINT ["/usr/local/bin/ci-agent-entrypoint"]
