FROM alpine:latest

RUN apk update && \
    apk add --no-cache \
        nodejs \
        nodejs-npm
RUN rm -rf /var/cache/apk/*

COPY package.json /tmp/package.json
RUN cd /tmp && npm install
RUN mkdir -p /home/s3shotgun && cp -a /tmp/node_modules /home/s3shotgun

WORKDIR /home/s3shotgun
COPY s3Dfs.js /home/s3shotgun
COPY paginator.js /home/s3shotgun
ENTRYPOINT ["/usr/bin/node"]