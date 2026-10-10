FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 NODE_NO_WARNINGS=1
# 数据目录交给非 root 用户；命名卷首次创建时会继承这个属主
RUN mkdir -p /data /workspace && chown node:node /data /workspace
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
