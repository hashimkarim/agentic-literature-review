FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git git-lfs build-essential pkg-config libssl-dev \
    python3 unzip xz-utils zip jq openssl poppler-utils bubblewrap \
    libicu74 libkrb5-3 zlib1g liblttng-ust1t64 libunwind8 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1001 --create-home --shell /bin/bash runner \
    && mkdir -p /runner /work /opt/hostedtoolcache \
    && curl -fL --retry 3 https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz -o /tmp/runner.tar.gz \
    && echo '70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613  /tmp/runner.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/runner.tar.gz -C /runner \
    && curl -fL --retry 3 https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && echo '41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df  /tmp/node.tar.xz' | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local \
    && curl -fL --retry 3 https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip -o /tmp/bun.zip \
    && echo '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f  /tmp/bun.zip' | sha256sum -c - \
    && unzip -q /tmp/bun.zip -d /tmp \
    && install -m 755 /tmp/bun-linux-x64/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && rm -rf /tmp/runner.tar.gz /tmp/node.tar.xz /tmp/bun.zip /tmp/bun-linux-x64 \
    && chown -R runner:runner /runner /work /opt/hostedtoolcache
COPY --chmod=755 job-started.sh job-started.ts register.sh /opt/ci/
COPY --chmod=644 policy.json /opt/ci/
ENV RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    AGENT_TOOLSDIRECTORY=/opt/hostedtoolcache \
    ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/ci/job-started.sh
USER runner
WORKDIR /runner
CMD ["./run.sh"]
