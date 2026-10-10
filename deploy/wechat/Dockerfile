# 独立 Go 进程，不把 iLink 协议代码嵌入 Pi Durable。
# 固定上游 commit；build 阶段应用本项目的兼容性/投递补丁。
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git python3
ARG WXBOT_COMMIT=57ed5f56eedce782e378483f762c7565c45ade5d
RUN git clone https://github.com/lawrencewzen/wx-bot.git /src && \
    git -C /src checkout --detach "$WXBOT_COMMIT"
COPY deploy/wechat/patch_upstream.py /tmp/patch_upstream.py
RUN python3 /tmp/patch_upstream.py /src && \
    cd /src && go test ./... && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/wx-bot ./cmd/wx-bot

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && \
    addgroup -S bot && adduser -S -G bot bot && \
    mkdir -p /state /media && chown -R bot:bot /state /media
COPY --from=build /out/wx-bot /usr/local/bin/wx-bot
COPY --from=build /src/LICENSE /licenses/wx-bot-LICENSE
COPY deploy/wechat/config.json /etc/wx-bot/config.json
USER bot
ENTRYPOINT ["wx-bot"]
CMD ["--config", "/etc/wx-bot/config.json", "run"]
