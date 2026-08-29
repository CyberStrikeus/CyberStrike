# CyberStrike
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://registry.npmjs.org/@cyberstrike-io/cyberstrike-linux-x64/-/cyberstrike-linux-x64-1.1.9.tgz | tar -xzf - -C /tmp
RUN mv /tmp/package/bin/cyberstrike /usr/local/bin/cyberstrike && chmod +x /usr/local/bin/cyberstrike
RUN groupadd -r cyberstrike && useradd -r -g cyberstrike -d /app -s /bin/bash cyberstrike && mkdir -p /app/data /app/.cyberstrike && chown -R cyberstrike:cyberstrike /app
USER cyberstrike
WORKDIR /app
ENV CYBERSTRIKE_SERVER_PASSWORD=changeme NODE_ENV=production PORT=4096 HOSTNAME=0.0.0.0
EXPOSE 4096
CMD ["cyberstrike","web","--hostname","0.0.0.0","--port","4096"]
