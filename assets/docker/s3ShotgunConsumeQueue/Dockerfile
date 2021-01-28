FROM alpine:latest

RUN apk update && \
    apk add --no-cache \
        python3 \
        py3-pip \
        nodejs \
        nodejs-npm
RUN pip3 install --upgrade pip \
    && pip3 install \
        awscli
RUN rm -rf /var/cache/apk/*

COPY package.json /tmp/package.json
RUN cd /tmp && npm install
RUN mkdir -p /home/s3shotgun && cp -a /tmp/node_modules /home/s3shotgun

WORKDIR /home/s3shotgun
COPY consumeQueue.js /home/s3shotgun
ENTRYPOINT ["/usr/bin/node"]